// 外部 Hook（ADR 0013；docs/subsystems/hooks.md）的应用服务：全局配置（设置键 hooks）与项目 Hook（<cwd>/.coko/settings.json 的 hooks 键，按
// Workspace 与 digest 逐条批准，设置键 hooks.approvals.<workspaceId>）、能力开关 hooks.enabled（只在全局）、执行（adapters/hook-runner.ts）、
// PreToolUse / PermissionRequest 的权限端口与 PostToolUse(Failure) 的观察 hook、生命周期事件（UserPromptSubmit、Stop、PreCompact、Notification）、
// continue: false 的停止（hook_stopped），以及有结果的执行的 hook_run 条目。
import {
  aggregateVerdict,
  hookTimeoutMs,
  interpretHookResult,
  ONSTOP_CONTINUE_LIMIT,
  parseHooksConfig,
  selectHooks,
  type CapabilityConfig,
  type CompactInfo,
  type CompactVerdict,
  type HookCondition,
  type HookResult,
  type HookToolCall,
  type HookVerdict,
  type LoadedHook,
  type PermissionHookPort,
  type PermissionMode,
  type ResourceDiagnostic,
  type RunError,
  type SourcedHookResult,
  type StopContinue,
  type StopInfo,
  type ToolHooks,
} from '@coko/agent'
import { getLogger, redactSecretsDeep, redactText } from '@coko/logging'
import {
  HOOK_RUN_MESSAGE_MAX,
  hookApprovalsSetting,
  HOOKS_SETTING,
  HooksConfig,
  parsePermissionRule,
  type ApproveHookRequest,
  type HookEvent,
  type HookOutcome,
  type HookRunPayload,
  type HooksResponse,
  type ProjectHookEntry,
  type UpdateHooksRequest,
} from '@coko/protocol'
import type { JsonValue, SessionStore } from '@coko/session'
import { Value } from 'typebox/value'
import type { HookRunner } from '../adapters/hook-runner.ts'
import type { ConfigService } from './config.ts'
import type { SessionEntryAccess } from './context/types.ts'
import { AppError, errorMessage } from './errors.ts'

const log = getLogger(['application', 'hooks'])

/** 追加给模型的 Hook 文本（additionalContext、stderr）合计上限（字符）。 */
export const HOOK_CONTEXT_MAX_CHARS = 10_000
/** PreCompact 的 stdout 追加为摘要要求的上限（字符）。 */
export const HOOK_COMPACT_INSTRUCTIONS_MAX_CHARS = 4_000
/** UserPromptSubmit 拒绝提交的原因上限（字符，HTTP 400 hook-blocked）。 */
export const HOOK_BLOCK_REASON_MAX_CHARS = 2_048
/** Stop 的 block 作为 user message 送达时的开头（reason 或 stderr 在其后）。 */
export const STOP_FEEDBACK_PREFIX = 'Stop hook feedback:'
/** continue: false 没有 stopReason 时 run_end 的 message。 */
export const HOOK_STOPPED_TEXT = 'Stopped by a hook'
/** Stop 达到每 Run 的继续上限后，block 被忽略时 hook_run.message 的文本。 */
export const STOP_LIMIT_TEXT = `Ignored: the run already continued ${ONSTOP_CONTINUE_LIMIT} times because of Stop hooks`

/** 生命周期事件需要的 Session 能力（AppLive 创建 SessionService 后 bind 一次）。 */
export interface HookSessionHost {
  /** 进行中的 Run 本批完成后以 paused 加该 error 结束；没有进行中的 Run 时 false。 */
  stopAfterBatch(sessionId: string, error: RunError): boolean
  /** Session 当前的权限模式（生命周期事件输入的 permission_mode）。 */
  permissionMode(sessionId: string): Promise<PermissionMode>
  /** Session 的作用域（Notification 在 Run 之外触发时用）。 */
  scope(sessionId: string): Promise<HookScope>
}

/** UserPromptSubmit 的结论：reject 拒绝提交；context 作为 user message 中单独标注的文本块。 */
export type PromptVerdict = void | { reject: string } | { context: string }

