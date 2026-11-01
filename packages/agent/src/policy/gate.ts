// 权限 hook：位于 ToolHooks 链首。判定 allow 直接放行，deny 以规则拒绝，ask 经 ApprovalBroker 等待用户回答。
// 执行前（取得执行槽之后、执行记录之前）recheck 复核文件写入的目标：判定之后目标被替换（例如同批的命令新建了符号链接）时按新判定处理。
// exit_plan_mode（plan-exit）：询问前提交 proposed 的计划，以 kind plan 的请求等待审阅（不随模式或规则变更重新判定）。
// 无人回答的运行（unattended，ADR 0019）：三种请求都不等待，记一次 by headless 的拒绝。
import type { BeforeToolCallContext, BeforeToolCallResult } from '@earendil-works/pi-agent-core'
import { blockedByHookText, combinePreToolUse, type CombinedDecision } from '../extensions/hooks/combine.ts'
import type { HookCondition } from '../extensions/hooks/config.ts'
import type { ToolBlockResult } from '../extensions/hooks/tool-hooks.ts'
import type { PermissionMode, PermissionRule, SandboxMode } from '../session-entries/index.ts'
import {
  invalidPlanText,
  NOT_IN_PLAN_MODE_TEXT,
  planFeedbackText,
  planMarkdownProblem,
  planReviewOf,
  planTitle,
  type PlanReview,
} from '../planning/exit-plan-mode.ts'
import type { HookToolCall, HookVerdict } from '../extensions/hooks/types.ts'
import type { CokoTool } from '../tools/types.ts'
import type { ApprovalBroker, ApprovalResolution, ReevaluateVerdict } from './broker.ts'
import {
  decideWithStep,
  ruleToolName,
  toolCategory,
  type DecisionStep,
  type PermissionCall,
  type PermissionClass,
  type PermissionDecision,
  type PermissionTarget,
} from './decide.ts'
import { realLocation, resolveTarget, writableRootsFor } from './paths.ts'
import { checkEscalation, escalationRejectedText, isWiderSandbox, sandboxModeFor } from './sandbox.ts'

/** 模型可见的拒绝文本（契约）。 */
export const REJECTED_TEXT = 'The user rejected this tool call. Stop and wait for the user to tell you how to proceed.'
export const SKIPPED_TEXT = 'Skipped: the user rejected an earlier tool call in this batch.'
/** 等待中的审批被停止或暂停取消；未执行。与调度器对排队调用的文本相同。 */
export const OPERATION_ABORTED_TEXT = 'Operation aborted'
/** 请求或决定条目提交失败，Run 停止。 */
export const RECORD_FAILED_TEXT = 'Run stopped: the record could not be saved'
/** 提权参数只用于重试本 Run 中被沙箱拒绝过的同一命令（ADR 0005）。 */
export const ESCALATION_NOT_DENIED_TEXT =
  'invalid escalation: sandbox_permissions only retries a command the sandbox denied in this run; run the command without it first'
export const rejectedWithFeedback = (feedback: string) => `The user rejected this tool call and said:\n${feedback}`
/** 调用的效果固定在比当前模式更宽的沙箱中执行，而当前模式（plan、read-only）不允许提权。 */
export const fixedSandboxRefusedText = (what: string, fixed: SandboxMode, mode: PermissionMode) =>
  `Not sent: ${what} was started under the ${fixed} sandbox, wider than ${mode} mode allows; input to it would run with that access. ` +
  'Start a new terminal job under the current mode instead.'
export const deniedByRule = (rule: PermissionRule) => `Permission denied by rule ${rule.tool}${rule.content === undefined ? '' : `(${rule.content})`}.`

/**
 * 外部 Hook 在权限判定中的端口（ADR 0013）：PreToolUse 在 decide 之前运行（每次调用），PermissionRequest 在第 7 步（default）的询问出卡片之前
 * 运行。组合表见 extensions/hooks/combine.ts：Hook 的 deny > 规则拒绝 > 第 2–4 步、提权与 plan-exit 的询问 > Hook 的 ask（没有建议规则）>
 * Hook 的 allow（与允许规则同位）> decide。没有端口或端口没有决定时 gate 的行为与没有 Hook 时相同。
 */
