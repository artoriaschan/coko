import { Context, Effect, FiberMap, Layer } from 'effect'
import { createModelRegistry, type ToolRegistry } from '@coko/agent'
import { getLogger } from '@coko/logging'
import { configureFileLogging, type FileLogging } from '@coko/logging/file'
import type { SessionModel } from '@coko/protocol'
import { isStoreError } from '@coko/session'
import { openSqliteStore, type SqliteStore } from '@coko/session/sqlite'
import { createEnvCredentialStore, createIpcCredentialStore } from '../adapters/credentials.ts'
import { installFauxProvider } from '../adapters/faux.ts'
import { createWorkspaceTools, probeRipgrep } from '../adapters/ripgrep.ts'
import { SessionHub } from '../application/hub.ts'
import type { Application } from '../application/index.ts'
import { ProviderService } from '../application/providers.ts'
import { SessionService, type RunLauncher } from '../application/sessions.ts'
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
 * 在打开存储之前执行，失败时不占用租约。
 */
const ToolsLive = Layer.effect(
  Tools,
  Effect.gen(function* () {
    const { config } = yield* Host
    const log = getLogger(['runtime'])
    const path = config.ripgrepPath
    if (path === undefined) {
      log.info('grep implementation selected', { implementation: 'builtin' })
      return createWorkspaceTools(undefined)
    }
    const version = yield* Effect.tryPromise({
      try: () => probeRipgrep(path),
      catch: (error) => new StartupError('ripgrep-unavailable', message(error), { cause: error }),
    })
    log.info('grep implementation selected', { implementation: 'ripgrep', path, version })
    return createWorkspaceTools(path)
  }),
)

/** SQLite 存储：打开失败（租约、损坏、版本过高、迁移）是 fatal。 */
const StoreLive = Layer.effect(
  Store,
  Effect.gen(function* () {
    const { config } = yield* Host
    return yield* Effect.acquireRelease(
      Effect.tryPromise({
        try: () => openSqliteStore({ path: config.dbPath }),
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
    const hub = new SessionHub()
    const providers = new ProviderService({ store, registry, invalidateCredential: (id) => credentials.invalidate(id) })
    yield* Effect.promise(() => providers.load())
    const sessions = new SessionService({ store, registry, hub, runs, tools: workspaceTools, ...(fallbackModel ? { fallbackModel } : {}) })

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
