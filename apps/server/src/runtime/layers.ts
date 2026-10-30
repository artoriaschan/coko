import { Context, Effect, FiberMap, Layer } from 'effect'
import { createCheckpointTracker, createModelRegistry, SESSION_ENTRY_PAYLOADS, type SnapshotPort, type ToolHooks, type ToolRegistry } from '@coko/agent'
import { getLogger, REDACTED, registerSecretValues } from '@coko/logging'
import { configureFileLogging, type FileLogging } from '@coko/logging/file'
import type { SessionModel } from '@coko/protocol'
import { createPayloadRegistry, isStoreError } from '@coko/session'
import { openSqliteStore, type SqliteStore } from '@coko/session/sqlite'
import { openCheckpointStore } from '../adapters/checkpoints.ts'
import { createEnvCredentialStore, createEnvSecretSource, createIpcCredentialStore, createIpcSecretSource } from '../adapters/credentials.ts'
import { installFauxProvider } from '../adapters/faux.ts'
import { createHookRunner } from '../adapters/hook-runner.ts'
import { createMcpTransport } from '../adapters/mcp.ts'
import { probeNodePty } from '../adapters/pty.ts'
import { createWorkspaceTools, probeRipgrep, type WorkspaceToolsOptions } from '../adapters/ripgrep.ts'
import { createSeatbeltSandbox, DEFAULT_SANDBOX_EXEC, probeSeatbelt } from '../adapters/seatbelt.ts'
import { join } from 'node:path'
import { createSecretProbeTool, createTestSeamContribution } from '../adapters/test-tools.ts'
import { createTestClock, systemClock, type ClockPort, type TestClock } from '../adapters/clock.ts'
import { createM5SeamContribution } from '../adapters/m5-test-seams.ts'
import { createGitRunner } from '../adapters/git.ts'
import { HandoffService } from '../application/handoff.ts'
import { HookService } from '../application/hooks.ts'
import { NotificationService } from '../application/notifications.ts'
import { m5RecoveryHooks } from '../application/recovery.ts'
import { ScheduleService } from '../application/schedules.ts'
import { SubagentService } from '../application/subagents.ts'
import { WorktreeService } from '../application/worktrees.ts'
import { ConfigService } from '../application/config.ts'
import { ContextService } from '../application/context-service.ts'
import { errorMessage } from '../application/errors.ts'
import { createContextAssembly, createContributions, type ContextAssembly, type SessionEntryAccess } from '../application/context/index.ts'
import { McpManager } from '../application/context/mcp.ts'
import { McpAdmin } from '../application/context/mcp-admin.ts'
import { MemoryService } from '../application/context/memory.ts'
import { GoalService, type GoalRunHost } from '../application/goals.ts'
import { JobService, type JobRunHost } from '../application/jobs.ts'
import { ProcessRegistry } from '../application/processes.ts'
import { SessionHub } from '../application/hub.ts'
import type { Application } from '../application/index.ts'
import { serveProviderModels } from '../application/provider-models.ts'
import { ProviderService, serveProviderSave } from '../application/providers.ts'
import { SecretService } from '../application/secrets.ts'
import { toNewEntry } from '../application/session-runtimes.ts'
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
/** 探测后的工具集工厂；执行端口的包装（子进程登记）在存储打开之后由 AppLive 给出。 */
export class Tools extends Context.Service<Tools, (extra: Pick<WorkspaceToolsOptions, 'wrapExec'>) => (cwd: string) => ToolRegistry>()('coko/Tools') {}
export class Store extends Context.Service<Store, SqliteStore>()('coko/Store') {}
export class Runs extends Context.Service<Runs, RunLauncher>()('coko/Runs') {}
export class Processes extends Context.Service<Processes, ProcessRegistry>()('coko/Processes') {}
export class Assembly extends Context.Service<
  Assembly,
  {
    config: ConfigService
    context: ContextAssembly
    mcp: McpAdmin
    secrets: SecretService
    hub: SessionHub
    jobs: JobService
    goals: GoalService
    /** 外部 Hook（ADR 0013）：上下文贡献与 /api/hooks 共用。 */
    hooks: HookService
    /** AppLive 创建 SessionService 之后调用一次：Job 与 Goal 的 Run 能力从此生效。 */
    bindSessions: (sessions: SessionService) => void
  }
>()('coko/Assembly') {}
export class App extends Context.Service<App, Application>()('coko/App') {}
export class Http extends Context.Service<Http, HttpServer>()('coko/Http') {}

