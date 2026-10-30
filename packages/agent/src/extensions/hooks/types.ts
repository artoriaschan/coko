// 外部 Hook（ADR 0013）在 agent 一侧的类型：Hook 对一次工具调用的结论，以及 gate 调用 Hook 的端口（policy/gate.ts）。
// 配置解析、matcher 与 if、聚合与组合表由 Hook 的实现填充；本文件只定义 seam。
import type { HookEvent, HookSource } from '../../session-entries/index.ts'

export type { HookEvent, HookSource } from '../../session-entries/index.ts'

/** Hook 对一次调用的决定；聚合时 deny > ask > allow（项目 Hook 的 allow 不参与）。 */
export type HookDecision = 'allow' | 'deny' | 'ask'

/** 同一事件全部匹配 Hook 聚合后的结论；没有 decision 表示没有 Hook 给出决定。 */
export interface HookVerdict {
  decision?: HookDecision
  /** 拒绝或询问的原因（显示给模型或用户，已按值脱敏）。 */
  reason?: string
  /** 给出决定的 Hook 的来源（项目 Hook 的 allow 已在聚合时去掉）。 */
  source?: HookSource
}

/** gate 交给 Hook 的一次工具调用（输入为已提交、已脱敏的值）。 */
export interface HookToolCall {
  toolCallId: string
  /** 工具注册名。 */
  toolName: string
  /** 规则组名（例如 Bash、Edit、Agent、Schedule）；没有时同注册名。 */
  ruleTool: string
  input: unknown
}

/** 事件的公共输入字段（子 Session 另有 parent_session_id、agent_type）。 */
export interface HookEventContext {
  event: HookEvent
  sessionId: string
  cwd: string
}
