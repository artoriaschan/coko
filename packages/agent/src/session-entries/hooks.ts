// 外部 Hook 的条目 payload（ADR 0013；与 @coko/protocol 的 hooks.ts 一致，server 的 entry-payloads.ts 编译期比对）。
import { Type, type Static } from 'typebox'
import { definePayloads } from './define.ts'

const strict = { additionalProperties: false } as const
const Id = Type.String({ minLength: 1 })
const Count = Type.Integer({ minimum: 0 })

/** 支持的 Hook 事件（名字与 claude-code 相同）。 */
export const hookEventSchema = Type.Union([
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
])
export type HookEvent = Static<typeof hookEventSchema>

/** Hook 的来源：全局设置或项目文件（项目 Hook 须逐条批准，只收紧）。 */
export const hookSourceSchema = Type.Union([Type.Literal('global'), Type.Literal('project')])
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

/** hook_run v1：command 已脱敏；message 为显示给用户的原因或 systemMessage（≤ 2 KB）。 */
export const hookRunPayloadSchema = Type.Object(
  {
    event: hookEventSchema,
    hookId: Id,
    source: hookSourceSchema,
    command: Type.String(),
    outcome: hookOutcomeSchema,
    exitCode: Type.Optional(Type.Integer()),
    durationMs: Count,
    message: Type.Optional(Type.String({ maxLength: HOOK_RUN_MESSAGE_MAX })),
  },
  strict,
)
export type HookRunPayload = Static<typeof hookRunPayloadSchema>

export interface HookEntryPayloads {
  hook_run: HookRunPayload
}

export const hookEntryPayloads = definePayloads({
  hook_run: [{ schema: hookRunPayloadSchema }],
} satisfies Record<keyof HookEntryPayloads, unknown>)