/**
 * Job 与 Goal 先于 SessionService 创建（上下文贡献读取它们），它们需要的 Run 能力由之后创建的 SessionService 提供：构造时注入这里的窄接口，
 * AppLive 创建 SessionService 后 bind 一次。bind 在启动恢复与开始监听之前，之前不会有调用；万一有，抛错而不是静默返回空值。
 */
function lateSessionRuns() {
  let bound: SessionService | undefined
  const sessions = () => {
    if (!bound) throw new Error('SessionService is not bound yet')
    return bound
  }
  const jobs: JobRunHost = {
    activeRunId: (sessionId) => sessions().runs.activeRunId(sessionId),
    deliver: (sessionId, input) => sessions().runs.deliver(sessionId, input),
  }
  const goals: GoalRunHost = {
    activeRunId: (sessionId) => sessions().runs.activeRunId(sessionId),
    stopAfterBatch: (sessionId, error) => sessions().runs.stopAfterBatch(sessionId, error),
    startRun: (sessionId, request) => sessions().runs.startRun(sessionId, request),
    modelPriced: (sessionId) => sessions().modelPriced(sessionId),
    isRunning: (sessionId) => sessions().isRunning(sessionId),
    abort: (sessionId) => sessions().abort(sessionId),
    pause: (sessionId) => sessions().pause(sessionId),
  }
  return { jobs, goals, bind: (service: SessionService) => void (bound = service) }
}

/** 有序关闭的每一步记一行（按释放顺序：定时器 → Run → Job → 上下文贡献 → 登记进程 → 存储），便于从日志核对顺序。 */
const shutdownStep = (step: string) => Effect.sync(() => getLogger(['runtime']).info('shutdown step {step}', { step }))

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
 * PTY（node-pty）同样探测一次：加载失败不阻止启动，bash tty 调用以 pty-unavailable 返回。
 * 在打开存储之前执行，失败时不占用租约。
 */
const ToolsLive = Layer.effect(
  Tools,
  Effect.gen(function* () {
    const { config } = yield* Host
    const log = getLogger(['runtime'])
    if (config.ignoredTestHooks) log.warn('test hooks ignored in a packaged build', { variables: config.ignoredTestHooks })
    const executable = config.sandboxExec ?? DEFAULT_SANDBOX_EXEC
    const probe = yield* Effect.promise(() => probeSeatbelt(executable))
    if (probe.available) log.info('command sandbox selected', { sandbox: 'seatbelt', executable })
    else log.warn('command sandbox unavailable; confined commands will not run', { sandbox: 'seatbelt', executable, reason: probe.reason })
    const sandbox = createSeatbeltSandbox(probe)
    const pty = probeNodePty()
    if (pty.available) log.info('pty backend selected', { backend: 'node-pty', version: pty.version, path: pty.path })
    else log.warn('pty backend unavailable; tty commands will not run', { backend: 'node-pty', reason: pty.reason })
    const extraTools = config.testTools ? () => [createSecretProbeTool()] : undefined
    if (extraTools) log.warn('test tools enabled', { tools: ['secret_probe'] })
    const path = config.ripgrepPath
    const base: WorkspaceToolsOptions = { sandbox, ...(pty.available ? { pty: pty.port } : {}), ...(extraTools ? { extraTools } : {}) }
    if (path === undefined) {
      log.info('grep implementation selected', { implementation: 'builtin' })
      return (extra: Pick<WorkspaceToolsOptions, 'wrapExec'>) => createWorkspaceTools({ ...base, ...extra })
    }
    const version = yield* Effect.tryPromise({
      try: () => probeRipgrep(path),
      catch: (error) => new StartupError('ripgrep-unavailable', errorMessage(error), { cause: error }),
    })
    log.info('grep implementation selected', { implementation: 'ripgrep', path, version })
    return (extra: Pick<WorkspaceToolsOptions, 'wrapExec'>) => createWorkspaceTools({ ...base, rgPath: path, ...extra })
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
        catch: (error) => new StartupError(isStoreError(error) ? `storage-${error.code}` : 'storage-open-failed', errorMessage(error), { cause: error }),
      }),
      (store) => shutdownStep('storage').pipe(Effect.andThen(Effect.promise(() => store.close()))),
    )
  }),
)

