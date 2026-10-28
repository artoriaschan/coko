// Checkpoint、Rewind 与 Fork 的条目 payload（ADR 0006）。
import { Type, type Static } from 'typebox'
import { definePayloads } from './define.ts'

const strict = { additionalProperties: false } as const
const Seq = Type.Integer({ minimum: 1 })
const Sha256 = Type.String({ pattern: '^[0-9a-f]{64}$' })

/** 锚点（anchorSeq，一条用户消息）下首次修改某路径前的原内容：blob 引用、原先不存在，或超限未追踪。 */
export const fileBackupPayloadSchema = Type.Union([
  Type.Object({ anchorSeq: Seq, path: Type.String({ minLength: 1 }), blob: Sha256 }, strict),
  Type.Object({ anchorSeq: Seq, path: Type.String({ minLength: 1 }), absent: Type.Literal(true) }, strict),
  Type.Object({ anchorSeq: Seq, path: Type.String({ minLength: 1 }), untracked: Type.Literal(true) }, strict),
])
export type FileBackupPayload = Static<typeof fileBackupPayloadSchema>

export const fileChangePayloadSchema = Type.Object({ anchorSeq: Seq, path: Type.String({ minLength: 1 }), afterHash: Sha256 }, strict)
export type FileChangePayload = Static<typeof fileChangePayloadSchema>

/** 回退对话：有效上下文跳过 [targetSeq, 本条目) 区间。 */
export const rewindPayloadSchema = Type.Object({ targetSeq: Seq }, strict)
export type RewindPayload = Static<typeof rewindPayloadSchema>

/** 分叉后新 Session 的第一条：来源 Session 与目标消息的 seq。 */
export const forkOriginPayloadSchema = Type.Object({ sessionId: Type.String({ minLength: 1 }), seq: Seq }, strict)
export type ForkOriginPayload = Static<typeof forkOriginPayloadSchema>

export interface CheckpointEntryPayloads {
  file_backup: FileBackupPayload
  file_change: FileChangePayload
  rewind: RewindPayload
  fork_origin: ForkOriginPayload
}

export const checkpointEntryPayloads = definePayloads({
  file_backup: [{ schema: fileBackupPayloadSchema }],
  file_change: [{ schema: fileChangePayloadSchema }],
  rewind: [{ schema: rewindPayloadSchema }],
  fork_origin: [{ schema: forkOriginPayloadSchema }],
} satisfies Record<keyof CheckpointEntryPayloads, unknown>)
