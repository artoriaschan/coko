import { Context, Effect, FiberMap, Layer } from 'effect'
import { createCheckpointTracker, createModelRegistry, SESSION_ENTRY_PAYLOADS, type SnapshotPort, type ToolHooks, type ToolRegistry } from '@coko/agent'
import { getLogger } from '@coko/logging'
import { configureFileLogging, type FileLogging } from '@coko/logging/file'
import type { SessionModel } from '@coko/protocol'
import { createPayloadRegistry, isStoreError } from '@coko/session'
import { openSqliteStore, type SqliteStore } from '@coko/session/sqlite'
import { openCheckpointStore } from '../adapters/checkpoints.ts'
import { createEnvCredentialStore, createEnvSecretProvider, createIpcCredentialStore } from '../adapters/credentials.ts'
import { installFauxProvider } from '../adapters/faux.ts'
import { createWorkspaceTools, probeRipgrep } from '../adapters/ripgrep.ts'
import { createSeatbeltSandbox, DEFAULT_SANDBOX_EXEC, probeSeatbelt } from '../adapters/seatbelt.ts'
import { createSecretProbeTool } from '../adapters/test-tools.ts'
import { SessionHub } from '../application/hub.ts'
import type { Application } from '../application/index.ts'
import { ProviderService } from '../application/providers.ts'
import { SessionService, type RunLauncher, type SessionExtension, type SessionExtensionContext } from '../application/sessions.ts'
import { SettingsService } from '../application/settings.ts'
import { WorkspaceService } from '../application/workspaces.ts'
import type { SidecarConfig } from '../config.ts'
import type { ControlChannel } from '../control/channel.ts'
import { startHttpServer, type HttpServer } from '../http/server.ts'

/** 启动失败；code 经 fatal 控制消息交给 main。 */
export class StartupError extends Error {
  override readonly name = 'StartupError'
  readonly code: string
  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.code = code
  }
}

export interface HostShape {
  config: SidecarConfig
  control: ControlChannel
  env: Readonly<Record<string, string | undefined>>
}

export class Host extends Context.Service<Host, HostShape>()('coko/Host') {}
export class Logging extends Context.Service<Logging, FileLogging>()('coko/Logging') {}
export class Tools extends Context.Service<Tools, (cwd: string) => ToolRegistry>()('coko/Tools') {}
export class Store extends Context.Service<Store, SqliteStore>()('coko/Store') {}
export class Runs extends Context.Service<Runs, RunLauncher>()('coko/Runs') {}
export class App extends Context.Service<App, Application>()('coko/App') {}
export class Http extends Context.Service<Http, HttpServer>()('coko/Http') {}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** 文件日志：最先建立、最后释放。目录不可写时退回 console 诊断，不阻止启动。 */
const LoggingLive = Layer.effect(
  Logging,
  Effect.gen(function* () {
    const { config } = yield* Host
    return yield* Effect.acquireRelease(
      Effect.promise(() =>
        configureFileLogging({
          path: config.logPath,
          process: 'sidecar',
          level: config.logLevel,
          ...(config.appVersion ? { properties: { appVersion: config.appVersion } } : {}),
        }),
      ),
      (logging) => Effect.promise(() => logging.dispose()),
    )
  }),
)

/**
 * 工具集：给定 --ripgrep 时先探测可执行性，失败是 fatal（不回退内置 grep，以免掩盖打包缺陷）。
 * 命令沙箱（Seatbelt）探测一次：不可用不阻止启动，受限档位的命令 fail-closed（ADR 0005），full-access 不受影响。
 * 在打开存储之前执行，失败时不占用租约。
 */
