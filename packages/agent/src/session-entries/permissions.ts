// Permission Mode、Session 规则与审批请求 / 决定的条目 payload（ADR 0005）。
import { Type, type Static } from 'typebox'
import { definePayloads, type EntryJson } from './define.ts'

const strict = { additionalProperties: false } as const
const Id = Type.String({ minLength: 1 })

/** 可作为默认模式与 plan 之前模式的四档。 */
export const standardPermissionModeSchema = Type.Union([
  Type.Literal('read-only'),
  Type.Literal('default'),
  Type.Literal('accept-edits'),
  Type.Literal('full-access'),
])
export type StandardPermissionMode = Static<typeof standardPermissionModeSchema>

/** Session 的 Permission Mode：四档加 plan（判定与 read-only 相同，命令沙箱 read-only；只对一个 Session 生效）。 */
export const permissionModeSchema = Type.Union([standardPermissionModeSchema, Type.Literal('plan')])
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

/** permission_mode v1：只有四档。 */
const permissionModeV1Schema = Type.Object({ mode: standardPermissionModeSchema }, strict)

/** permission_mode v2：增加 plan；进入 plan 时 prior 为进入前的模式（退出与批准计划时回到它）。 */
export const permissionModePayloadSchema = Type.Object({ mode: permissionModeSchema, prior: Type.Optional(standardPermissionModeSchema) }, strict)
export type PermissionModePayload = Static<typeof permissionModePayloadSchema>

export const permissionRulePayloadSchema = Type.Object({ op: Type.Union([Type.Literal('add'), Type.Literal('remove')]), rule: permissionRuleSchema }, strict)
export type PermissionRulePayload = Static<typeof permissionRulePayloadSchema>

export const approvalRequestPayloadSchema = Type.Object(
  {
    requestId: Id,
    toolCallId: Id,
    toolName: Type.String(),
    /** escalation：命令请求以更宽的 Sandbox Mode 运行一次；plan：exit_plan_mode 提交的计划等待审阅。 */
    kind: Type.Union([Type.Literal('tool'), Type.Literal('escalation'), Type.Literal('plan')]),
    /** 命令或路径。 */
    subject: Type.String(),
    targetMode: Type.Optional(sandboxModeSchema),
    justification: Type.Optional(Type.String()),
    /** 可保存为"总是允许"的建议规则；越界写入与提权为空。 */
    suggestions: Type.Array(permissionRuleSchema),
    /** kind plan：proposed 的 plan 条目（subject 为计划标题）。 */
    planId: Type.Optional(Id),
    revision: Type.Optional(Type.Integer({ minimum: 1 })),
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

const approvalDecisionFields = {
  requestId: Id,
  outcome: approvalOutcomeSchema,
  scope: Type.Optional(approvalScopeSchema),
  feedback: Type.Optional(Type.String()),
}

/** approval_decision v1：没有回答者。 */
const approvalDecisionV1Schema = Type.Object(approvalDecisionFields, strict)

/** 回答审批的一方：用户，或 PermissionRequest Hook（ADR 0013）。缺省为用户。 */
export const approvalDeciderSchema = Type.Union([Type.Literal('user'), Type.Literal('hook')])
export type ApprovalDecider = Static<typeof approvalDeciderSchema>

/** approval_decision v2：另带回答者 by（v1 原样迁移）。 */
export const approvalDecisionPayloadSchema = Type.Object({ ...approvalDecisionFields, by: Type.Optional(approvalDeciderSchema) }, strict)
export type ApprovalDecisionPayload = Static<typeof approvalDecisionPayloadSchema>

export interface PermissionEntryPayloads {
  permission_mode: PermissionModePayload
  permission_rule: PermissionRulePayload
  approval_request: ApprovalRequestPayload
  approval_decision: ApprovalDecisionPayload
}

export const permissionEntryPayloads = definePayloads({
  permission_mode: [{ schema: permissionModeV1Schema }, { schema: permissionModePayloadSchema, migrate: (previous: EntryJson) => previous }],
  permission_rule: [{ schema: permissionRulePayloadSchema }],
  approval_request: [{ schema: approvalRequestPayloadSchema }],
  approval_decision: [{ schema: approvalDecisionV1Schema }, { schema: approvalDecisionPayloadSchema, migrate: (previous: EntryJson) => previous }],
} satisfies Record<keyof PermissionEntryPayloads, unknown>)