/**
 * 子进程登记（ADR 0012）：打开存储之后、启动恢复之前清理上次留下的孤儿；关闭时在存储关闭之前终止全部登记进程。
 * 登记的来源：前台 bash（AppLive 包装工具集的执行端口）、后台与 PTY Job（JobService）与 stdio MCP Server（AssemblyLive 的传输工厂）。
 */
const ProcessesLive = Layer.effect(
  Processes,
  Effect.gen(function* () {
    const store = yield* Store
    const registry = new ProcessRegistry({ store })
    return yield* Effect.acquireRelease(
      Effect.promise(async () => {
        const terminated = await registry.cleanup()
        if (terminated > 0) getLogger(['runtime']).warn('orphan cleanup finished', { terminated })
        return registry
      }),
      (registry) => shutdownStep('processes').pipe(Effect.andThen(Effect.promise(() => registry.terminateAll()))),
    )
  }),
)

/**
 * M3 上下文装配：各领域贡献（application/context/）与有效配置。位于存储与 Run 之间：关闭时 Run 先结束，再按顺序关闭各领域
 * （例如 MCP 子进程），最后才关闭存储。
 */
const AssemblyLive = Layer.effect(
  Assembly,
  Effect.gen(function* () {
    const { config: sidecar, control, env } = yield* Host
    const store = yield* Store
    const processes = yield* Processes
    const config = new ConfigService({ store })
    // Secret 只来自登记条目（ADR 0007）：IPC 模式为库中密文（经 main 解密），独立运行只读 COKO_SECRET_<NAME>。
    const secrets = new SecretService({
      store,
      source: control.mode === 'ipc' ? createIpcSecretSource({ control, secrets: store.secrets }) : createEnvSecretSource(env),
      ...(control.mode === 'ipc' ? { control } : {}),
    })
    const mcp = new McpManager({
      store,
      config,
      secrets,
      // stdio Server 登记为 mcp（ADR 0012），传输关闭后删除。pi-mcp 在 POSIX 上以独立进程组（detached，pgid = pid）启动它，登记进程组使
      // 孤儿清理覆盖 Server 派生的子进程（例如经 npx 启动的 Server）；Windows 没有进程组。
      createTransport: (server, { cwd }) =>
        createMcpTransport(server, {
          cwd,
          env,
          onProcess: ({ pid, command }) => processes.track({ pid, ...(process.platform === 'win32' ? {} : { pgid: pid }), kind: 'mcp', command }),
        }),
      ...(sidecar.appVersion ? { clientInfo: { name: 'coko', version: sidecar.appVersion } } : {}),
    })
    // 后台任务与 Goal 先于贡献创建（贡献读取它们）；它们的 Run 能力在 AppLive 创建 SessionService 后接上（lateSessionRuns）。
    // Job 的进程登记为 job（PTY Job 为 pty，ADR 0012），退出后删除。
    const hub = new SessionHub()
    const runs = lateSessionRuns()
    const jobs = new JobService({ store, hub, runs: runs.jobs, logDir: join(sidecar.dataDir, 'jobs'), track: processes.track })
    const goals = new GoalService({ store, hub, jobs, runs: runs.goals })
    // 测试工具另带 M5 seam 的测试贡献（beforeSubmit、onStop 等，按消息中的标记触发）。
    const extra = sidecar.testTools ? [createTestSeamContribution(), createM5SeamContribution()] : []
    // 领域自己的条目（todo_list 等）：与运行时条目相同的脱敏（toNewEntry）后入库，再推送。
    const entries: SessionEntryAccess = {
      list: (sessionId) => store.sessions.listEntries(sessionId),
      async commit(sessionId, entry) {
        const [committed] = await store.sessions.appendEntries(sessionId, [toNewEntry(entry)])
        hub.publishEntry(committed!)
        return committed!
      },
    }
    // 外部 Hook：进程登记为 hook（ADR 0012），环境为 Sidecar 基础环境去掉 COKO_* 与凭据形态的变量。
    const hooks = new HookService({ store, config, runner: createHookRunner({ env, track: processes.track }), entries })
    const contributions = createContributions({ cokoHome: sidecar.cokoHome, mcp, memories: store, jobs, goals, entries, hooks, extra })
    const context = createContextAssembly({ contributions, config, cokoHome: sidecar.cokoHome })
    // 关闭各领域（含 MCP 子进程）在 Run 结束之后、存储关闭之前。
    const admin = new McpAdmin({ store, manager: mcp })
    yield* Effect.addFinalizer(() => shutdownStep('contributions').pipe(Effect.andThen(Effect.promise(() => context.close()))))
    // 后加的先释放：Job 在上下文贡献之前关闭（Job 结束时可能还要经贡献送达通知）。
    yield* Effect.addFinalizer(() => shutdownStep('jobs').pipe(Effect.andThen(Effect.promise(() => jobs.close()))))
    return { config, context, mcp: admin, secrets, hub, jobs, goals, hooks, bindSessions: runs.bind }
  }),
)