export interface PermissionHookPort {
  preToolUse(call: HookToolCall, signal?: AbortSignal): Promise<HookVerdict>
  permissionRequest(call: HookToolCall, signal?: AbortSignal): Promise<HookVerdict>
}

export interface PermissionGateOptions {
  /** Workspace 目录（按调用时的真实路径判定）。 */
  cwd: string
  tool: (name: string) => CokoTool | undefined
  /** 宿主注册时给出的权限类（ToolRegistry.permissionClass）；工具对象自身不能声明。 */
  permissionClass?: (name: string) => PermissionClass | undefined
  /** 额外读取根（例如 Skill 目录）；按调用时的真实路径判定。 */
  readRoots?: () => readonly string[]
  broker: ApprovalBroker
  mode: () => PermissionMode
  rules: () => readonly PermissionRule[]
  /** 当前 Run 已有无反馈的拒绝：同批其余调用直接跳过，Run 在本批结束后以 aborted 结束。 */
  rejected: () => boolean
  reject: () => void
  /** 请求或决定条目提交失败：Run 以 commit_failed 结束。 */
  commitFailed: (error: Error) => void
  /** 用户批准了该调用的提权：执行时以该档位（或执行时更宽的模式档位）运行，只对这一次调用有效。 */
  grantEscalation: (toolCallId: string, mode: SandboxMode) => void
  /** 外部 Hook（缺省无）。 */
  hooks?: PermissionHookPort
  /**
   * 无人回答的运行（ADR 0019）：需要审批的调用不等待，在 PermissionRequest Hook 之后立即以 by headless 拒绝；模型看到 deniedText，
   * 不按无反馈的拒绝停止 Run。缺省时等待回答。
   */
  unattended?: { deniedText: string }
}

export interface PermissionGate {
  /** beforeToolCall：判定、提权与审批。 */
  beforeToolCall(context: BeforeToolCallContext, signal?: AbortSignal): Promise<ToolBlockResult | undefined>
  /**
   * 执行前复核（取得执行槽之后、执行记录之前）：文件写入的真实目标与判定时不同时按当前模式与规则重新判定，deny 与用户拒绝时
   * 以 Error 拒绝（调用不执行），ask 时再次审批。其余调用直接返回。
   */
  recheck(toolCallId: string, toolName: string, args: unknown, signal?: AbortSignal): Promise<void>
  /** 记录本 Run 中被沙箱拒绝的命令：只有它们之后可以带提权参数重试。 */
  recordSandboxDenial(command: string): void
  /** Run 结束：清空本 Run 的复核目标与沙箱拒绝记录。 */
  reset(): void
}

/** 用户拒绝或规则拒绝时调用不执行；文本即模型看到的工具错误。 */
export class ToolCallBlockedError extends Error {
  override readonly name = 'ToolCallBlockedError'
}

const commandKey = (command: string) => command.replace(/\s+/g, ' ').trim()

/** Hook 拦下的调用：模型看到原因，toolResult 带 details.hostBlock { by: hook }（工具卡的"被 Hook 阻止"标注）。 */
const hookBlock = (reason: string, verdict: HookVerdict): ToolBlockResult => ({
  block: true,
  reason,
  ...(verdict.hookId !== undefined && verdict.command !== undefined ? { hostBlock: { by: 'hook', hookId: verdict.hookId, command: verdict.command } } : {}),
})

/** 重新判定的结论：允许、带模型可见文本的拒绝、或询问（原因与建议）。 */
type Reasked = { behavior: 'allow' } | { behavior: 'deny'; reason: string } | Extract<PermissionDecision, { behavior: 'ask' }>

