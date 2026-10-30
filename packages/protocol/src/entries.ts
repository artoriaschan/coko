import { Type, type Static, type TSchema } from 'typebox'
import { agentEntryPayloadSchemas } from './agents.ts'
import { checkpointEntryPayloadSchemas } from './checkpoints.ts'
import { contextEntryPayloadSchemas } from './context-entries.ts'
import { goalEntryPayloadSchemas } from './goal.ts'
import { handoffEntryPayloadSchemas } from './handoff.ts'
import { hookEntryPayloadSchemas } from './hooks.ts'
import { jobEntryPayloadSchemas } from './jobs.ts'
import { permissionEntryPayloadSchemas } from './permissions.ts'
import { planningEntryPayloadSchemas } from './planning.ts'
import { runEntryPayloadSchemas } from './runs.ts'
import { scheduleEntryPayloadSchemas } from './schedules.ts'
import { todoEntryPayloadSchemas } from './todo.ts'

// Session Entry：线上信封（SessionEntryRecord，payload 未校验）与按 kind 判别的 SessionEntry。
// 各 kind 的 payload schema 在领域文件（runs.ts、permissions.ts、checkpoints.ts、context-entries.ts、goal.ts、todo.ts、planning.ts、jobs.ts、hooks.ts、
// agents.ts、schedules.ts、handoff.ts）中维护，
// 本文件不随 kind 的 schema 变化而修改。

const strict = { additionalProperties: false } as const
const Id = Type.String({ minLength: 1 })

const envelope = {
  sessionId: Id,
  seq: Type.Integer({ minimum: 1 }),
  payloadVersion: Type.Integer({ minimum: 1 }),
  runId: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.Integer({ minimum: 0 }),
}

/**
 * 已提交、不可修改的 Session Entry 的线上形状；seq 在 Session 内从 1 递增（读回时被跳过的损坏条目留下空缺）。
 * payload 在客户端的信任边界按 SessionEntry 逐条校验，不合格的条目跳过，不影响同一响应中的其他条目。
 */
export const SessionEntryRecord = Type.Object({ ...envelope, kind: Type.String(), payload: Type.Unknown() }, strict)
export type SessionEntryRecord = Static<typeof SessionEntryRecord>

export const SESSION_ENTRY_PAYLOAD_SCHEMAS = {
  ...runEntryPayloadSchemas,
  ...permissionEntryPayloadSchemas,
  ...checkpointEntryPayloadSchemas,
  ...contextEntryPayloadSchemas,
  ...goalEntryPayloadSchemas,
  ...todoEntryPayloadSchemas,
  ...planningEntryPayloadSchemas,
  ...jobEntryPayloadSchemas,
  ...hookEntryPayloadSchemas,
  ...agentEntryPayloadSchemas,
  ...scheduleEntryPayloadSchemas,
  ...handoffEntryPayloadSchemas,
}
type PayloadSchemas = typeof SESSION_ENTRY_PAYLOAD_SCHEMAS
export type SessionEntryKind = keyof PayloadSchemas

type EntryOf<K extends SessionEntryKind> = Omit<SessionEntryRecord, 'kind' | 'payload'> & { kind: K; payload: Static<PayloadSchemas[K]> }

/** 按 kind 判别的 Session Entry；payload 为该 kind 当前版本的 schema。 */
export type SessionEntry = { [K in SessionEntryKind]: EntryOf<K> }[SessionEntryKind]

export const SessionEntry = Type.Unsafe<SessionEntry>(
  Type.Union(
    Object.entries(SESSION_ENTRY_PAYLOAD_SCHEMAS).map(([kind, payload]: [string, TSchema]) =>
      Type.Object({ ...envelope, kind: Type.Literal(kind), payload }, strict),
    ),
  ),
)

/** 某个 kind 的条目。 */
export type SessionEntryOf<K extends SessionEntryKind> = Extract<SessionEntry, { kind: K }>