/** 每个 Run 是 FiberMap 中的一个 fiber；关闭时中断：先 abort，再等 Run 结束并提交 run_end，之后才关闭存储。 */
const RunsLive = Layer.effect(
  Runs,
  Effect.gen(function* () {
    const map = yield* FiberMap.make<string>()
    // 后加的先释放：这一步记在 FiberMap 中断全部 Run 之前。
    yield* Effect.addFinalizer(() => shutdownStep('runs'))
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
      onError: (error, context) => log.warn('checkpoint record failed', { sessionId, ...context, error: errorMessage(error) }),
    })
    return { hooks: [tracker.hooks], onEntry: (entry) => tracker.observe(entry) }
  }
}

/**
 * 仅测试（config.testHold：COKO_TEST_TOOLS=1 且 COKO_TEST_HOLD_AFTER_TOOL=<工具名>）：该工具执行完、afterToolCall 的其他 hook（checkpoint 的
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
  testHold: SidecarConfig['testHold'],
): (context: SessionExtensionContext) => SessionExtension {
  if (!testHold) return extensions
  const { beforeCheckpoint } = testHold
  const hold = holdAfterTool(testHold.tool)
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
    const processes = yield* Processes
    // 前台 bash 的进程组登记为 bash（ADR 0012），命令结束后删除。
    const workspaceTools = (yield* Tools)({ wrapExec: (port) => processes.trackExec(port, { kind: 'bash' }) })
    const { config: capabilities, context, mcp, secrets, hub, jobs, goals, hooks, bindSessions } = yield* Assembly
    const log = getLogger(['runtime'])
    const credentials =
      control.mode === 'ipc' ? createIpcCredentialStore({ control, providers: store.providers }) : createEnvCredentialStore({ env, providers: store.providers })
    // M5 的服务（存根，各自的实现接入）。时钟：测试构建且未 --packaged、开启 COKO_TEST_CLOCK 时为可控时钟。
    const testClock: TestClock | undefined = config.testClock && !config.packaged ? createTestClock() : undefined
    if (testClock) log.warn('test clock enabled', { now: testClock.now() })
    const clock: ClockPort = testClock ?? systemClock()
    const subagents = new SubagentService()
    // Worktree（ADR 0016）：git 在宿主执行并登记为 git（ADR 0012）；移除前的 busy 检查读取之后创建的 SessionService 与 JobService。
    const worktrees: WorktreeService = new WorktreeService({
      store,
      git: createGitRunner({ env, track: processes.track }),
      activity: {
        running: (sessionId): boolean => sessions.isRunning(sessionId),
        runningJobs: async (sessionId) => (await jobs.list(sessionId)).some((job) => job.status === 'running'),
      },
    })
    const handoff = new HandoffService()
    const schedules = new ScheduleService({ clock })
    const notifications = new NotificationService({
      store,
      ...(control.mode === 'ipc' ? { send: (message: Parameters<ControlChannel['send']>[0]) => void control.send(message).catch(() => undefined) } : {}),
    })
    // Credential 明文与 Secret 走同一个按值脱敏机制（ADR 0004）：不是凭据形态的自定义密钥被回显时同样替换。
    yield* Effect.acquireRelease(
      Effect.sync(() => registerSecretValues(() => credentials.cachedValues(), { replacement: REDACTED })),
      (unregister) => Effect.sync(unregister),
    )
    const registry = createModelRegistry({ credentials })
    let fallbackModel: SessionModel | undefined
    if (config.fauxScript) {
      const script = config.fauxScript
      fallbackModel = yield* Effect.tryPromise({
        try: () => installFauxProvider(registry, script),
        catch: (error) => new StartupError('faux-script-invalid', errorMessage(error), { cause: error }),
      })
      log.warn('faux provider enabled for tests', { providerId: fallbackModel.providerId })
    }
    const checkpoints = openCheckpointStore(config.dataDir)
    const providers = new ProviderService({ store, registry, invalidateCredential: (id) => credentials.invalidate(id) })
    yield* Effect.promise(() => providers.load())
    const sessions: SessionService = new SessionService({
      store,
      registry,
      hub,
      runs,
      tools: workspaceTools,
      secrets: secrets.provider,
      extensions: withTestHold(checkpointExtensions(checkpoints.snapshots, store), config.testHold),
      checkpoints: checkpoints.files,
      context,
      cwd: worktrees.cwd,
      ...(fallbackModel ? { fallbackModel } : {}),
    })
    // 项目 .coko/settings.json 的 deny / ask 规则作为只读的 project 作用域参与判定（ADR 0008）。
    sessions.permissions.useProjectRules(capabilities)
    bindSessions(sessions)
    // 之后创建的运行时的 bash 可以 run_in_background；追加指令到达时唤醒等待中的 job_output。
    sessions.runs.useJobs({ launcher: (sessionId) => jobs.launcher(sessionId), steered: (sessionId) => jobs.steered(sessionId) })
    // 启动恢复：打开存储之后、开始监听之前（HttpLive 依赖本层）。正常关闭的 Run 已有 run_end，不进入恢复。
    const recovery = yield* Effect.tryPromise({
      // Session 恢复之后：Job 补记 lost，再把未结束的 Goal 暂停（重启后不自动继续）。
      try: () =>
        sessions.recover(store.recovery, [
          ...m5RecoveryHooks({ subagents, worktrees }),
          { name: 'jobs', recover: (source) => jobs.recover(source) },
          { name: 'goals', recover: (source) => goals.recover(source) },
        ]),
      catch: (error) => new StartupError('recovery-failed', errorMessage(error), { cause: error }),
    })
    if (recovery.interruptedRuns > 0 || Object.values(recovery.domains).some((n) => n > 0)) log.warn('startup recovery finished', { ...recovery })
    // 定时器在恢复之后开始；关闭时最先停止（HTTP 之后、Run 之前：本层的释放先于 Runs 层）。
    schedules.start()
    yield* Effect.addFinalizer(() => shutdownStep('timers').pipe(Effect.andThen(Effect.promise(() => schedules.stop()))))
    yield* Effect.addFinalizer(() => Effect.promise(() => hooks.close()))

    // Provider 只经 main 的一次提交保存（ADR 0010）；HTTP 只提供列表与删除。
    serveProviderSave({ control, providers })

    // 获取可用模型：表单中的 Key 只用于这一次请求；编辑且 Key 留空时用已保存的 Credential（ADR 0010）。
    serveProviderModels({ control, credentials })

    return {
      store,
      hub,
      sessions,
      providers,
      settings: new SettingsService(store),
      workspaces: new WorkspaceService(store),
      config: capabilities,
      context: new ContextService({ store, assembly: context, sessions }),
      memories: new MemoryService(store),
      mcp,
      secrets,
      jobs,
      goals,
      clock,
      ...(testClock ? { testClock } : {}),
      hooks,
      subagents,
      schedules,
      worktrees,
      handoff,
      notifications,
    } satisfies Application
  }),
)

const HttpLive = Layer.effect(
  Http,
  Effect.gen(function* () {
    const app = yield* App
    return yield* Effect.acquireRelease(
      Effect.tryPromise({ try: () => startHttpServer(app), catch: (error) => new StartupError('listen-failed', errorMessage(error), { cause: error }) }),
      (server) => Effect.promise(() => server.close()),
    )
  }),
)

/**
 * 装配顺序：Host → Logging → Tools → Store → Processes（孤儿清理）→ Assembly（上下文贡献、Job、Goal）→ Runs → App（M5 服务、启动恢复、
 * 定时器）→ Http；释放顺序相反：停止 HTTP → 停止定时器 → 中断并等待 Run（含子 Run）→ 关闭 Job → 关闭上下文贡献 → 终止登记进程 →
 * 关闭存储 → 刷新日志。
 */
export function sidecarLayer(host: HostShape) {
  return HttpLive.pipe(
    Layer.provideMerge(AppLive),
    Layer.provideMerge(RunsLive),
    Layer.provideMerge(AssemblyLive),
    Layer.provideMerge(ProcessesLive),
    Layer.provideMerge(StoreLive),
    Layer.provideMerge(ToolsLive),
    Layer.provideMerge(LoggingLive),
    Layer.provideMerge(Layer.succeed(Host, host)),
  )
}
