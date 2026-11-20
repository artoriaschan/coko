// Permission Mode、Session 规则与审批请求 / 决定的条目 payload（ADR 0005）。
import { Type, type Static } from 'typebox'
import { definePayloads, type EntryJson } from './define.ts'

const strict = { additionalProperties: false } as const
const Id = Type.String({ minLength: 1 })

/** Session 的 Permission Mode：五档（ADR 0005、ADR 0029；规划是计划阶段而不是模式，ADR 0028）。 */
export const standardPermissionModeSchema = Type.Union([
  Type.Literal('read-only'),
  Type.Literal('default'),
  Type.Literal('accept-edits'),
  Type.Literal('auto-review'),
  Type.Literal('full-access'),
])
export type StandardPermissionMode = Static<typeof standardPermissionModeSchema>

/** 与 standardPermissionModeSchema 相同（规划不是 Permission Mode，ADR 0028；保留旧名，免于改动全部引用）。 */
export const permissionModeSchema = standardPermissionModeSchema
export type PermissionMode = StandardPermissionMode

/** Sandbox Mode：命令运行时的写入档位。 */
export const sandboxModeSchema = Type.Union([Type.Literal('read-only'), Type.Literal('workspace-write'), Type.Literal('danger-full-access')])
export type SandboxMode = Static<typeof sandboxModeSchema>

/** 规则 `Tool` 或 `Tool(content)`；content 为路径模式或命令。 */
export const permissionRuleSchema = Type.Object(
  { behavior: Type.Union([Type.Literal('allow'), Type.Literal('ask'), Type.Literal('deny')]), tool: Id, content: Type.Optional(Type.String()) },
  strict,
)
export type PermissionRule = Static<typeof permissionRuleSchema>

/** v1–v3 的四档（没有 auto-review）：旧版本的 schema 保持不变。 */
const legacyPermissionModeSchema = Type.Union([Type.Literal('read-only'), Type.Literal('default'), Type.Literal('accept-edits'), Type.Literal('full-access')])

/** permission_mode v1：只有四档。 */
const permissionModeV1Schema = Type.Object({ mode: legacyPermissionModeSchema }, strict)

/** permission_mode v2（旧数据）：增加 plan；进入 plan 时 prior 为进入前的模式。 */
const permissionModeV2Schema = Type.Object(
  { mode: Type.Union([legacyPermissionModeSchema, Type.Literal('plan')]), prior: Type.Optional(legacyPermissionModeSchema) },
  strict,
)

/**
 * permission_mode v3：只有四档，不带 prior（ADR 0028）。v2 的 plan 读为 prior（没有时 default），只在读取时于内存中升级，不改写数据库行；
 * 旧数据中没有 plan_phase，因此读回后不在规划中。
 */
const permissionModeV3Schema = Type.Object({ mode: legacyPermissionModeSchema }, strict)

/** permission_mode v4：五档，增加 auto-review（ADR 0029）；v3 原样迁移，不改写数据库行。 */
export const permissionModePayloadSchema = Type.Object({ mode: standardPermissionModeSchema }, strict)
export type PermissionModePayload = Static<typeof permissionModePayloadSchema>

export const permissionRulePayloadSchema = Type.Object({ op: Type.Union([Type.Literal('add'), Type.Literal('remove')]), rule: permissionRuleSchema }, strict)
export type PermissionRulePayload = Static<typeof permissionRulePayloadSchema>

const approvalRequestFields = {
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
}

/** approval_request v1：没有审查信息。 */
const approvalRequestV1Schema = Type.Object(approvalRequestFields, strict)

/** 审查没能给出结论的原因（ADR 0029；界面按代码本地化）。 */
export const reviewFailureCodeSchema = Type.Union([
  Type.Literal('timeout'),
  Type.Literal('request-failed'),
  Type.Literal('invalid-output'),
  Type.Literal('no-model'),
  Type.Literal('budget'),
  Type.Literal('too-long'),
])
export type ReviewFailureCode = Static<typeof reviewFailureCodeSchema>

/** 只在经过 Reviewer 后出给用户的请求上：转交的理由，或没能完成的原因。 */
export const approvalReviewSchema = Type.Union([
  Type.Object({ outcome: Type.Literal('escalated'), reason: Type.String({ minLength: 1 }) }, strict),
  Type.Object({ outcome: Type.Literal('failed'), code: reviewFailureCodeSchema }, strict),
])
export type ApprovalReview = Static<typeof approvalReviewSchema>

/** approval_request v2：另带可选的审查信息 review（v1 原样迁移）。 */
export const approvalRequestPayloadSchema = Type.Object({ ...approvalRequestFields, review: Type.Optional(approvalReviewSchema) }, strict)
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

/** approval_decision v2：另带回答者 by（user 或 hook；v1 原样迁移）。 */
const approvalDecisionV2Schema = Type.Object({ ...approvalDecisionFields, by: Type.Optional(Type.Union([Type.Literal('user'), Type.Literal('hook')])) }, strict)

/** approval_decision v3：by 增加 headless（v2 原样迁移）。 */
const approvalDecisionV3Schema = Type.Object(
  { ...approvalDecisionFields, by: Type.Optional(Type.Union([Type.Literal('user'), Type.Literal('hook'), Type.Literal('headless')])) },
  strict,
)

/**
 * 回答审批的一方：用户、PermissionRequest Hook（ADR 0013）、无界面运行的自动拒绝（ADR 0019）或 Reviewer（ADR 0029）。缺省为用户。
 */
export const approvalDeciderSchema = Type.Union([Type.Literal('user'), Type.Literal('hook'), Type.Literal('headless'), Type.Literal('reviewer')])
export type ApprovalDecider = Static<typeof approvalDeciderSchema>

/** approval_decision v4：by 增加 reviewer，reason 为 Reviewer 放行的理由（只在 by reviewer 时写入；v3 原样迁移）。 */
export const approvalDecisionPayloadSchema = Type.Object(
  { ...approvalDecisionFields, by: Type.Optional(approvalDeciderSchema), reason: Type.Optional(Type.String()) },
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
  permission_mode: [
    { schema: permissionModeV1Schema },
    { schema: permissionModeV2Schema, migrate: (previous: EntryJson) => previous },
    {
      schema: permissionModeV3Schema,
      migrate: (previous: EntryJson) => {
        const { mode, prior } = previous as { mode: string; prior?: string }
        return { mode: mode === 'plan' ? (prior ?? 'default') : mode }
      },
    },
    { schema: permissionModePayloadSchema, migrate: (previous: EntryJson) => previous },
  ],
  permission_rule: [{ schema: permissionRulePayloadSchema }],
  approval_request: [{ schema: approvalRequestV1Schema }, { schema: approvalRequestPayloadSchema, migrate: (previous: EntryJson) => previous }],
  approval_decision: [
    { schema: approvalDecisionV1Schema },
    { schema: approvalDecisionV2Schema, migrate: (previous: EntryJson) => previous },
    { schema: approvalDecisionV3Schema, migrate: (previous: EntryJson) => previous },
    { schema: approvalDecisionPayloadSchema, migrate: (previous: EntryJson) => previous },
  ],
} satisfies Record<keyof PermissionEntryPayloads, unknown>)
