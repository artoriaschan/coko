// Permission Mode、Session 规则与审批请求 / 决定的条目 payload（ADR 0005）。
import { Type, type Static } from 'typebox'
import { definePayloads } from './define.ts'

const strict = { additionalProperties: false } as const
const Id = Type.String({ minLength: 1 })

export const permissionModeSchema = Type.Union([Type.Literal('read-only'), Type.Literal('default'), Type.Literal('accept-edits'), Type.Literal('full-access')])
export type PermissionMode = Static<typeof permissionModeSchema>

/** Sandbox Mode：命令运行时的写入档位。 */
export const sandboxModeSchema = Type.Union([Type.Literal('read-only'), Type.Literal('workspace-write'), Type.Literal('danger-full-access')])
export type SandboxMode = Static<typeof sandboxModeSchema>

/** 规则 `Tool` 或 `Tool(content)`；content 为路径模式或命令。 */
export const permissionRuleSchema = Type.Object(
  { behavior: Type.Union([Type.Literal('allow'), Type.Literal('ask'), Type.Literal('deny')]), tool: Id, content: Type.Optional(Type.String()) },
  strict,
)
export type PermissionRule = Static<typeof permissionRuleSchema>

export const permissionModePayloadSchema = Type.Object({ mode: permissionModeSchema }, strict)
export type PermissionModePayload = Static<typeof permissionModePayloadSchema>

export const permissionRulePayloadSchema = Type.Object({ op: Type.Union([Type.Literal('add'), Type.Literal('remove')]), rule: permissionRuleSchema }, strict)
export type PermissionRulePayload = Static<typeof permissionRulePayloadSchema>

export const approvalRequestPayloadSchema = Type.Object(
  {
    requestId: Id,
    toolCallId: Id,
    toolName: Type.String(),
    /** escalation：命令请求以更宽的 Sandbox Mode 运行一次。 */
    kind: Type.Union([Type.Literal('tool'), Type.Literal('escalation')]),
    /** 命令或路径。 */
    subject: Type.String(),
    targetMode: Type.Optional(sandboxModeSchema),
    justification: Type.Optional(Type.String()),
    /** 可保存为"总是允许"的建议规则；越界写入与提权为空。 */
    suggestions: Type.Array(permissionRuleSchema),
  },
  strict,
)
export type ApprovalRequestPayload = Static<typeof approvalRequestPayloadSchema>

export const approvalOutcomeSchema = Type.Union([
  Type.Literal('allowed'),
  Type.Literal('denied'),
  Type.Literal('cancelled'),
  Type.Literal('expired'),
  Type.Literal('superseded'),
])
export type ApprovalOutcome = Static<typeof approvalOutcomeSchema>

export const approvalScopeSchema = Type.Union([Type.Literal('once'), Type.Literal('session'), Type.Literal('workspace'), Type.Literal('global')])
export type ApprovalScope = Static<typeof approvalScopeSchema>

export const approvalDecisionPayloadSchema = Type.Object(
  { requestId: Id, outcome: approvalOutcomeSchema, scope: Type.Optional(approvalScopeSchema), feedback: Type.Optional(Type.String()) },
  strict,
)
export type ApprovalDecisionPayload = Static<typeof approvalDecisionPayloadSchema>

export interface PermissionEntryPayloads {
  permission_mode: PermissionModePayload
  permission_rule: PermissionRulePayload
  approval_request: ApprovalRequestPayload
  approval_decision: ApprovalDecisionPayload
}

export const permissionEntryPayloads = definePayloads({
  permission_mode: [{ schema: permissionModePayloadSchema }],
  permission_rule: [{ schema: permissionRulePayloadSchema }],
  approval_request: [{ schema: approvalRequestPayloadSchema }],
  approval_decision: [{ schema: approvalDecisionPayloadSchema }],
} satisfies Record<keyof PermissionEntryPayloads, unknown>)
