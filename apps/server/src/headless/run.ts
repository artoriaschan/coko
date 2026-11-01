// 无界面运行（ADR 0019，docs/subsystems/headless.md）：在一个进程中装配与 Sidecar 相同的应用层（不监听 HTTP，headlessLayer），提交一条
// 消息（SessionService.submit，trigger submit），经 hub 订阅输出条目与进度，Run 结束后写 result 并按状态退出。
import { realpath, readFile } from 'node:fs/promises'
import { existsSync, realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { Cause, Effect, Exit, ManagedRuntime } from 'effect'
import { getLogger } from '@coko/logging'
import type { ServerMessage, SessionEntryRecord, SessionModel } from '@coko/protocol'
import { credentialEnvName } from '../adapters/credentials.ts'
import { FAUX_PROVIDER_ID } from '../adapters/faux.ts'
import type { Application } from '../application/index.ts'
import { AppError } from '../application/errors.ts'
import { requireSession } from '../application/session-runtimes.ts'
import { ConfigError, parseConfig, type SidecarConfig } from '../config.ts'
import { App, headlessLayer, silentControl, StartupError } from '../runtime/layers.ts'
import { APPROVAL_DENIED_CODE, HEADLESS_DENIED_TEXT } from './approvals.ts'
import { parseHeadlessArgs, USAGE, UsageError, type HeadlessArgs } from './args.ts'
import { createOutput, EMPTY_USAGE, exitCodeOf, finalText, runUsage, type HeadlessResult, type Output } from './output.ts'

const log = getLogger(['headless'])

/** 构建期标志：打包进 dist/sidecar 时由 build.ts 定义（值为是否测试构建）；直接运行源码时不存在。 */
declare const __COKO_TEST_BUILD__: boolean | undefined
const BUNDLED = typeof __COKO_TEST_BUILD__ === 'boolean'

/** 参数或启动错误：进程以 4 退出。 */
class SetupError extends Error {
  override readonly name = 'SetupError'
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

/** 打包产物（Resources/sidecar/headless.mjs）旁的随包 ripgrep（Resources/ripgrep/rg）；源码运行时没有，用内置 grep。 */
function bundledRipgrep(proc: NodeJS.Process): string | undefined {
  if (!BUNDLED || !proc.argv[1]) return undefined
  const candidate = join(dirname(dirname(realpathSync(proc.argv[1]))), 'ripgrep', proc.platform === 'win32' ? 'rg.exe' : 'rg')
  return existsSync(candidate) ? candidate : undefined
}

/**
 * 与 Sidecar 相同的启动配置：日志写 <log-dir>/headless.jsonl。打包产物按 --packaged 运行（发布构建忽略测试钩子变量，测试构建接受，与 Sidecar
 * 相同）；源码运行时接受测试钩子（集成测试）。
 */
function sidecarConfig(args: HeadlessArgs, proc: NodeJS.Process): SidecarConfig {
  const ripgrep = args.ripgrep ?? bundledRipgrep(proc)
  const argv = ['--data-dir', args.dataDir, '--log-dir', args.logDir, ...(ripgrep ? ['--ripgrep', ripgrep] : []), ...(BUNDLED ? ['--packaged'] : [])]
  const config = parseConfig(argv, proc.env)
  return { ...config, logPath: join(args.logDir, 'headless.jsonl') }
}

async function readJson(path: string, what: string): Promise<unknown> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    throw new SetupError('invalid-arguments', `Cannot read ${what} ${path}: ${(error as NodeJS.ErrnoException).code ?? String(error)}`)
  }
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new SetupError('invalid-arguments', `${what} ${path} is not valid JSON`)
  }
}

const setupFromApp = (error: unknown): never => {
  if (error instanceof AppError) throw new SetupError(error.code, error.message)
  throw error
}

const sameDir = async (a: string, b: string) => (await realpath(a).catch(() => a)) === (await realpath(b).catch(() => b))

/** --session 的 Session（须为根 Session，--workspace 给出时须一致），或在 --workspace（不在库中时登记）中新建。 */
async function openSession(app: Application, args: HeadlessArgs): Promise<string> {
  if (args.session) {
    const session = await requireSession(app.store, args.session).catch(() => {
      throw new SetupError('not-found', `Session ${args.session} not found`)
    })
    if (session.parentSessionId !== null) throw new SetupError('child-session', 'A subagent session cannot take messages directly')
    if (args.workspace) {
      const workspace = await app.store.sessions.getWorkspace(session.workspaceId)
      if (!workspace || !(await sameDir(workspace.path, args.workspace)))
        throw new SetupError('invalid-arguments', `Session ${args.session} belongs to another workspace`)
    }
    return session.id
  }
  const path = await realpath(args.workspace!).catch(() => {
    throw new SetupError('invalid-arguments', `Workspace ${args.workspace} does not exist`)
  })
  const known = (await app.workspaces.list()).find((w) => w.path === path)
  const workspace = known ?? (await app.workspaces.register({ path }).catch(setupFromApp))
  if (!known) log.info('workspace registered', { workspaceId: workspace.id })
  return (await app.sessions.create({ workspaceId: workspace.id }).catch(setupFromApp)).id
}

