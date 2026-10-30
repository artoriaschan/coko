// 外部 Hook（ADR 0013；docs/subsystems/hooks.md）的应用服务：全局配置（设置键 hooks）与项目 Hook（<cwd>/.coko/settings.json 的 hooks 键，按
// Workspace 与 digest 逐条批准，设置键 hooks.approvals.<workspaceId>）、能力开关 hooks.enabled（只在全局）、执行（adapters/hook-runner.ts）、
// PreToolUse / PermissionRequest 的权限端口与 PostToolUse(Failure) 的观察 hook，以及有结果的执行的 hook_run 条目。
import {
  aggregateVerdict,
  hookTimeoutMs,
  interpretHookResult,
  parseHooksConfig,
  selectHooks,
  type CapabilityConfig,
  type HookCondition,
  type HookResult,
  type HookToolCall,
  type HookVerdict,
  type LoadedHook,
  type PermissionHookPort,
  type PermissionMode,
  type ResourceDiagnostic,
  type SourcedHookResult,
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

  constructor(options: HookServiceOptions) {
    this.#store = options.store
    this.#config = options.config
    this.#runner = options.runner
    this.#entries = options.entries
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
    if (loaded.approvals.includes(request.digest)) return
    await this.#store.settings.set(key, [...loaded.approvals, request.digest], loaded.approvalsRevision)
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
    const approvals = Array.isArray(approvalsSetting?.value) ? approvalsSetting.value.filter((v): v is string => typeof v === 'string') : []
    const parsed = parseHooksConfig(file.hooks, 'project', { parseRule, path: file.path })
    const entries: ProjectHookEntry[] = parsed.hooks.map((hook) => ({
      hookId: hook.hookId,
      event: hook.event,
      ...(hook.matcher === undefined ? {} : { matcher: hook.matcher }),
      ...(hook.if === undefined ? {} : { if: hook.if }),
      command: hook.command,
      ...(hook.timeout === undefined ? {} : { timeout: hook.timeout }),
      digest: hook.digest,
      approved: approvals.includes(hook.digest),
    }))
    return { path: file.path, entries, hooks: parsed.hooks, diagnostics: parsed.diagnostics, approvals, approvalsRevision: approvalsSetting?.revision ?? 0 }
  }

  // ---- 运行 ----

  /** 该作用域生效的 Hook：能力关闭时没有；全局 Hook 加上已批准的项目 Hook（未批准的不运行）。 */
  async load(scope: Pick<HookScope, 'workspaceId' | 'cwd' | 'config'>): Promise<LoadedHook[]> {
    if (!scope.config.hooks.enabled) return []
    const [global, project] = await Promise.all([this.#global(), this.#project(scope.workspaceId, scope.cwd)])
    return [...global.parsed, ...project.hooks.filter((hook) => project.approvals.includes(hook.digest))]
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
  ): Promise<SourcedHookResult[]> {
    if (hooks.length === 0) return []
    const stdin = JSON.stringify(redactSecretsDeep({ ...this.#common(scope, event), ...input }))
    return Promise.all(
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
        const result = interpretHookResult(event, outcome)
        const command = redactText(hook.command)
        if (result.outcome) await this.#record(scope, state, { hook, command, result, exitCode: outcome.exitCode, durationMs: outcome.durationMs })
        else log.debug('hook ran without a decision', { event, hookId: hook.hookId, durationMs: outcome.durationMs })
        return { hookId: hook.hookId, source: hook.source, command, result }
      }),
    )
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
    run: { hook: LoadedHook; command: string; result: HookResult; exitCode: number | null; durationMs: number },
  ): Promise<void> {
    if (!scope.sessionId || !this.#entries) return
    const { hook, result } = run
    let outcome: HookOutcome = result.outcome!
    let message = messageOf(result)
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

  /** 有序关闭（上下文贡献之前）：中止进行中的 Hook 进程并等待其进程组结束。 */
  async close(): Promise<void> {
    const running = [...this.#running]
    for (const entry of running) entry.controller.abort()
    await Promise.allSettled(running.map((entry) => entry.done))
  }
}
