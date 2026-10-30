import { Type, type Static } from 'typebox'

// Permission Mode、规则与审批的条目 payload（ADR 0005）。

const strict = { additionalProperties: false } as const
const Id = Type.String({ minLength: 1 })

/** 可作为默认模式与 plan 之前模式的四档（plan 只对一个 Session 生效，不能设为默认）。 */
export const StandardPermissionMode = Type.Union([
  Type.Literal('read-only'),
  Type.Literal('default'),
  Type.Literal('accept-edits'),
  Type.Literal('full-access'),
])
export type StandardPermissionMode = Static<typeof StandardPermissionMode>

/** Session 的 Permission Mode：四档加 plan（Plan Mode：判定与 read-only 相同，命令沙箱 read-only）。 */
export const PermissionMode = Type.Union([StandardPermissionMode, Type.Literal('plan')])
export type PermissionMode = Static<typeof PermissionMode>

export const SandboxMode = Type.Union([Type.Literal('read-only'), Type.Literal('workspace-write'), Type.Literal('danger-full-access')])
export type SandboxMode = Static<typeof SandboxMode>

export const PermissionRule = Type.Object(
  { behavior: Type.Union([Type.Literal('allow'), Type.Literal('ask'), Type.Literal('deny')]), tool: Id, content: Type.Optional(Type.String()) },
  strict,
)
export type PermissionRule = Static<typeof PermissionRule>

/** permission_mode v2：进入 plan 时另记 prior（进入前的模式，退出与批准计划时回到它）。 */
export const PermissionModePayload = Type.Object({ mode: PermissionMode, prior: Type.Optional(StandardPermissionMode) }, strict)
export type PermissionModePayload = Static<typeof PermissionModePayload>

export const PermissionRulePayload = Type.Object({ op: Type.Union([Type.Literal('add'), Type.Literal('remove')]), rule: PermissionRule }, strict)
export type PermissionRulePayload = Static<typeof PermissionRulePayload>

