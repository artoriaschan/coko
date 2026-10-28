// 权限 hook：位于 ToolHooks 链首。判定 allow 直接放行，deny 以规则拒绝，ask 经 ApprovalBroker 等待用户回答。
import type { BeforeToolCallContext, BeforeToolCallResult } from '@earendil-works/pi-agent-core'
import type { PermissionMode, PermissionRule } from '../session-entries/index.ts'
import type { CokoTool } from '../tools/types.ts'
import type { ApprovalBroker } from './broker.ts'
import { decide, toolCategory, type PermissionCall } from './decide.ts'
import { resolveTarget, writableRootsFor } from './paths.ts'

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
}

export function createPermissionGate(options: PermissionGateOptions) {
  let workspace: Promise<string> | undefined
  const realWorkspace = () => (workspace ??= resolveTarget('.', options.cwd).then((target) => target.real))

  return async (context: BeforeToolCallContext, signal?: AbortSignal): Promise<BeforeToolCallResult | undefined> => {
    if (options.rejected()) return { block: true, reason: SKIPPED_TEXT }
    const name = context.toolCall.name
    const tool = options.tool(name)
    const subject = tool?.permissionSubject?.(context.args as never)
    const category = toolCategory(name)
    const mode = options.mode()
    const root = await realWorkspace()
    const call: PermissionCall = { toolName: name, ...(subject === undefined ? {} : { subject }) }
    if (subject !== undefined && (category === 'read' || category === 'write')) call.target = await resolveTarget(subject, options.cwd)
    const decision = decide(call, { mode, rules: options.rules(), workspace: root, writableRoots: await writableRootsFor(mode, root) })

    if (decision.behavior === 'allow') return undefined
    if (decision.behavior === 'deny') return { block: true, reason: deniedByRule(decision.rule) }

    let resolution
    try {
      resolution = await options.broker.request(
        { toolCallId: context.toolCall.id, toolName: name, kind: 'tool', subject: subject ?? '', suggestions: decision.suggestions },
        signal,
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
      case 'denied':
        if (resolution.feedback !== undefined) return { block: true, reason: rejectedWithFeedback(resolution.feedback) }
        options.reject()
        return { block: true, reason: REJECTED_TEXT }
    }
  }
}