/** Hook 运行时的作用域：Workspace、工作目录、Session 与当时的有效配置（ContextScope 的一部分）。 */
export interface HookScope {
  workspaceId: string
  cwd: string
  sessionId?: string
  config: CapabilityConfig
  parentSessionId?: string
  subagent?: { name: string }
}

export interface HookServiceOptions {
  store: Pick<SessionStore, 'settings'>
  config: Pick<ConfigService, 'effective' | 'projectHooks'>
  runner: HookRunner
  /** hook_run 条目的提交（与运行时条目相同的脱敏后入库并推送）；省略时不记录（单元测试）。 */
  entries?: Pick<SessionEntryAccess, 'commit'>
}

/** 一个 Run 的 Hook 状态：开始后第一次需要时加载一次（之后改动的配置与批准从下一个 Run 生效）。 */
export interface RunHooks {
  readonly hooks: Promise<LoadedHook[]>
  /** 本 Run 的 runId（第一次模型请求前得知；hook_run 条目据此归属）。 */
  runId?: string
  /** PreToolUse 时记下的调用事实，PostToolUse 复用（规则组名、模式与 if 的匹配）。 */
  calls: Map<string, { ruleTool: string; permissionMode?: PermissionMode; matchesRule?: (condition: HookCondition) => boolean }>
}

/** 用协议的规则语法解析 if（与权限规则同一解析）。 */
const parseRule = (text: string): HookCondition | undefined => {
  const rule = parsePermissionRule(text)
  return rule ? { tool: rule.tool, ...(rule.content === undefined ? {} : { content: rule.content }) } : undefined
}

/** 设置键 hooks.approvals.<workspaceId> 的值：批准的 digest 与批准时的位置（早期只存 digest 字符串）。 */
function approvalsOf(value: unknown): { digest: string; hookId?: string }[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((v): { digest: string; hookId?: string }[] => {
    if (typeof v === 'string') return [{ digest: v }]
    if (typeof v === 'object' && v !== null && typeof (v as { digest?: unknown }).digest === 'string') {
      const { digest, hookId } = v as { digest: string; hookId?: unknown }
      return [{ digest, ...(typeof hookId === 'string' ? { hookId } : {}) }]
    }
    return []
  })
}

const truncate = (text: string, max: number) => (text.length > max ? text.slice(0, max - 1) + '…' : text)

/** 有结果的执行在 hook_run.message 中显示的文本（已脱敏、≤ 2 KB）。 */
function messageOf(result: HookResult): string | undefined {
  const text = result.systemMessage ?? result.stopReason ?? result.reason ?? result.context ?? result.text
  return text === undefined ? undefined : truncate(redactText(text), HOOK_RUN_MESSAGE_MAX)
}

export class HookService {
  readonly #store: HookServiceOptions['store']
  readonly #config: HookServiceOptions['config']
  readonly #runner: HookRunner
  readonly #entries: HookServiceOptions['entries']
  /** 进行中的 Hook 执行（关闭时中止并等待）。 */
  readonly #running = new Set<{ controller: AbortController; done: Promise<unknown> }>()
  #host: HookSessionHost | undefined
  /** UserPromptSubmit 的 continue: false：Run 还没开始，该 Session 的下一个 Run 在第一次请求前停止（hook_stopped）。 */
  readonly #pendingStops = new Map<string, RunError>()

  constructor(options: HookServiceOptions) {
    this.#store = options.store
    this.#config = options.config
    this.#runner = options.runner
    this.#entries = options.entries
  }

  /** 装配时接上 Session 能力（停止 Run、权限模式、作用域）；之前触发的生命周期事件没有这些能力（只运行与记录）。 */
  bind(host: HookSessionHost): void {
    this.#host = host
  }

  // ---- 配置与批准（/api/hooks） ----

  /** GET /api/hooks：给出 project（Workspace 与 Session 的工作目录）时含该目录的项目 Hook 与批准状态。 */
  async get(project?: { workspaceId: string; cwd: string }): Promise<HooksResponse> {
    const [effective, global, loaded] = await Promise.all([
      this.#config.effective(),
      this.#global(),
      project ? this.#project(project.workspaceId, project.cwd) : undefined,
    ])
    return {
      enabled: effective.hooks.enabled,
      global: { hooks: global.hooks, revision: global.revision, diagnostics: global.diagnostics },
      ...(loaded ? { project: { path: loaded.path, entries: loaded.entries, diagnostics: loaded.diagnostics } } : {}),
    }
  }

