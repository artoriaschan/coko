// 权限 hook：位于 ToolHooks 链首。判定 allow 直接放行，deny 以规则拒绝，ask 经 ApprovalBroker 等待用户回答。
// 执行前（取得执行槽之后、执行记录之前）recheck 复核文件写入的目标：判定之后目标被替换（例如同批的命令新建了符号链接）时按新判定处理。
import type { BeforeToolCallContext, BeforeToolCallResult } from '@earendil-works/pi-agent-core'
import type { PermissionMode, PermissionRule, SandboxMode } from '../session-entries/index.ts'
import type { CokoTool } from '../tools/types.ts'
import type { ApprovalBroker, ApprovalResolution, ReevaluateVerdict } from './broker.ts'
import { decide, toolCategory, type PermissionCall, type PermissionDecision, type PermissionTarget } from './decide.ts'
import { resolveTarget, writableRootsFor } from './paths.ts'
import { checkEscalation, escalationRejectedText, sandboxModeFor } from './sandbox.ts'

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
export const deniedByRule = (rule: PermissionRule) => `Permission denied by rule ${rule.tool}${rule.content === undefined ? '' : `(${rule.content})`}.`

export interface PermissionGateOptions {
  /** Workspace 目录（按调用时的真实路径判定）。 */
  cwd: string
  tool: (name: string) => CokoTool | undefined
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
}

export interface PermissionGate {
  /** beforeToolCall：判定、提权与审批。 */
  beforeToolCall(context: BeforeToolCallContext, signal?: AbortSignal): Promise<BeforeToolCallResult | undefined>
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
const sameSuggestions = (a: readonly PermissionRule[], b: readonly PermissionRule[]) => JSON.stringify(a) === JSON.stringify(b)

export function createPermissionGate(options: PermissionGateOptions): PermissionGate {
  let workspace: Promise<string> | undefined
  const realWorkspace = () => (workspace ??= resolveTarget('.', options.cwd).then((target) => target.real))
  /** 已放行的文件写入在判定时的真实目标，按 toolCallId；执行前复核时取用。 */
  const prepared = new Map<string, string>()
  /** 本 Run 中被沙箱拒绝过的命令（规范空白后）。 */
  const sandboxDenied = new Set<string>()

  const subjectOf = (name: string, args: unknown) => options.tool(name)?.permissionSubject?.(args as never)

  /** 按调用时的模式与规则判定；等待审批期间模式或规则变更后再次调用。 */
  const evaluate = async (name: string, subject: string | undefined): Promise<{ decision: PermissionDecision; target?: PermissionTarget }> => {
    const mode = options.mode()
    const root = await realWorkspace()
    const call: PermissionCall = { toolName: name, ...(subject === undefined ? {} : { subject }) }
    const category = toolCategory(name)
    if (subject !== undefined && (category === 'read' || category === 'write')) call.target = await resolveTarget(subject, options.cwd)
    const decision = decide(call, { mode, rules: options.rules(), workspace: root, writableRoots: await writableRootsFor(mode, root) })
    return { decision, ...(call.target ? { target: call.target } : {}) }
  }

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
  ): Promise<string | undefined> => {
    let asked = first
    let latestTarget: PermissionTarget | undefined
    for (;;) {
      let resolution: ApprovalResolution
      try {
        resolution = await options.broker.request(
          { toolCallId, toolName: name, kind: 'tool', subject: subject ?? '', suggestions: asked.suggestions },
          signal,
          async (): Promise<ReevaluateVerdict> => {
            const next = await evaluate(name, subject)
            latestTarget = next.target
            if (next.decision.behavior === 'allow') return { behavior: 'allow' }
            if (next.decision.behavior === 'deny') return { behavior: 'deny', reason: deniedByRule(next.decision.rule) }
            if (next.decision.reason === asked.reason && sameSuggestions(next.decision.suggestions, asked.suggestions)) return undefined
            asked = next.decision
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
      resolution = await options.broker.request(
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
        if (resolution.feedback !== undefined) return { block: true, reason: rejectedWithFeedback(resolution.feedback) }
        // 与无反馈的普通拒绝一致：Run 在本批结束后停下，模型在下一轮看到要求它说明的文本。
        options.reject()
        return { block: true, reason: escalationRejectedText(targetMode) }
    }
  }

  return {
    async beforeToolCall(context, signal) {
      if (options.rejected()) return { block: true, reason: SKIPPED_TEXT }
      const name = context.toolCall.name
      const tool = options.tool(name)
      const subject = subjectOf(name, context.args)
      const { decision, target } = await evaluate(name, subject)
      if (decision.behavior === 'deny') return { block: true, reason: deniedByRule(decision.rule) }
      const remember = (latest: PermissionTarget | undefined) => {
        const real = (latest ?? target)?.real
        if (real !== undefined && toolCategory(name) === 'write') prepared.set(context.toolCall.id, real)
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

      if (decision.behavior === 'allow') {
        remember(undefined)
        return undefined
      }
      const reason = await askTool(context.toolCall.id, name, subject, decision, signal, remember)
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