export const ApprovalRequestPayload = Type.Object(
  {
    requestId: Id,
    toolCallId: Id,
    toolName: Type.String(),
    /** plan：exit_plan_mode 提交的计划等待审阅（subject 为计划标题，planId 与 revision 指向 proposed 的 plan 条目）。 */
    kind: Type.Union([Type.Literal('tool'), Type.Literal('escalation'), Type.Literal('plan')]),
    subject: Type.String(),
    targetMode: Type.Optional(SandboxMode),
    justification: Type.Optional(Type.String()),
    suggestions: Type.Array(PermissionRule),
    planId: Type.Optional(Id),
    revision: Type.Optional(Type.Integer({ minimum: 1 })),
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

/**
 * POST /api/sessions/:id/approvals/:requestId：回答待审批请求，204。请求不在等待中时 409 approval-not-pending。
 * feedback 只随拒绝：带反馈的拒绝作为工具错误交给模型，Run 继续；无反馈的拒绝在本批工具结束后以 aborted 结束 Run。
 * editedPlan 与 mode 只用于 kind plan 的请求（否则 400）：editedPlan 为用户编辑后的计划（规则同 exit_plan_mode 的 plan），mode 为批准后
 * 的模式（缺省为进入 plan 之前的模式；可以是 read-only、default 或 accept-edits，不能宽于进入 plan 之前的模式，否则 400）。plan 请求的
 * scope 只能是 once。
 */
export const AnswerApprovalRequest = Type.Union([
  Type.Object(
    {
      decision: Type.Literal('allow'),
      scope: Type.Optional(ApprovalScope),
      editedPlan: Type.Optional(Type.String({ minLength: 1, maxLength: 64_000 })),
      mode: Type.Optional(Type.Union([Type.Literal('read-only'), Type.Literal('default'), Type.Literal('accept-edits')])),
    },
    strict,
  ),
  Type.Object({ decision: Type.Literal('deny'), feedback: Type.Optional(Type.String({ maxLength: 4000 })) }, strict),
])
export type AnswerApprovalRequest = Static<typeof AnswerApprovalRequest>

export const permissionEntryPayloadSchemas = {
  permission_mode: PermissionModePayload,
  permission_rule: PermissionRulePayload,
  approval_request: ApprovalRequestPayload,
  approval_decision: ApprovalDecisionPayload,
}

// ---- 规则与模式的管理 ----

/** 设置键：新 Session 的默认模式（PermissionMode）、全局规则与 Workspace 规则（PermissionRule[]）。只能经 /api/permissions 修改。 */
export const PERMISSIONS_DEFAULT_MODE_SETTING = 'permissions.defaultMode'
export const PERMISSIONS_RULES_SETTING = 'permissions.rules'
export const workspaceRulesSetting = (workspaceId: string) => `permissions.rules.workspace.${workspaceId}`
/** 通用设置接口拒绝写入的键（permissions 及其下）。 */
export const isPermissionSettingKey = (key: string) => key === 'permissions' || key.startsWith('permissions.')

/** 请求中的规则：工具名与内容都不能为空。 */
export const PermissionRuleInput = Type.Object(
  {
    behavior: Type.Union([Type.Literal('allow'), Type.Literal('ask'), Type.Literal('deny')]),
    tool: Type.String({ minLength: 1, maxLength: 200, pattern: '^[^()\\s]+$' }),
    content: Type.Optional(Type.String({ minLength: 1, maxLength: 4000 })),
  },
  strict,
)
export type PermissionRuleInput = Static<typeof PermissionRuleInput>

export const PermissionRuleList = Type.Array(PermissionRuleInput, { maxItems: 500 })

/**
 * project 作用域（ADR 0008）：Workspace 的 .coko/settings.json 中的 permissions.deny / ask，只读（改文件才能改），没有 revision。
 * 每次读取 GET /api/permissions 与每个 Run 开始时按 mtime 读取；工具名按规范名读出。
 */
export const ProjectPermissionRules = Type.Object({ workspaceId: Id, path: Type.String(), rules: Type.Array(PermissionRule) }, strict)
export type ProjectPermissionRules = Static<typeof ProjectPermissionRules>

/**
 * GET /api/permissions?workspaceId=…：默认模式、全局规则，以及给出 workspaceId 时该 Workspace 的规则与项目规则（project）；
 * 可写的各带 revision（未保存过为 0）。
 */
export const PermissionsResponse = Type.Object(
  {
    defaultMode: Type.Object({ value: StandardPermissionMode, revision: Type.Integer({ minimum: 0 }) }, strict),
    global: Type.Object({ rules: Type.Array(PermissionRule), revision: Type.Integer({ minimum: 0 }) }, strict),
    workspace: Type.Optional(Type.Object({ workspaceId: Id, rules: Type.Array(PermissionRule), revision: Type.Integer({ minimum: 0 }) }, strict)),
    project: Type.Optional(ProjectPermissionRules),
  },
  strict,
)
export type PermissionsResponse = Static<typeof PermissionsResponse>

/**
 * PUT /api/permissions：一次修改一项，返回 PermissionsResponse（含该 Workspace）。值不合 schema 时 400；
 * expectedRevision 不一致时 409 revision-conflict；Workspace 不存在时 404。
 */
export const UpdatePermissionsRequest = Type.Union([
  Type.Object({ target: Type.Literal('defaultMode'), value: StandardPermissionMode, expectedRevision: Type.Integer({ minimum: 0 }) }, strict),
  Type.Object({ target: Type.Literal('global'), rules: PermissionRuleList, expectedRevision: Type.Integer({ minimum: 0 }) }, strict),
  Type.Object({ target: Type.Literal('workspace'), workspaceId: Id, rules: PermissionRuleList, expectedRevision: Type.Integer({ minimum: 0 }) }, strict),
])
export type UpdatePermissionsRequest = Static<typeof UpdatePermissionsRequest>

/** PUT /api/sessions/:id/permission-mode。切到 plan 时记下当前模式为 prior（已在 plan 时不变）；从 plan 切到其他模式即退出规划（不经审阅）。 */
export const SetPermissionModeRequest = Type.Object({ mode: PermissionMode }, strict)
export type SetPermissionModeRequest = Static<typeof SetPermissionModeRequest>

/** POST / DELETE /api/sessions/:id/permission-rules：增删一条 Session 规则（已存在 / 不存在时不提交条目）。 */
export const SessionPermissionRuleRequest = Type.Object({ rule: PermissionRuleInput }, strict)
export type SessionPermissionRuleRequest = Static<typeof SessionPermissionRuleRequest>

/** Session 的当前模式与 Session 规则（由条目回放）；plan 模式另带 prior。 */
export const SessionPermissionsResponse = Type.Object(
  { mode: PermissionMode, prior: Type.Optional(StandardPermissionMode), rules: Type.Array(PermissionRule) },
  strict,
)
export type SessionPermissionsResponse = Static<typeof SessionPermissionsResponse>

export const permissionPaths = {
  /** GET / PUT：默认模式与全局、Workspace 规则。 */
  permissions: '/api/permissions',
  /** PUT：切换 Session 的 Permission Mode。 */
  sessionPermissionMode: (id: string) => `/api/sessions/${encodeURIComponent(id)}/permission-mode`,
  /** POST / DELETE：Session 规则。 */
  sessionPermissionRules: (id: string) => `/api/sessions/${encodeURIComponent(id)}/permission-rules`,
} as const

/** Shift+Tab 循环的三档；full-access 与 plan 只能显式选择。 */
export const CYCLED_PERMISSION_MODES = ['read-only', 'default', 'accept-edits'] as const satisfies readonly PermissionMode[]

const escapeContent = (content: string) => content.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
const unescapeContent = (content: string) => content.replace(/\\([\\()])/g, '$1')

/** 规则的显示与输入形式：`Tool` 或 `Tool(content)`，内容中的括号与反斜杠以反斜杠转义。 */
export function formatPermissionRule(rule: Pick<PermissionRule, 'tool' | 'content'>): string {
  return rule.content === undefined ? rule.tool : `${rule.tool}(${escapeContent(rule.content)})`
}

/** 解析 `Tool` 或 `Tool(content)`；格式不对时返回 undefined。`Tool()` 与 `Tool(*)` 以外的空白内容不合法。 */
export function parsePermissionRule(text: string): { tool: string; content?: string } | undefined {
  const value = text.trim()
  const open = value.indexOf('(')
  if (open === -1) return /^[^()\s]+$/.test(value) ? { tool: value } : undefined
  if (!value.endsWith(')') || value.endsWith('\\)')) return undefined
  const tool = value.slice(0, open).trim()
  if (!/^[^()\s]+$/.test(tool)) return undefined
  const raw = value.slice(open + 1, -1)
  if (/(^|[^\\])[()]/.test(raw.replace(/\\\\/g, ''))) return undefined
  const content = unescapeContent(raw).trim()
  if (content === '') return { tool }
  return { tool, content }
}