  /** PUT /api/hooks：整体替换全局配置。不合 schema 或有诊断时 400（details.diagnostics），revision 不一致时 409。 */
  async update(request: UpdateHooksRequest): Promise<HooksResponse> {
    const parsed = parseHooksConfig(request.hooks, 'global', { parseRule })
    if (parsed.diagnostics.length > 0)
      throw new AppError('bad-request', parsed.diagnostics.map((d) => d.message).join('; '), { diagnostics: parsed.diagnostics })
    await this.#store.settings.set(HOOKS_SETTING, request.hooks as JsonValue, request.expectedRevision)
    log.info('global hooks saved', { revision: request.expectedRevision + 1, hooks: parsed.hooks.length })
    return this.get()
  }

  /** POST /api/hooks/approvals：digest 须为 cwd 下项目文件中的一条 Hook，否则 409 digest-mismatch。 */
  async approve(request: Pick<ApproveHookRequest, 'workspaceId' | 'digest'>, cwd: string): Promise<void> {
    const loaded = await this.#project(request.workspaceId, cwd)
    if (!loaded.entries.some((entry) => entry.digest === request.digest))
      throw new AppError('digest-mismatch', 'The project hook changed or does not exist; review it again', { digest: request.digest })
    const key = hookApprovalsSetting(request.workspaceId)
    if (loaded.approvals.some((a) => a.digest === request.digest)) return
    // 记下批准时的位置（hookId）：同一位置的内容改动后显示为"已改动"。
    const hookIds = loaded.entries.filter((entry) => entry.digest === request.digest).map((entry) => entry.hookId)
    const next = [...loaded.approvals, ...hookIds.map((hookId) => ({ digest: request.digest, hookId }))]
    await this.#store.settings.set(key, next as JsonValue, loaded.approvalsRevision)
    log.info('project hook approved', { workspaceId: request.workspaceId })
  }

