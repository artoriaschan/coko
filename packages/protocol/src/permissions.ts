import { Type, type Static } from 'typebox'

// Permission Mode、规则与审批的条目 payload（ADR 0005）。

const strict = { additionalProperties: false } as const
const Id = Type.String({ minLength: 1 })

export const PermissionMode = Type.Union([Type.Literal('read-only'), Type.Literal('default'), Type.Literal('accept-edits'), Type.Literal('full-access')])
export type PermissionMode = Static<typeof PermissionMode>

export const SandboxMode = Type.Union([Type.Literal('read-only'), Type.Literal('workspace-write'), Type.Literal('danger-full-access')])
export type SandboxMode = Static<typeof SandboxMode>

export const PermissionRule = Type.Object(
  { behavior: Type.Union([Type.Literal('allow'), Type.Literal('ask'), Type.Literal('deny')]), tool: Id, content: Type.Optional(Type.String()) },
  strict,
)
export type PermissionRule = Static<typeof PermissionRule>

export const PermissionModePayload = Type.Object({ mode: PermissionMode }, strict)
export type PermissionModePayload = Static<typeof PermissionModePayload>

export const PermissionRulePayload = Type.Object({ op: Type.Union([Type.Literal('add'), Type.Literal('remove')]), rule: PermissionRule }, strict)
export type PermissionRulePayload = Static<typeof PermissionRulePayload>

export const ApprovalRequestPayload = Type.Object(
  {
    requestId: Id,
    toolCallId: Id,
    toolName: Type.String(),
    kind: Type.Union([Type.Literal('tool'), Type.Literal('escalation')]),
    subject: Type.String(),
    targetMode: Type.Optional(SandboxMode),
    justification: Type.Optional(Type.String()),
    suggestions: Type.Array(PermissionRule),
  },
  strict,
)
export type ApprovalRequestPayload = Static<typeof ApprovalRequestPayload>

export const ApprovalOutcome = Type.Union([
  Type.Literal('allowed'),
  Type.Literal('denied'),
  Type.Literal('cancelled'),
  Type.Literal('expired'),
  Type.Literal('superseded'),
])
export type ApprovalOutcome = Static<typeof ApprovalOutcome>

export const ApprovalScope = Type.Union([Type.Literal('once'), Type.Literal('session'), Type.Literal('workspace'), Type.Literal('global')])
export type ApprovalScope = Static<typeof ApprovalScope>

export const ApprovalDecisionPayload = Type.Object(
  { requestId: Id, outcome: ApprovalOutcome, scope: Type.Optional(ApprovalScope), feedback: Type.Optional(Type.String()) },
  strict,
)
export type ApprovalDecisionPayload = Static<typeof ApprovalDecisionPayload>

export const permissionEntryPayloadSchemas = {
  permission_mode: PermissionModePayload,
  permission_rule: PermissionRulePayload,
  approval_request: ApprovalRequestPayload,
  approval_decision: ApprovalDecisionPayload,
}
