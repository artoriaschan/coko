// 外部 Hook（ADR 0013）在 agent 一侧的类型：Hook 对一次工具调用的结论，以及 gate 调用 Hook 的端口（policy/gate.ts）。
import type { PermissionMode } from '../../session-entries/index.ts'
import type { HookCondition } from './config.ts'

export type { HookEvent, HookOutcome, HookSource } from '../../session-entries/index.ts'
import type { HookSource } from '../../session-entries/index.ts'

/** Hook 对一次调用的决定；聚合时 deny > ask > allow（项目 Hook 的 allow 不参与）。 */
export type HookDecision = 'allow' | 'deny' | 'ask'

/** 同一事件全部匹配 Hook 聚合后的结论；没有 decision 表示没有 Hook 给出决定。 */
export interface HookVerdict {
  decision?: HookDecision
  /** 拒绝或询问的原因（显示给模型或用户，已按值脱敏）。 */
  reason?: string
  /** 给出决定的 Hook 的来源（项目 Hook 的 allow 已在聚合时去掉）。 */
  source?: HookSource
  /** 给出决定的（第一条）Hook 与其命令（已脱敏；工具卡的"被 Hook 阻止"标注用）。 */
  hookId?: string
  command?: string
}

/** gate 交给 Hook 的一次工具调用（输入为已提交、已脱敏的值）。 */
export interface HookToolCall {
  toolCallId: string
  /** 工具注册名。 */
  toolName: string
  /** 规则组名（例如 Bash、Edit、Agent、Schedule）；没有时同注册名。 */
  ruleTool: string
  input: unknown
  /** 调用时的权限模式（Hook 输入的 permission_mode）。 */
  permissionMode?: PermissionMode
  /** if 条件：与拒绝规则相同的匹配（Bash 复合命令任一子命令命中即匹配）。 */
  matchesRule?: (condition: HookCondition) => boolean
}

/** 事件的公共输入字段（子 Session 另有 parent_session_id、agent_type）。 */
export interface HookEventContext {
  event: import('../../session-entries/index.ts').HookEvent
  sessionId: string
  cwd: string
}