  async #global(): Promise<{ hooks: HooksConfig; revision: number; parsed: LoadedHook[]; diagnostics: ResourceDiagnostic[] }> {
    const setting = await this.#store.settings.get(HOOKS_SETTING)
    if (!setting) return { hooks: {}, revision: 0, parsed: [], diagnostics: [] }
    if (!Value.Check(HooksConfig, setting.value)) {
      log.warn('global hooks ignored: invalid value', { revision: setting.revision })
      return { hooks: {}, revision: setting.revision, parsed: [], diagnostics: [] }
    }
    const parsed = parseHooksConfig(setting.value, 'global', { parseRule })
    return { hooks: setting.value, revision: setting.revision, parsed: parsed.hooks, diagnostics: parsed.diagnostics }
  }

  async #project(workspaceId: string, cwd: string) {
    const [file, approvalsSetting] = await Promise.all([this.#config.projectHooks(cwd), this.#store.settings.get(hookApprovalsSetting(workspaceId))])
    const approvals = approvalsOf(approvalsSetting?.value)
    const approved = new Set(approvals.map((a) => a.digest))
    const parsed = parseHooksConfig(file.hooks, 'project', { parseRule, path: file.path })
    const entries: ProjectHookEntry[] = parsed.hooks.map((hook) => ({
      hookId: hook.hookId,
      event: hook.event,
      ...(hook.matcher === undefined ? {} : { matcher: hook.matcher }),
      ...(hook.if === undefined ? {} : { if: hook.if }),
      command: hook.command,
      ...(hook.timeout === undefined ? {} : { timeout: hook.timeout }),
      digest: hook.digest,
      approved: approved.has(hook.digest),
      ...(!approved.has(hook.digest) && approvals.some((a) => a.hookId === hook.hookId) ? { changed: true as const } : {}),
    }))
    return { path: file.path, entries, hooks: parsed.hooks, diagnostics: parsed.diagnostics, approvals, approvalsRevision: approvalsSetting?.revision ?? 0 }
  }

  // ---- 运行 ----

  /** 该作用域生效的 Hook：能力关闭时没有；全局 Hook 加上已批准的项目 Hook（未批准的不运行）。 */
  async load(scope: Pick<HookScope, 'workspaceId' | 'cwd' | 'config'>): Promise<LoadedHook[]> {
    if (!scope.config.hooks.enabled) return []
    const [global, project] = await Promise.all([this.#global(), this.#project(scope.workspaceId, scope.cwd)])
    return [...global.parsed, ...project.hooks.filter((hook) => project.approvals.some((a) => a.digest === hook.digest))]
  }

  /** 新的 Run 状态（Hook 在第一次需要时加载）。 */
  runState(scope: HookScope): RunHooks {
    let hooks: Promise<LoadedHook[]> | undefined
    const load = () =>
      (hooks ??= this.load(scope).catch((error: unknown) => {
        log.warn('hooks load failed', { error: errorMessage(error) })
        return []
      }))
    return {
      get hooks() {
        return load()
      },
      calls: new Map(),
    }
  }

  /** 并行运行匹配的 Hook，解释结果并记录有结果的执行。 */
  async run(
    scope: HookScope,
    state: RunHooks,
    event: HookEvent,
    hooks: readonly LoadedHook[],
    input: Record<string, unknown>,
    signal?: AbortSignal,
    adjust?: (result: HookResult) => { result: HookResult; message?: string },
  ): Promise<SourcedHookResult[]> {
    if (hooks.length === 0) return []
    const stdin = JSON.stringify(redactSecretsDeep({ ...this.#common(scope, event), ...input }))
    const results = await Promise.all(
      hooks.map(async (hook) => {
        const controller = new AbortController()
        const abort = () => controller.abort()
        signal?.addEventListener('abort', abort, { once: true })
        const done = this.#runner
          .run({
            command: hook.command,
            cwd: scope.cwd,
            env: { COKO_PROJECT_DIR: scope.cwd, COKO_HOOK_EVENT: event, ...(scope.sessionId ? { COKO_SESSION_ID: scope.sessionId } : {}) },
            input: stdin,
            timeoutMs: hookTimeoutMs(hook),
            ...(scope.sessionId ? { sessionId: scope.sessionId } : {}),
            signal: controller.signal,
          })
          .catch((error: unknown) => ({ exitCode: null, stdout: '', stderr: '', timedOut: false, durationMs: 0, error: errorMessage(error) }))
        const entry = { controller, done }
        this.#running.add(entry)
        const outcome = await done.finally(() => {
          this.#running.delete(entry)
          signal?.removeEventListener('abort', abort)
        })
        const interpreted = interpretHookResult(event, outcome)
        const adjusted = adjust ? adjust(interpreted) : { result: interpreted }
        const result = adjusted.result
        const command = redactText(hook.command)
        if (result.outcome)
          await this.#record(scope, state, {
            hook,
            command,
            result,
            exitCode: outcome.exitCode,
            durationMs: outcome.durationMs,
            ...(adjusted.message === undefined ? {} : { message: adjusted.message }),
          })
        else log.debug('hook ran without a decision', { event, hookId: hook.hookId, durationMs: outcome.durationMs })
        return { hookId: hook.hookId, source: hook.source, command, result }
      }),
    )
    const stopped = results.find((r) => r.result.stop)
    if (stopped && scope.sessionId) this.#requestStop(scope.sessionId, event, stopped.result.stopReason)
    return results
  }

  /**
   * continue: false（任一 Hook）：进行中的 Run 本批完成后以 paused + hook_stopped 结束。UserPromptSubmit 时 Run 还没开始：记下，该 Session 的
   * 下一个 Run 在第一次请求前停止（user message 已提交）。
   */
  #requestStop(sessionId: string, event: HookEvent, reason: string | undefined): void {
    const error: RunError = { code: 'hook_stopped', message: reason ? truncate(redactText(reason), HOOK_RUN_MESSAGE_MAX) : HOOK_STOPPED_TEXT }
    if (event === 'UserPromptSubmit') this.#pendingStops.set(sessionId, error)
    else if (!this.#host?.stopAfterBatch(sessionId, error)) return
    log.info('run stop requested by hook', { sessionId, event })
  }

  /** 该 Session 记下的停止（UserPromptSubmit 的 continue: false）；取出后清除。 */
  takePendingStop(sessionId: string): RunError | undefined {
    const error = this.#pendingStops.get(sessionId)
    this.#pendingStops.delete(sessionId)
    return error
  }

  /** 公共输入字段：session_id、cwd、permission_mode（工具事件另给）、hook_event_name；子 Session 另有 parent_session_id、agent_type。 */
  #common(scope: HookScope, event: HookEvent): Record<string, unknown> {
    return {
      ...(scope.sessionId ? { session_id: scope.sessionId } : {}),
      cwd: scope.cwd,
      hook_event_name: event,
      ...(scope.parentSessionId ? { parent_session_id: scope.parentSessionId } : {}),
      ...(scope.subagent ? { agent_type: scope.subagent.name } : {}),
    }
  }

  async #record(
    scope: HookScope,
    state: RunHooks,
    run: { hook: LoadedHook; command: string; result: HookResult; exitCode: number | null; durationMs: number; message?: string },
  ): Promise<void> {
    if (!scope.sessionId || !this.#entries) return
    const { hook, result } = run
    let outcome: HookOutcome = result.outcome!
    let message = run.message ?? messageOf(result)
    // 项目 Hook 的 allow 不参与聚合（只收紧）：记录为放行但注明被忽略。
    if (hook.source === 'project' && result.decision === 'allow') message = 'Ignored: a project hook cannot allow a call'
    if (hook.event === 'PermissionRequest' && result.decision === 'allow') outcome = 'allowed'
    const payload: HookRunPayload = {
      event: hook.event,
      hookId: hook.hookId,
      source: hook.source,
      command: run.command,
      outcome,
      ...(run.exitCode === null ? {} : { exitCode: run.exitCode }),
      durationMs: Math.max(0, Math.round(run.durationMs)),
      ...(message === undefined ? {} : { message }),
    }
    try {
      await this.#entries.commit(scope.sessionId, { kind: 'hook_run', ...(state.runId ? { runId: state.runId } : {}), payload })
    } catch (error) {
      log.warn('hook_run record failed', { sessionId: scope.sessionId, hookId: hook.hookId, error: errorMessage(error) })
    }
  }

  /** PreToolUse 与 PermissionRequest 的权限端口（gate 调用）。 */
  permissionPort(scope: HookScope, state: RunHooks): PermissionHookPort {
    const tool = async (event: 'PreToolUse' | 'PermissionRequest', call: HookToolCall, signal?: AbortSignal): Promise<HookVerdict> => {
      if (event === 'PreToolUse')
        state.calls.set(call.toolCallId, {
          ruleTool: call.ruleTool,
          ...(call.permissionMode ? { permissionMode: call.permissionMode } : {}),
          ...(call.matchesRule ? { matchesRule: call.matchesRule } : {}),
        })
      const selected = selectHooks(await state.hooks, event, {
        names: [call.toolName, call.ruleTool],
        ...(call.matchesRule ? { matchesRule: call.matchesRule } : {}),
      })
      if (selected.length === 0) return {}
      const results = await this.run(
        scope,
        state,
        event,
        selected,
        {
          ...(call.permissionMode ? { permission_mode: call.permissionMode } : {}),
          tool_name: call.toolName,
          tool_input: call.input,
          tool_use_id: call.toolCallId,
        },
        signal,
      )
      const verdict = aggregateVerdict(results)
      return verdict.reason === undefined ? verdict : { ...verdict, reason: truncate(redactText(verdict.reason), HOOK_RUN_MESSAGE_MAX) }
    }
    return {
      preToolUse: (call, signal) => tool('PreToolUse', call, signal),
      permissionRequest: (call, signal) => tool('PermissionRequest', call, signal),
    }
  }

  /** PostToolUse / PostToolUseFailure：结果脱敏之后、提交之前；additionalContext 与 exit 2 的 stderr 追加到结果末尾的 <hook-feedback>。 */
  observeHook(scope: HookScope, state: RunHooks): ToolHooks {
    return {
      afterToolCall: async (context, signal) => {
        const facts = state.calls.get(context.toolCall.id)
        state.calls.delete(context.toolCall.id)
        const event: HookEvent = context.isError ? 'PostToolUseFailure' : 'PostToolUse'
        const selected = selectHooks(await state.hooks, event, {
          names: [context.toolCall.name, facts?.ruleTool ?? context.toolCall.name],
          ...(facts?.matchesRule ? { matchesRule: facts.matchesRule } : {}),
        })
        if (selected.length === 0) return undefined
        const response = { content: context.result.content, ...(context.result.details === undefined ? {} : { details: context.result.details }) }
        const results = await this.run(
          scope,
          state,
          event,
          selected,
          {
            ...(facts?.permissionMode ? { permission_mode: facts.permissionMode } : {}),
            tool_name: context.toolCall.name,
            tool_input: context.args,
            tool_use_id: context.toolCall.id,
            tool_response: response,
            ...(context.isError ? { error: context.result.content.map((b) => (b.type === 'text' ? b.text : '')).join('') } : {}),
          },
          signal,
        )
        const feedback = results.flatMap((r) => (r.result.context ? [r.result.context] : []))
        if (feedback.length === 0) return undefined
        const text = truncate(redactText(feedback.join('\n\n')), HOOK_CONTEXT_MAX_CHARS)
        return { content: [...context.result.content, { type: 'text', text: `<hook-feedback>\n${text}\n</hook-feedback>` }] }
      },
    }
  }

  // ---- 生命周期事件 ----

  /** 生命周期事件输入的 permission_mode（Session 当前模式）；没有 Session 能力时省略。 */
  async #mode(scope: HookScope): Promise<Record<string, unknown>> {
    if (!scope.sessionId || !this.#host) return {}
    try {
      return { permission_mode: await this.#host.permissionMode(scope.sessionId) }
    } catch {
      return {}
    }
  }

  /**
   * UserPromptSubmit（trigger submit 的输入展开之后、开始 Run 之前；Goal Round、定时任务与子代理的 Run 不经过）：exit 2 或 decision: block
   * 拒绝提交（原因 ≤ 2 KB）；additionalContext 合并（≤ 10 000 字符，按值脱敏）作为 user message 中单独标注的文本块。
   */
  async userPromptSubmit(scope: HookScope, state: RunHooks, prompt: string): Promise<PromptVerdict> {
    if (scope.sessionId) this.#pendingStops.delete(scope.sessionId)
    if (scope.parentSessionId) return undefined
    const selected = selectHooks(await state.hooks, 'UserPromptSubmit')
    if (selected.length === 0) return undefined
    const results = await this.run(scope, state, 'UserPromptSubmit', selected, { ...(await this.#mode(scope)), prompt })
    const blocked = results.filter((r) => r.result.block)
    if (blocked.length > 0) {
      if (scope.sessionId) this.#pendingStops.delete(scope.sessionId)
      const reasons = blocked.flatMap((r) => (r.result.reason ? [r.result.reason] : []))
      return { reject: truncate(redactText(reasons.join('\n') || 'Blocked by a UserPromptSubmit hook'), HOOK_BLOCK_REASON_MAX_CHARS) }
    }
    const context = results.flatMap((r) => (r.result.context ? [r.result.context] : []))
    return context.length > 0 ? { context: truncate(redactText(context.join('\n\n')), HOOK_CONTEXT_MAX_CHARS) } : undefined
  }

  /**
   * Stop（根 Session 的对话 Run 正常结束之前）：exit 2 的 stderr 或 decision: block 的 reason 作为 user message 送达、Run 继续（hook_run continued）。
   * 每 Run 至多继续 ONSTOP_CONTINUE_LIMIT 次（运行时执行），之后的 block 被忽略、记 warn；continue: false 优先于 block。子 Session 不触发（SubagentStop）。
   */
  async stop(scope: HookScope, state: RunHooks, info: StopInfo): Promise<void | StopContinue> {
    if (scope.parentSessionId || info.trigger === 'subagent' || info.trigger === 'compact' || info.trigger === 'handoff') return undefined
    const selected = selectHooks(await state.hooks, 'Stop')
    if (selected.length === 0) return undefined
    const limited = info.continuations >= ONSTOP_CONTINUE_LIMIT
    const results = await this.run(
      scope,
      state,
      'Stop',
      selected,
      { ...(await this.#mode(scope)), stop_hook_active: info.stopHookActive },
      undefined,
      (result) =>
        !result.block || result.stop ? { result } : limited ? { result, message: STOP_LIMIT_TEXT } : { result: { ...result, outcome: 'continued' } },
    )
    if (results.some((r) => r.result.stop)) return undefined
    const blocked = results.filter((r) => r.result.block)
    if (blocked.length === 0) return undefined
    if (limited) {
      log.warn('stop hook continuation ignored: limit reached', { sessionId: scope.sessionId, runId: info.runId, limit: ONSTOP_CONTINUE_LIMIT })
      return undefined
    }
    const reasons = blocked.flatMap((r) => (r.result.reason ? [r.result.reason] : []))
    const text = truncate(redactText(reasons.join('\n\n') || 'A Stop hook asked to continue'), HOOK_CONTEXT_MAX_CHARS)
    return { continue: [{ type: 'text', text: `${STOP_FEEDBACK_PREFIX}\n${text}` }] }
  }

  /**
   * PreCompact（手动与自动压缩之前；溢出恢复不触发）：matcher 对象为 manual / auto。exit 2 阻止（手动：400 hook-blocked，自动：跳过本次压缩）；
   * exit 0 的 stdout 按文本（不解析 JSON）按值脱敏后追加为摘要要求（合计 ≤ 4 000 字符）。
   */
  async preCompact(scope: HookScope, state: RunHooks, info: CompactInfo): Promise<void | CompactVerdict> {
    const selected = selectHooks(await state.hooks, 'PreCompact', { names: [info.trigger] })
    if (selected.length === 0) return undefined
    const results = await this.run(scope, state, 'PreCompact', selected, {
      ...(await this.#mode(scope)),
      trigger: info.trigger,
      custom_instructions: info.instructions ?? '',
    })
    const blocked = results.filter((r) => r.result.block)
    if (blocked.length > 0) {
      const reasons = blocked.flatMap((r) => (r.result.reason ? [r.result.reason] : []))
      return { block: truncate(redactText(reasons.join('\n') || 'Blocked by a PreCompact hook'), HOOK_BLOCK_REASON_MAX_CHARS) }
    }
    const text = results.flatMap((r) => (r.result.text ? [r.result.text] : []))
    return text.length > 0 ? { instructions: truncate(redactText(text.join('\n\n')), HOOK_COMPACT_INSTRUCTIONS_MAX_CHARS) } : undefined
  }

  /**
   * Notification（Coko 发出桌面通知时；只观测）：matcher 对象为通知类别，输入 notification_type、title、message（已脱敏）。不等待结果，
   * 失败只记录（hook_run error / timeout），不影响通知。
   */
  notification(input: { kind: string; sessionId: string; title: string; body: string }): Promise<void> {
    const task = async () => {
      if (!this.#host) return
      const scope = await this.#host.scope(input.sessionId)
      const state = this.runState(scope)
      const selected = selectHooks(await state.hooks, 'Notification', { names: [input.kind] })
      if (selected.length === 0) return
      await this.run(scope, state, 'Notification', selected, {
        ...(await this.#mode(scope)),
        notification_type: input.kind,
        title: input.title,
        message: input.body,
      })
    }
    return task().catch((error: unknown) => log.warn('notification hooks failed', { sessionId: input.sessionId, error: errorMessage(error) }))
  }

  /** 有序关闭（上下文贡献之前）：中止进行中的 Hook 进程并等待其进程组结束。 */
  async close(): Promise<void> {
    const running = [...this.#running]
    for (const entry of running) entry.controller.abort()
    await Promise.allSettled(running.map((entry) => entry.done))
  }
}