/**
 * Hook 的 ask 等待期间模式或规则变更：重新判定的结果与同一 Hook 结论再组合（Hook 不重跑）。规则拒绝照常结束请求；仍为询问时保持原请求
 * （Hook 的 ask 不随模式放宽而消失）。
 */
function hookAskAgain(
  verdict: HookVerdict,
  next: { decision: PermissionDecision; step: DecisionStep },
  asked: Extract<PermissionDecision, { behavior: 'ask' }>,
): Reasked {
  const combined: CombinedDecision = combinePreToolUse(verdict, next)
  if (combined.behavior === 'deny') return { behavior: 'deny', reason: combined.by === 'rule' ? deniedByRule(combined.decision.rule) : combined.reason }
  if (combined.behavior === 'allow') return { behavior: 'allow' }
  return combined.by === 'hook' ? asked : combined.decision
}
const sameSuggestions = (a: readonly PermissionRule[], b: readonly PermissionRule[]) => JSON.stringify(a) === JSON.stringify(b)

export function createPermissionGate(options: PermissionGateOptions): PermissionGate {
  let workspace: Promise<string> | undefined
  const realWorkspace = () => (workspace ??= resolveTarget('.', options.cwd).then((target) => target.real))
  /** 已放行的文件写入在判定时的真实目标，按 toolCallId；执行前复核时取用。 */
  const prepared = new Map<string, string>()
  /** 本 Run 中被沙箱拒绝过的命令（规范空白后）。 */
  const sandboxDenied = new Set<string>()

  const subjectOf = (name: string, args: unknown) => options.tool(name)?.permissionSubject?.(args as never)
  const classOf = (name: string) => options.permissionClass?.(name)
  const categoryOf = (name: string) => toolCategory(name, classOf(name))

  /** agent 类的调用是否要求隔离的 worktree（参数 isolation: 'worktree'）。 */
  const isolationOf = (name: string, args: unknown) =>
    categoryOf(name) === 'agent' && (args as { isolation?: unknown } | null | undefined)?.isolation === 'worktree'

  /** 按调用时的模式与规则判定；等待审批期间模式或规则变更后再次调用。 */
  const evaluate = async (
    name: string,
    subject: string | undefined,
    isolation = false,
  ): Promise<{ decision: PermissionDecision; step: DecisionStep; target?: PermissionTarget; matchesRule: (condition: HookCondition) => boolean }> => {
    const mode = options.mode()
    const root = await realWorkspace()
    const permissionClass = classOf(name)
    const call: PermissionCall = {
      toolName: name,
      ...(permissionClass ? { permissionClass } : {}),
      ...(subject === undefined ? {} : { subject }),
      ...(isolation ? { isolation } : {}),
    }
    const category = categoryOf(name)
    if (subject !== undefined && (category === 'read' || category === 'lsp' || category === 'write')) call.target = await resolveTarget(subject, options.cwd)
    const readRoots = await Promise.all((options.readRoots?.() ?? []).map((path) => realLocation(path)))
    const context = {
      mode,
      rules: options.rules(),
      workspace: root,
      writableRoots: await writableRootsFor(mode, root),
      ...(readRoots.length > 0 ? { readRoots } : {}),
    }
    const { decision, step } = decideWithStep(call, context)
    // Hook 的 if：与一条拒绝规则相同的匹配（命令的任一子命令、路径的解析前或真实路径），不看模式与其他规则。
    const matchesRule = (condition: HookCondition) =>
      decideWithStep(call, {
        ...context,
        rules: [{ behavior: 'deny', tool: condition.tool, ...(condition.content === undefined ? {} : { content: condition.content }) }],
      }).step === 'deny-rule'
    return { decision, step, matchesRule, ...(call.target ? { target: call.target } : {}) }
  }

  /** 审批请求：无人回答时记一次 by headless 的拒绝并立即返回，否则等待回答。 */
  const ask = (
    request: Parameters<ApprovalBroker['request']>[0],
    signal: AbortSignal | undefined,
    reevaluate?: () => Promise<ReevaluateVerdict>,
  ): Promise<ApprovalResolution> =>
    options.unattended
      ? options.broker.recordUnattendedDenied(request).then(() => ({ outcome: 'denied', by: 'headless' }))
      : options.broker.request(request, signal, reevaluate)

  const failed = (error: unknown): string => {
    options.commitFailed(error instanceof Error ? error : new Error(String(error)))
    return RECORD_FAILED_TEXT
  }

  /**
   * kind=tool 的审批：允许 → undefined；其余返回模型看到的阻止原因。模式或规则变更后重新判定：allow / deny 以 superseded 结束；
   * 仍需询问但原因或建议变了（例如不能再保存为规则）时以 superseded 结束并按新判定重新询问。
   */
  const askTool = async (
    toolCallId: string,
    name: string,
    subject: string | undefined,
    first: Extract<PermissionDecision, { behavior: 'ask' }>,
    signal: AbortSignal | undefined,
    onAllowed: (target: PermissionTarget | undefined) => void,
    isolation = false,
    /** 重新判定的结果与 PreToolUse Hook 的组合（Hook 不重跑）；省略时按 decide。 */
    combine?: (next: { decision: PermissionDecision; step: DecisionStep }) => Reasked,
  ): Promise<string | undefined> => {
    let asked = first
    let latestTarget: PermissionTarget | undefined
    for (;;) {
      let resolution: ApprovalResolution
      try {
        resolution = await ask(
          { toolCallId, toolName: name, kind: 'tool', subject: subject ?? '', suggestions: asked.suggestions },
          signal,
          async (): Promise<ReevaluateVerdict> => {
            const evaluated = await evaluate(name, subject, isolation)
            latestTarget = evaluated.target
            const next: Reasked = combine
              ? combine(evaluated)
              : evaluated.decision.behavior === 'deny'
                ? { behavior: 'deny', reason: deniedByRule(evaluated.decision.rule) }
                : evaluated.decision
            if (next.behavior === 'allow') return { behavior: 'allow' }
            if (next.behavior === 'deny') return { behavior: 'deny', reason: next.reason }
            if (next.reason === asked.reason && sameSuggestions(next.suggestions, asked.suggestions)) return undefined
            asked = next
            return { behavior: 'reask' }
          },
        )
      } catch (error) {
        return failed(error)
      }
      switch (resolution.outcome) {
        case 'allowed':
          onAllowed(latestTarget)
          return undefined
        case 'cancelled':
          return OPERATION_ABORTED_TEXT
        case 'superseded':
          if (resolution.verdict.behavior === 'reask') continue
          if (resolution.verdict.behavior === 'allow') {
            onAllowed(latestTarget)
            return undefined
          }
          return resolution.verdict.reason
        case 'denied':
          if (resolution.by === 'headless') return options.unattended!.deniedText
          if (resolution.feedback !== undefined) return rejectedWithFeedback(resolution.feedback)
          options.reject()
          return REJECTED_TEXT
      }
    }
  }

  /** kind=escalation 的请求：只能批准一次或拒绝，不随模式或规则变更重新判定。 */
  const escalate = async (
    context: BeforeToolCallContext,
    signal: AbortSignal | undefined,
    subject: string,
    targetMode: SandboxMode,
    justification: string,
  ): Promise<BeforeToolCallResult | undefined> => {
    let resolution
    try {
      resolution = await ask(
        { toolCallId: context.toolCall.id, toolName: context.toolCall.name, kind: 'escalation', subject, targetMode, justification, suggestions: [] },
        signal,
      )
    } catch (error) {
      return { block: true, reason: failed(error) }
    }
    switch (resolution.outcome) {
      case 'allowed':
        options.grantEscalation(context.toolCall.id, targetMode)
        return undefined
      case 'cancelled':
      case 'superseded':
        return { block: true, reason: OPERATION_ABORTED_TEXT }
      case 'denied':
        if (resolution.by === 'headless') return { block: true, reason: options.unattended!.deniedText }
        if (resolution.feedback !== undefined) return { block: true, reason: rejectedWithFeedback(resolution.feedback) }
        // 与无反馈的普通拒绝一致：Run 在本批结束后停下，模型在下一轮看到要求它说明的文本。
        options.reject()
        return { block: true, reason: escalationRejectedText(targetMode) }
    }
  }

  /**
   * 计划审阅：校验计划（参数错误时不提交、不询问），提交 proposed 的 plan 条目，再以 kind plan 的请求等待回答。批准时放行（执行时提交
   * approved）；拒绝时提交 rejected，带反馈的交给模型继续规划，无反馈的与普通拒绝相同（本批结束后 aborted）。
   */
  const reviewPlan = async (context: BeforeToolCallContext, review: PlanReview, signal: AbortSignal | undefined): Promise<BeforeToolCallResult | undefined> => {
    if (!(await review.active())) return { block: true, reason: NOT_IN_PLAN_MODE_TEXT }
    const markdown = String((context.args as { plan?: unknown } | undefined)?.plan ?? '')
    const problem = planMarkdownProblem(markdown)
    if (problem) return { block: true, reason: invalidPlanText(problem) }
    let resolution: ApprovalResolution
    try {
      const ref = await review.propose(context.toolCall.id, markdown)
      resolution = await ask(
        { toolCallId: context.toolCall.id, toolName: context.toolCall.name, kind: 'plan', subject: planTitle(markdown), suggestions: [], ...ref },
        signal,
      )
    } catch (error) {
      return { block: true, reason: failed(error) }
    }
    switch (resolution.outcome) {
      case 'allowed':
        return undefined
      case 'cancelled':
      case 'superseded':
        return { block: true, reason: OPERATION_ABORTED_TEXT }
      case 'denied':
        try {
          await review.rejected(context.toolCall.id, resolution.feedback)
        } catch (error) {
          return { block: true, reason: failed(error) }
        }
        if (resolution.by === 'headless') return { block: true, reason: options.unattended!.deniedText }
        if (resolution.feedback !== undefined) return { block: true, reason: planFeedbackText(resolution.feedback) }
        options.reject()
        return { block: true, reason: REJECTED_TEXT }
    }
  }

  return {
    async beforeToolCall(context, signal) {
      if (options.rejected()) return { block: true, reason: SKIPPED_TEXT }
      const name = context.toolCall.name
      const tool = options.tool(name)
      const subject = subjectOf(name, context.args)
      const isolation = isolationOf(name, context.args)
      const { decision, step, target, matchesRule } = await evaluate(name, subject, isolation)
      // PreToolUse（ADR 0013）：在 decide 的结果生效之前运行；Hook 的 deny 优先于一切（含规则拒绝与提权）。
      const hookCall: HookToolCall = {
        toolCallId: context.toolCall.id,
        toolName: name,
        ruleTool: ruleToolName(name, classOf(name)),
        input: context.args,
        permissionMode: options.mode(),
        matchesRule,
      }
      const verdict = options.hooks ? await options.hooks.preToolUse(hookCall, signal) : {}
      if (verdict.decision === 'deny') return hookBlock(blockedByHookText(verdict.reason), verdict)
      if (decision.behavior === 'deny') return { block: true, reason: deniedByRule(decision.rule) }
      // isolation worktree 在 plan / read-only 下不可用：直接为错误结果，不先询问一个批准之后也会失败的调用（Hook 与规则的拒绝之后）。
      const isolationMode = options.mode()
      if (isolation && (isolationMode === 'plan' || isolationMode === 'read-only'))
        return { block: true, reason: `isolation: worktree is not available in ${isolationMode} mode` }
      const remember = (latest: PermissionTarget | undefined) => {
        const real = (latest ?? target)?.real
        if (real !== undefined && categoryOf(name) === 'write') prepared.set(context.toolCall.id, real)
      }

      // 效果固定在更宽档位中执行的调用（向较宽档位启动的终端输入）：plan 与 read-only 下拒绝，其余模式按一次提权询问（与 sandbox_permissions
      // 相同，允许规则与模式放行都不能免掉它）。
      const fixed = tool?.fixedSandbox?.(context.args as never)
      const mode = options.mode()
      if (fixed && isWiderSandbox(fixed.mode, sandboxModeFor(mode))) {
        if (mode === 'plan' || mode === 'read-only') return { block: true, reason: fixedSandboxRefusedText(fixed.what, fixed.mode, mode) }
        return escalate(context, signal, subject ?? '', fixed.mode, `${fixed.what} runs with ${fixed.mode} access, wider than the current ${mode} mode`)
      }

      // 提权在拒绝规则之后检查；严格更宽的档位总要用户批准一次（允许规则与模式放行都不能免掉它），替代该次调用的普通审批，
      // 并且只用于重试本 Run 中被沙箱拒绝过的同一命令（ADR 0005）。参数错误时不询问也不执行。
      const asked = tool?.sandboxRequest?.(context.args as never)
      if (asked) {
        const check = checkEscalation(asked, sandboxModeFor(options.mode()))
        if (check.kind === 'invalid') return { block: true, reason: check.message }
        if (check.kind === 'escalate') {
          if (!sandboxDenied.has(commandKey(subject ?? ''))) return { block: true, reason: ESCALATION_NOT_DENIED_TEXT }
          return escalate(context, signal, subject ?? '', check.targetMode, check.justification)
        }
      }

      const forced = categoryOf(name) === 'plan-exit'
      const combined = combinePreToolUse(verdict, { decision, step }, forced)
      if (combined.behavior === 'allow') {
        remember(undefined)
        return undefined
      }
      if (combined.behavior === 'deny') return { block: true, reason: combined.by === 'hook' ? combined.reason : deniedByRule(combined.decision.rule) }
      const review = forced ? planReviewOf(tool) : undefined
      if (review) return reviewPlan(context, review, signal)
      // PermissionRequest：只在最终为第 7 步的询问时、出卡片之前运行；deny 拒绝，allow 以 approval_decision { by: hook } 结束，其余出卡片。
      if (combined.by === 'policy' && combined.step === 'default' && options.hooks) {
        const answer = await options.hooks.permissionRequest(hookCall, signal)
        if (answer.decision === 'deny') return hookBlock(blockedByHookText(answer.reason), answer)
        if (answer.decision === 'allow') {
          try {
            await options.broker.recordHookAllowed({
              toolCallId: context.toolCall.id,
              toolName: name,
              kind: 'tool',
              subject: subject ?? '',
              suggestions: combined.decision.suggestions,
            })
          } catch (error) {
            return { block: true, reason: failed(error) }
          }
          remember(undefined)
          return undefined
        }
      }
      const reason = await askTool(
        context.toolCall.id,
        name,
        subject,
        combined.decision,
        signal,
        remember,
        isolation,
        combined.by === 'hook' ? (next) => hookAskAgain(verdict, next, combined.decision) : undefined,
      )
      return reason === undefined ? undefined : { block: true, reason }
    },

    async recheck(toolCallId, toolName, args, signal) {
      const before = prepared.get(toolCallId)
      prepared.delete(toolCallId)
      if (before === undefined) return
      const subject = subjectOf(toolName, args)
      const { decision, target } = await evaluate(toolName, subject)
      if (target?.real === before) return
      if (decision.behavior === 'deny') throw new ToolCallBlockedError(deniedByRule(decision.rule))
      if (decision.behavior === 'allow') return
      const reason = await askTool(toolCallId, toolName, subject, decision, signal, () => undefined)
      if (reason !== undefined) throw new ToolCallBlockedError(reason)
    },

    recordSandboxDenial(command) {
      sandboxDenied.add(commandKey(command))
    },

    reset() {
      prepared.clear()
      sandboxDenied.clear()
    },
  }
}
