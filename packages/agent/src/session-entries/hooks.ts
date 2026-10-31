// 外部 Hook 的条目 payload（ADR 0013；与 @coko/protocol 的 hooks.ts 一致，server 的 entry-payloads.ts 编译期比对）。
import { Type, type Static } from 'typebox'
import { definePayloads, type EntryJson } from './define.ts'

const strict = { additionalProperties: false } as const
const Id = Type.String({ minLength: 1 })
const Count = Type.Integer({ minimum: 0 })

const hookEventsV1 = [
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
] as const

/** 团队事件（ADR 0018）：没有 matcher；分发由 Agent Teams 接入。 */
const teamHookEvents = [Type.Literal('TaskCreated'), Type.Literal('TaskCompleted'), Type.Literal('TeammateIdle')] as const
export const TEAM_HOOK_EVENTS: ReadonlySet<string> = new Set(teamHookEvents.map((literal) => literal.const))

/** 支持的 Hook 事件（名字与 claude-code 相同）。 */
export const hookEventSchema = Type.Union([...hookEventsV1, ...teamHookEvents])
export type HookEvent = Static<typeof hookEventSchema>

const hookSourcesV1 = [Type.Literal('global'), Type.Literal('project')] as const

/** Hook 的来源：全局设置、项目文件（项目 Hook 须逐条批准，只收紧）或已批准的插件（与全局同级，ADR 0017）。 */
export const hookSourceSchema = Type.Union([...hookSourcesV1, Type.Literal('plugin')])
export type HookSource = Static<typeof hookSourceSchema>

/** 一次有结果的 Hook 执行的结论；没有决定的成功执行不提交条目。ignored：项目 Hook 的 allow（只收紧，不参与判定）。 */
export const hookOutcomeSchema = Type.Union([
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
export type HookOutcome = Static<typeof hookOutcomeSchema>

/** hook_run 的 message 上限（字符）。 */
export const HOOK_RUN_MESSAGE_MAX = 2048

const hookRunFields = {
  hookId: Id,
  command: Type.String(),
  outcome: hookOutcomeSchema,
  exitCode: Type.Optional(Type.Integer()),
  durationMs: Count,
  message: Type.Optional(Type.String({ maxLength: HOOK_RUN_MESSAGE_MAX })),
}

/** hook_run v1：command 已脱敏；message 为显示给用户的原因或 systemMessage（≤ 2 KB）。 */
const hookRunV1Schema = Type.Object({ ...hookRunFields, event: Type.Union([...hookEventsV1]), source: Type.Union([...hookSourcesV1]) }, strict)

/** hook_run v2：source 增加 plugin（另带插件名 plugin），event 增加团队事件（v1 原样迁移）。 */
export const hookRunPayloadSchema = Type.Object({ ...hookRunFields, event: hookEventSchema, source: hookSourceSchema, plugin: Type.Optional(Id) }, strict)
export type HookRunPayload = Static<typeof hookRunPayloadSchema>

export interface HookEntryPayloads {
  hook_run: HookRunPayload
}

export const hookEntryPayloads = definePayloads({
  hook_run: [{ schema: hookRunV1Schema }, { schema: hookRunPayloadSchema, migrate: (previous: EntryJson) => previous }],
} satisfies Record<keyof HookEntryPayloads, unknown>)
