import { Type, type Static } from 'typebox'

// Checkpoint、Rewind 与 Fork 的条目 payload（ADR 0006）。

const strict = { additionalProperties: false } as const
const Seq = Type.Integer({ minimum: 1 })
const Path = Type.String({ minLength: 1 })
const Sha256 = Type.String({ pattern: '^[0-9a-f]{64}$' })

export const FileBackupPayload = Type.Union([
  Type.Object({ anchorSeq: Seq, path: Path, blob: Sha256 }, strict),
  Type.Object({ anchorSeq: Seq, path: Path, absent: Type.Literal(true) }, strict),
  Type.Object({ anchorSeq: Seq, path: Path, untracked: Type.Literal(true) }, strict),
])
export type FileBackupPayload = Static<typeof FileBackupPayload>

export const FileChangePayload = Type.Object({ anchorSeq: Seq, path: Path, afterHash: Sha256 }, strict)
export type FileChangePayload = Static<typeof FileChangePayload>

export const RewindPayload = Type.Object({ targetSeq: Seq }, strict)
export type RewindPayload = Static<typeof RewindPayload>

export const ForkOriginPayload = Type.Object({ sessionId: Type.String({ minLength: 1 }), seq: Seq }, strict)
export type ForkOriginPayload = Static<typeof ForkOriginPayload>

export const checkpointEntryPayloadSchemas = {
  file_backup: FileBackupPayload,
  file_change: FileChangePayload,
  rewind: RewindPayload,
  fork_origin: ForkOriginPayload,
}