/** Session 将用的模型的 Credential：库中 Provider 的密钥只读 COKO_CREDENTIAL_<ID>（ADR 0010、0019）；缺失时 Run 不开始。 */
async function missingCredential(app: Application, sessionId: string, env: NodeJS.ProcessEnv): Promise<HeadlessResult['error']> {
  const session = await requireSession(app.store, sessionId)
  const model: SessionModel | undefined = session.model ?? (session.modelCleared ? undefined : await app.sessions.defaultModel())
  if (!model || model.providerId === FAUX_PROVIDER_ID) return undefined
  if (!(await app.store.providers.get(model.providerId))) return undefined
  const name = credentialEnvName(model.providerId)
  if (env[name]) return undefined
  return { code: 'no-credential', message: `No API key for provider ${model.providerId}: set ${name}` }
}

interface Watch {
  /** 根 Session 的 run_end 到达（或 Run 没能开始）。 */
  ended: Promise<{ status: HeadlessResult['status']; error?: { code: string; message: string } }>
  denied: () => boolean
  start(runId: string): void
  close(): void
}

/** 订阅根 Session（及其派发的子代理 Session）：stream-json 转发根 Session 的消息；记录 headless 拒绝与轮次。 */
function watch(app: Application, rootId: string, args: HeadlessArgs, output: Output): Watch {
  const subscriptions = new Map<string, () => void>()
  let runId: string | undefined
  let denied = false
  let stopped = false
  let assistantTurns = 0
  const early: { runId: string; status: HeadlessResult['status']; error?: { code: string; message: string } }[] = []
  let finish!: (value: Awaited<Watch['ended']>) => void
  const ended = new Promise<Awaited<Watch['ended']>>((resolve) => (finish = resolve))
  const stop = (code: 'approval_denied' | 'max_turns', message: string) => {
    if (stopped) return
    stopped = true
    app.sessions.runs.stopAfterBatch(rootId, { code, message })
  }
  const onEntry = (sessionId: string, entry: SessionEntryRecord) => {
    if (entry.kind === 'agent_start' && !subscriptions.has((entry.payload as { agentId: string }).agentId)) {
      const childId = (entry.payload as { agentId: string }).agentId
      subscriptions.set(
        childId,
        app.hub.subscribe(childId, (message) => message.type === 'entry' && onEntry(childId, message.entry)),
      )
    }
    if (entry.kind === 'approval_decision' && (entry.payload as { by?: string }).by === 'headless') {
      denied = true
      log.info('approval denied without an approver', { sessionId, requestId: (entry.payload as { requestId: string }).requestId })
      if (args.onApproval === 'fail') {
        // 子代理先停（其 agent 调用随之返回），根 Session 在本批之后停。
        if (sessionId !== rootId) app.sessions.runs.stopAfterBatch(sessionId, { code: APPROVAL_DENIED_CODE, message: HEADLESS_DENIED_TEXT })
        stop(APPROVAL_DENIED_CODE, 'A tool call needed approval and --on-approval fail was given')
      }
    }
    if (sessionId === rootId && args.maxTurns && entry.kind === 'message' && entry.runId === runId) {
      const payload = entry.payload as { role: string; stopReason?: string }
      if (payload.role === 'assistant' && ++assistantTurns >= args.maxTurns && payload.stopReason === 'toolUse')
        stop('max_turns', `The run reached --max-turns ${args.maxTurns}`)
    }
  }
  const onRoot = (message: ServerMessage) => {
    output.message(message)
    if (message.type === 'entry') onEntry(rootId, message.entry)
    if (message.type === 'progress' && message.event.type === 'run_end') {
      const end = { runId: message.runId, status: message.event.status, ...(message.event.error ? { error: message.event.error } : {}) }
      if (runId === undefined) early.push(end)
      else if (end.runId === runId) finish(end)
    }
  }
  subscriptions.set(rootId, app.hub.subscribe(rootId, onRoot))
  return {
    ended,
    denied: () => denied,
    start(id) {
      runId = id
      const end = early.find((e) => e.runId === id)
      if (end) finish(end)
    },
    close() {
      for (const unsubscribe of subscriptions.values()) unsubscribe()
      subscriptions.clear()
    },
  }
}