const ToolsLive = Layer.effect(
  Tools,
  Effect.gen(function* () {
    const { config } = yield* Host
    const log = getLogger(['runtime'])
    const executable = config.sandboxExec ?? DEFAULT_SANDBOX_EXEC
    const probe = yield* Effect.promise(() => probeSeatbelt(executable))
    if (probe.available) log.info('command sandbox selected', { sandbox: 'seatbelt', executable })
    else log.warn('command sandbox unavailable; confined commands will not run', { sandbox: 'seatbelt', executable, reason: probe.reason })
    const sandbox = createSeatbeltSandbox(probe)
    const extraTools = config.testTools ? () => [createSecretProbeTool()] : undefined
    if (extraTools) log.warn('test tools enabled', { tools: ['secret_probe'] })
    const path = config.ripgrepPath
    if (path === undefined) {
      log.info('grep implementation selected', { implementation: 'builtin' })
      return createWorkspaceTools({ sandbox, ...(extraTools ? { extraTools } : {}) })
    }
    const version = yield* Effect.tryPromise({
      try: () => probeRipgrep(path),
      catch: (error) => new StartupError('ripgrep-unavailable', message(error), { cause: error }),
    })
    log.info('grep implementation selected', { implementation: 'ripgrep', path, version })
    return createWorkspaceTools({ rgPath: path, sandbox, ...(extraTools ? { extraTools } : {}) })
  }),
)

/**
 * SQLite 存储：打开失败（租约、损坏、版本过高、迁移）是 fatal。Session Entry 的 payload 按 agent 定义的注册表
 * 写入校验、读取迁移；读取时跳过的条目记 warn（不含 payload）。
 */
const StoreLive = Layer.effect(
  Store,
  Effect.gen(function* () {
    const { config } = yield* Host
    const log = getLogger(['storage'])
    const payloads = createPayloadRegistry(SESSION_ENTRY_PAYLOADS)
    return yield* Effect.acquireRelease(
      Effect.tryPromise({
        try: () => openSqliteStore({ path: config.dbPath, payloads, onInvalidEntry: (entry) => log.warn('session entry skipped', { ...entry }) }),
        catch: (error) => new StartupError(isStoreError(error) ? `storage-${error.code}` : 'storage-open-failed', message(error), { cause: error }),
      }),
      (store) => Effect.promise(() => store.close()),
    )
  }),
)

/** 每个 Run 是 FiberMap 中的一个 fiber；关闭时中断：先 abort，再等 Run 结束并提交 run_end，之后才关闭存储。 */
const RunsLive = Layer.effect(
  Runs,
  Effect.gen(function* () {
    const map = yield* FiberMap.make<string>()
    const run = yield* FiberMap.runtime(map)<never>()
    return {
      launch(key, promise, abort) {
        run(
          key,
          Effect.promise(() => promise).pipe(
            Effect.onInterrupt(() =>
              Effect.promise(async () => {
                abort()
                await promise
              }),
            ),
          ),
        )
      },
    } satisfies RunLauncher
  }),
)

/**
 * 每个 Session 运行时的扩展：Checkpoint tracker（ADR 0006）。快照写到 <dataDir>/blobs；锚点与已备份路径从该 Session
 * 已提交的条目恢复。hooks 排在权限判定之后，被拒绝的调用不备份。诊断只记 toolCallId 与错误，不含文件内容。
 */
function checkpointExtensions(snapshots: SnapshotPort, store: SqliteStore): (context: SessionExtensionContext) => SessionExtension {
  const log = getLogger(['checkpoints'])
  return ({ sessionId, cwd, commit }) => {
    const tracker = createCheckpointTracker({
      cwd,
      snapshots,
      commit,
      history: () => store.sessions.listEntries(sessionId),
      onError: (error, context) => log.warn('checkpoint record failed', { sessionId, ...context, error: message(error) }),
    })
    return { hooks: [tracker.hooks], onEntry: (entry) => tracker.observe(entry) }
  }
}

/**
 * 仅测试（COKO_TEST_TOOLS=1 且 COKO_TEST_HOLD_AFTER_TOOL=<工具名>）：该工具执行完、afterToolCall 的其他 hook（checkpoint 的
 * file_change）之后挂起，toolResult 不提交，直到 Run 被中止。集成测试借此在"已执行、未记录结果"处强杀 Sidecar。
 * COKO_TEST_HOLD_BEFORE_CHECKPOINT=1 时挂起点移到 checkpoint 的 afterToolCall 之前（file_change 也不提交）。
 */
function holdAfterTool(toolName: string): ToolHooks {
  return {
    async afterToolCall({ toolCall }, signal) {
      if (toolCall.name !== toolName) return undefined
      getLogger(['runtime']).warn('test hold after tool', { toolCallId: toolCall.id, toolName })
      await new Promise<void>((resolve) => {
        if (signal?.aborted) return resolve()
        signal?.addEventListener('abort', () => resolve(), { once: true })
      })
      return undefined
    },
  }
}

