// 权限 hook：位于 ToolHooks 链首。判定 allow 直接放行，deny 以规则拒绝，ask 经 ApprovalBroker 等待用户回答。
import type { BeforeToolCallContext, BeforeToolCallResult } from '@earendil-works/pi-agent-core'
import type { PermissionMode, PermissionRule, SandboxMode } from '../session-entries/index.ts'
import type { CokoTool } from '../tools/types.ts'
import type { ApprovalBroker } from './broker.ts'
import { decide, toolCategory, type PermissionCall } from './decide.ts'
import { resolveTarget, writableRootsFor } from './paths.ts'
import { checkEscalation, escalationRejectedText, sandboxModeFor } from './sandbox.ts'

/** 模型可见的拒绝文本（契约）。 */
export const REJECTED_TEXT = 'The user rejected this tool call. Stop and wait for the user to tell you how to proceed.'
export const SKIPPED_TEXT = 'Skipped: the user rejected an earlier tool call in this batch.'
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

export function createPermissionGate(options: PermissionGateOptions) {
  let workspace: Promise<string> | undefined
  const realWorkspace = () => (workspace ??= resolveTarget('.', options.cwd).then((target) => target.real))

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
      options.commitFailed(error instanceof Error ? error : new Error(String(error)))
      return { block: true, reason: 'Run stopped: the record could not be saved' }
    }
    switch (resolution.outcome) {
      case 'allowed':
        options.grantEscalation(context.toolCall.id, targetMode)
        return undefined
      case 'cancelled':
        return { block: true, reason: 'Operation aborted' }
      case 'superseded':
        return { block: true, reason: 'Operation aborted' }
      case 'denied':
        if (resolution.feedback !== undefined) return { block: true, reason: rejectedWithFeedback(resolution.feedback) }
        // 与无反馈的普通拒绝一致：Run 在本批结束后停下（US 4），模型在下一轮看到要求它说明的文本。
        options.reject()
        return { block: true, reason: escalationRejectedText(targetMode) }
    }
  }

  return async (context: BeforeToolCallContext, signal?: AbortSignal): Promise<BeforeToolCallResult | undefined> => {
    if (options.rejected()) return { block: true, reason: SKIPPED_TEXT }
    const name = context.toolCall.name
    const tool = options.tool(name)
    const subject = tool?.permissionSubject?.(context.args as never)
    const category = toolCategory(name)
    /** 按调用时的模式与规则判定；等待审批期间模式或规则变更后再次调用。 */
    const evaluate = async () => {
      const mode = options.mode()
      const root = await realWorkspace()
      const call: PermissionCall = { toolName: name, ...(subject === undefined ? {} : { subject }) }
      if (subject !== undefined && (category === 'read' || category === 'write')) call.target = await resolveTarget(subject, options.cwd)
      return decide(call, { mode, rules: options.rules(), workspace: root, writableRoots: await writableRootsFor(mode, root) })
    }
    const decision = await evaluate()
    if (decision.behavior === 'deny') return { block: true, reason: deniedByRule(decision.rule) }

    // 提权（grilling B2）：拒绝规则之后检查；严格更宽的档位总要用户批准一次（允许规则与模式放行都不能免掉），
    // 替代该次调用的普通审批。参数错误时不询问也不执行。
    const asked = tool?.sandboxRequest?.(context.args as never)
    if (asked) {
      const check = checkEscalation(asked, sandboxModeFor(options.mode()))
      if (check.kind === 'invalid') return { block: true, reason: check.message }
      if (check.kind === 'escalate') return escalate(context, signal, subject ?? '', check.targetMode, check.justification)
    }

    if (decision.behavior === 'allow') return undefined

    let resolution
    try {
      resolution = await options.broker.request(
        { toolCallId: context.toolCall.id, toolName: name, kind: 'tool', subject: subject ?? '', suggestions: decision.suggestions },
        signal,
        async () => {
          const next = await evaluate()
          if (next.behavior === 'allow') return { behavior: 'allow' }
          if (next.behavior === 'deny') return { behavior: 'deny', reason: deniedByRule(next.rule) }
          return undefined
        },
      )
    } catch (error) {
      options.commitFailed(error instanceof Error ? error : new Error(String(error)))
      return { block: true, reason: 'Run stopped: the record could not be saved' }
    }
    switch (resolution.outcome) {
      case 'allowed':
        return undefined
      case 'cancelled':
        return { block: true, reason: 'Operation aborted' }
      case 'superseded':
        return resolution.verdict.behavior === 'allow' ? undefined : { block: true, reason: resolution.verdict.reason }
      case 'denied':
        if (resolution.feedback !== undefined) return { block: true, reason: rejectedWithFeedback(resolution.feedback) }
        options.reject()
        return { block: true, reason: REJECTED_TEXT }
    }
  }
}
