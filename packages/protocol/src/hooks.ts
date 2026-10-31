import { Type, type Static } from 'typebox'
import { ResourceDiagnostic } from './config.ts'

// 外部 Hook（ADR 0013）：hook_run 条目 payload、Hook 配置与 /api/hooks 的 DTO。entries.ts 据 hookEntryPayloadSchemas 组成 SessionEntry。

const strict = { additionalProperties: false } as const
const Id = Type.String({ minLength: 1 })
const Count = Type.Integer({ minimum: 0 })

/** 支持的 Hook 事件。 */
export const HookEvent = Type.Union([
  Type.Literal('PreToolUse'),
  Type.Literal('PostToolUse'),
  Type.Literal('PostToolUseFailure'),
  Type.Literal('PermissionRequest'),
  Type.Literal('UserPromptSubmit'),
  Type.Literal('Stop'),
  Type.Literal('SubagentStart'),
  Type.Literal('SubagentStop'),
  Type.Literal('PreCompact'),
  Type.Literal('Notification'),
  /** 团队事件（ADR 0018）：没有 matcher；分发由 Agent Teams 接入。 */
  Type.Literal('TaskCreated'),
  Type.Literal('TaskCompleted'),
  Type.Literal('TeammateIdle'),
])
export type HookEvent = Static<typeof HookEvent>
export const HOOK_EVENTS: readonly HookEvent[] = HookEvent.anyOf.map((literal) => literal.const)

/** Hook 的来源：全局设置、项目文件或已批准的插件（与全局同级，ADR 0017）。 */
export const HookSource = Type.Union([Type.Literal('global'), Type.Literal('project'), Type.Literal('plugin')])
export type HookSource = Static<typeof HookSource>

/** 有结果的执行的结论。ignored：项目 Hook 的 allow（只收紧，不参与判定）。 */
export const HookOutcome = Type.Union([
  Type.Literal('blocked'),
  Type.Literal('asked'),
  Type.Literal('allowed'),
  Type.Literal('denied'),
  Type.Literal('context'),
  Type.Literal('continued'),
  Type.Literal('stopped'),
  Type.Literal('timeout'),
  Type.Literal('error'),
  Type.Literal('invalid-output'),
  Type.Literal('ignored'),
])
export type HookOutcome = Static<typeof HookOutcome>

/** hook_run.message 的上限（字符）。 */
export const HOOK_RUN_MESSAGE_MAX = 2048

/** hook_run v2：一次有结果的 Hook 执行；command 已脱敏；plugin 为来源插件的名字（source plugin）。 */
export const HookRunPayload = Type.Object(
  {
    event: HookEvent,
    hookId: Id,
    source: HookSource,
    plugin: Type.Optional(Id),
    command: Type.String(),
    outcome: HookOutcome,
    exitCode: Type.Optional(Type.Integer()),
    durationMs: Count,
    message: Type.Optional(Type.String({ maxLength: HOOK_RUN_MESSAGE_MAX })),
  },
  strict,
)
export type HookRunPayload = Static<typeof HookRunPayload>

/** 一条 command 型 Hook。timeout 为秒（上限 600）。 */
export const HookCommand = Type.Object(
  {
    type: Type.Literal('command'),
    command: Type.String({ minLength: 1 }),
    if: Type.Optional(Type.String()),
    timeout: Type.Optional(Type.Integer({ minimum: 1, maximum: 600 })),
  },
  strict,
)
export type HookCommand = Static<typeof HookCommand>

export const HookMatcherGroup = Type.Object({ matcher: Type.Optional(Type.String()), hooks: Type.Array(HookCommand) }, strict)
export type HookMatcherGroup = Static<typeof HookMatcherGroup>

/** Hook 配置：形状与 claude-code 相同（事件 → 匹配组）。 */
export const HooksConfig = Type.Record(Type.String(), Type.Array(HookMatcherGroup))
export type HooksConfig = Static<typeof HooksConfig>

/** 设置键：全局 Hook 配置；项目 Hook 的批准在 hooks.approvals.<workspaceId>。 */
export const HOOKS_SETTING = 'hooks'
export const hookApprovalsSetting = (workspaceId: string) => `hooks.approvals.${workspaceId}`
/** Hook 的设置（配置与批准）只能经 /api/hooks 修改：通用设置接口拒绝这些键。 */
export const isHooksSettingKey = (key: string) => key === HOOKS_SETTING || key.startsWith(`${HOOKS_SETTING}.`)

/**
 * 项目文件中的一条 Hook：完整命令与 digest，approved 为该 Workspace 是否已批准当前 digest；changed 为同一位置（hookId）曾经批准过、
 * 但内容已改动（digest 不同），须重新批准。
 */
export const ProjectHookEntry = Type.Object(
  {
    hookId: Id,
    event: HookEvent,
    matcher: Type.Optional(Type.String()),
    if: Type.Optional(Type.String()),
    command: Type.String(),
    timeout: Type.Optional(Type.Integer({ minimum: 1 })),
    digest: Id,
    approved: Type.Boolean(),
    changed: Type.Optional(Type.Literal(true)),
  },
  strict,
)
export type ProjectHookEntry = Static<typeof ProjectHookEntry>

/** GET /api/hooks?sessionId=：能力开关、全局配置与 revision、当前会话目录的项目 Hook。 */
export const HooksResponse = Type.Object(
  {
    enabled: Type.Boolean(),
    global: Type.Object({ hooks: HooksConfig, revision: Count, diagnostics: Type.Array(ResourceDiagnostic) }, strict),
    project: Type.Optional(Type.Object({ path: Type.String(), entries: Type.Array(ProjectHookEntry), diagnostics: Type.Array(ResourceDiagnostic) }, strict)),
  },
  strict,
)
export type HooksResponse = Static<typeof HooksResponse>

/** PUT /api/hooks：整体替换全局配置；不合 schema 400，revision 不一致 409 revision-conflict。 */
export const UpdateHooksRequest = Type.Object({ hooks: HooksConfig, expectedRevision: Count }, strict)
export type UpdateHooksRequest = Static<typeof UpdateHooksRequest>

/**
 * POST /api/hooks/approvals：批准一条项目 Hook（204；digest 不在当前项目文件中 409 digest-mismatch）。给出 sessionId 时按该 Session 的工作目录
 * （worktree 会话为其 worktree）读取项目文件，批准仍记在其 Workspace 下。
 */
export const ApproveHookRequest = Type.Object({ workspaceId: Id, digest: Id, sessionId: Type.Optional(Id) }, strict)
export type ApproveHookRequest = Static<typeof ApproveHookRequest>

export const hookPaths = {
  /** GET HooksResponse（?sessionId= 或 ?workspaceId=）/ PUT UpdateHooksRequest。 */
  hooks: '/api/hooks',
  /** POST ApproveHookRequest。 */
  approvals: '/api/hooks/approvals',
} as const

/** 本领域的 kind → payload schema。 */
export const hookEntryPayloadSchemas = {
  hook_run: HookRunPayload,
}