function withTestHold(
  extensions: (context: SessionExtensionContext) => SessionExtension,
  toolName: string | undefined,
  beforeCheckpoint: boolean,
): (context: SessionExtensionContext) => SessionExtension {
  if (!toolName) return extensions
  const hold = holdAfterTool(toolName)
  return (context) => {
    const extension = extensions(context)
    const hooks = extension.hooks ?? []
    return { ...extension, hooks: beforeCheckpoint ? [hold, ...hooks] : [...hooks, hold] }
  }
}

const AppLive = Layer.effect(
  App,
  Effect.gen(function* () {
    const { config, control, env } = yield* Host
    const store = yield* Store
    const runs = yield* Runs
    const workspaceTools = yield* Tools
    const log = getLogger(['runtime'])
    const credentials =
      control.mode === 'ipc' ? createIpcCredentialStore({ control, providers: store.providers }) : createEnvCredentialStore({ env, providers: store.providers })
    const registry = createModelRegistry({ credentials })
    let fallbackModel: SessionModel | undefined
    if (config.fauxScript) {
      const script = config.fauxScript
      fallbackModel = yield* Effect.tryPromise({
        try: () => installFauxProvider(registry, script),
        catch: (error) => new StartupError('faux-script-invalid', message(error), { cause: error }),
      })
      log.warn('faux provider enabled for tests', { providerId: fallbackModel.providerId })
    }
    const checkpoints = openCheckpointStore(config.dataDir)
    const hub = new SessionHub()
    const providers = new ProviderService({ store, registry, invalidateCredential: (id) => credentials.invalidate(id) })
    yield* Effect.promise(() => providers.load())
    const sessions = new SessionService({
      store,
      registry,
      hub,
      runs,
      tools: workspaceTools,
      secrets: createEnvSecretProvider(env),
      extensions: withTestHold(
        checkpointExtensions(checkpoints.snapshots, store),
        config.testTools ? env.COKO_TEST_HOLD_AFTER_TOOL : undefined,
        env.COKO_TEST_HOLD_BEFORE_CHECKPOINT === '1',
      ),
      checkpoints: checkpoints.files,
      ...(fallbackModel ? { fallbackModel } : {}),
    })
    // 启动恢复：打开存储之后、开始监听之前（HttpLive 依赖本层）。正常关闭的 Run 已有 run_end，不进入恢复。
    const recovery = yield* Effect.tryPromise({
      try: () => sessions.recover(store.recovery),
      catch: (error) => new StartupError('recovery-failed', message(error), { cause: error }),
    })
    if (recovery.interruptedRuns > 0) log.warn('startup recovery finished', { ...recovery })

    control.onMessage((msg) => {
      if (msg.type !== 'credential.store') return
      providers.storeCredential(msg.providerId, msg.ciphertext, msg.hint).then(
        () => control.send({ type: 'credential.store.result', requestId: msg.requestId, ok: true }),
        (error: unknown) => control.send({ type: 'credential.store.result', requestId: msg.requestId, ok: false, error: message(error) }),
      )
    })

    return {
      store,
      hub,
      sessions,
      providers,
      settings: new SettingsService(store),
      workspaces: new WorkspaceService(store),
    } satisfies Application
  }),
)

const HttpLive = Layer.effect(
  Http,
  Effect.gen(function* () {
    const app = yield* App
    return yield* Effect.acquireRelease(
      Effect.tryPromise({ try: () => startHttpServer(app), catch: (error) => new StartupError('listen-failed', message(error), { cause: error }) }),
      (server) => Effect.promise(() => server.close()),
    )
  }),
)

/**
 * 装配顺序：Host → Logging → Tools → Store → Runs → App → Http；释放顺序相反，
 * 即先停止接受请求，再中断并等待 Run，然后关闭存储，最后刷新日志。
 */
export function sidecarLayer(host: HostShape) {
  return HttpLive.pipe(
    Layer.provideMerge(AppLive),
    Layer.provideMerge(RunsLive),
    Layer.provideMerge(StoreLive),
    Layer.provideMerge(ToolsLive),
    Layer.provideMerge(LoggingLive),
    Layer.provideMerge(Layer.succeed(Host, host)),
  )
}