export async function runHeadless(proc: NodeJS.Process = process): Promise<void> {
  // stdout 只给运行结果：任何 console 输出（含日志 sink 不可用时的退回）改到 stderr。
  console.log = console.info = console.debug = console.error
  const started = Date.now()
  const output0 = (format: HeadlessArgs['output']) => createOutput(format, proc.stdout, proc.stderr)

  let args: HeadlessArgs
  try {
    args = parseHeadlessArgs(proc.argv.slice(2), proc.cwd())
  } catch (error) {
    proc.stderr.write(`coko headless: ${error instanceof UsageError ? error.message : String(error)}\n${USAGE}`)
    return proc.exit(4)
  }
  const output = output0(args.output)
  const fail = async (code: string, message: string, exitCode: number, sessionId: string | null = null) => {
    output.result({
      type: 'result',
      status: 'failed',
      sessionId,
      runId: null,
      text: '',
      usage: EMPTY_USAGE,
      durationMs: Date.now() - started,
      error: { code, message },
    })
    if (args.output !== 'text') proc.stderr.write(`coko headless: ${code}: ${message}\n`)
    await output.flush()
    proc.exit(exitCode)
  }

  let config: SidecarConfig
  let prompt: string
  let providerConfig: unknown
  try {
    config = sidecarConfig(args, proc)
    prompt =
      args.prompt ??
      (await readFile(args.promptFile!, 'utf8').catch(() => {
        throw new SetupError('invalid-arguments', `Cannot read --prompt-file ${args.promptFile}`)
      }))
    if (prompt.trim() === '') throw new SetupError('invalid-arguments', 'The prompt is empty')
    if (args.providerConfig) providerConfig = await readJson(args.providerConfig, '--provider-config')
  } catch (error) {
    if (error instanceof ConfigError || error instanceof SetupError)
      return fail(error instanceof SetupError ? error.code : 'invalid-arguments', error.message, 4)
    throw error
  }

  const runtime = ManagedRuntime.make(headlessLayer({ config, control: silentControl, env: proc.env, headless: { deniedText: HEADLESS_DENIED_TEXT } }))
  const startup = await runtime.runPromiseExit(
    Effect.gen(function* () {
      return yield* App
    }),
  )
  if (Exit.isFailure(startup)) {
    const error = Cause.squash(startup.cause)
    await runtime.dispose().catch(() => undefined)
    return fail(error instanceof StartupError ? error.code : 'startup-failed', error instanceof Error ? error.message : String(error), 4)
  }
  const app = startup.value
  const dispose = () => runtime.dispose().catch((error: unknown) => log.error('headless shutdown failed', { error: String(error) }))

  // SIGINT / SIGTERM：中止 Run，等待 run_end，以 2 退出（Run 还没开始时开始后立即中止）。
  let signalled: string | undefined
  let rootId: string | undefined
  const onSignal = (signal: string) => {
    if (signalled) return
    signalled = signal
    log.info('headless stopping', { signal })
    if (rootId) void app.sessions.abort(rootId).catch(() => undefined)
  }
  proc.on('SIGINT', () => onSignal('SIGINT'))
  proc.on('SIGTERM', () => onSignal('SIGTERM'))

  let sessionId: string
  try {
    if (providerConfig !== undefined) await app.providers.upsertFromConfig(providerConfig as never).catch(setupFromApp)
    sessionId = await openSession(app, args)
    if (args.model) await app.sessions.setModel(sessionId, args.model).catch(setupFromApp)
    if (args.permissionMode) await app.sessions.setPermissionMode(sessionId, args.permissionMode).catch(setupFromApp)
  } catch (error) {
    await dispose()
    if (error instanceof SetupError) return fail(error.code, error.message, 4)
    throw error
  }
  rootId = sessionId

  const missing = await missingCredential(app, sessionId, proc.env)
  if (missing) {
    log.warn('headless run not started', { sessionId, code: missing.code })
    await dispose()
    return fail(missing.code, missing.message, 1, sessionId)
  }

  const watcher = watch(app, sessionId, args, output)
  let runId: string
  try {
    const submitted = await app.sessions.submit(sessionId, prompt)
    if (!('runId' in submitted)) {
      watcher.close()
      output.result({ type: 'result', status: 'completed', sessionId, runId: null, text: '', usage: EMPTY_USAGE, durationMs: Date.now() - started })
      await output.flush()
      await dispose()
      return proc.exit(0)
    }
    runId = submitted.runId
  } catch (error) {
    watcher.close()
    await dispose()
    const appError = error instanceof AppError ? error : undefined
    return fail(appError?.code ?? 'internal', appError?.message ?? 'Internal error', 1, sessionId)
  }
  watcher.start(runId)
  log.info('headless run started', { sessionId, runId, output: args.output })
  if (signalled) void app.sessions.abort(sessionId).catch(() => undefined)

  const end = await watcher.ended
  watcher.close()
  const entries = await app.store.sessions.listEntries(sessionId)
  const result: HeadlessResult = {
    type: 'result',
    status: end.status,
    sessionId,
    runId,
    text: finalText(entries, runId),
    usage: runUsage(entries, runId),
    durationMs: Date.now() - started,
    ...(end.error ? { error: end.error } : {}),
    ...(watcher.denied() ? { approvalDenied: true } : {}),
  }
  output.result(result)
  await output.flush()
  log.info('headless run finished', { sessionId, runId, status: end.status, approvalDenied: watcher.denied() })
  await dispose()
  proc.exit(signalled ? 2 : exitCodeOf(result, args.onApproval === 'fail'))
}
