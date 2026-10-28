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
// ---- 回退与分叉（路由与 DTO） ----

/** 回退对话（追加 rewind 条目）、代码（恢复文件工具的备份）或两者。 */
export const RewindMode = Type.Union([Type.Literal('conversation'), Type.Literal('code'), Type.Literal('both')])
export type RewindMode = Static<typeof RewindMode>

/** 一个 Checkpoint：有效上下文中的一条用户消息，以及在它及之后的锚点下被 write / edit 修改过的路径（绝对路径）。 */
export const Checkpoint = Type.Object({ seq: Seq, text: Type.String(), createdAt: Type.Integer({ minimum: 0 }), paths: Type.Array(Path) }, strict)
export type Checkpoint = Static<typeof Checkpoint>

export const CheckpointListResponse = Type.Object({ checkpoints: Type.Array(Checkpoint) }, strict)
export type CheckpointListResponse = Static<typeof CheckpointListResponse>

/** targetSeq 为有效上下文中的用户消息；dryRun 只返回将发生的变化，不提交条目、不改文件。 */
export const RewindRequest = Type.Object({ targetSeq: Seq, mode: RewindMode, dryRun: Type.Optional(Type.Boolean()) }, strict)
export type RewindRequest = Static<typeof RewindRequest>

/**
 * 回退的结果（dryRun 为将要发生的）。text 为目标消息的文本（回到输入区）。文件列表只在 code / both 时有内容：
 * restored 写回备份、deleted 原先不存在而删除、diverged 当前状态与最后一次记录不一致（Agent 之外改过，照常恢复）、
 * untracked 超限未追踪而不能恢复。bash 与外部进程的改动不在其中。
 */
export const RewindResponse = Type.Object(
  {
    targetSeq: Seq,
    mode: RewindMode,
    dryRun: Type.Boolean(),
    text: Type.String(),
    restored: Type.Array(Path),
    deleted: Type.Array(Path),
    diverged: Type.Array(Path),
    untracked: Type.Array(Path),
  },
  strict,
)
export type RewindResponse = Static<typeof RewindResponse>

export const ForkRequest = Type.Object({ targetSeq: Seq }, strict)
export type ForkRequest = Static<typeof ForkRequest>

/** 新 Session 的 id（首条 fork_origin；Session 本身经列表读取）与目标消息的文本（放入新 Session 的输入区）。 */
export const ForkResponse = Type.Object({ sessionId: Type.String({ minLength: 1 }), text: Type.String() }, strict)
export type ForkResponse = Static<typeof ForkResponse>

/**
 * 回退与分叉的路由。Run 进行中或等待审批时 409 session-busy；有未回答的结果确认时 409 confirmation-pending；
 * targetSeq 不是有效的用户消息时 400 bad-request。
 */
export const checkpointPaths = {
  /** GET CheckpointListResponse。 */
  sessionCheckpoints: (id: string) => `/api/sessions/${encodeURIComponent(id)}/checkpoints`,
  /** POST RewindRequest → 200 RewindResponse。 */
  sessionRewind: (id: string) => `/api/sessions/${encodeURIComponent(id)}/rewind`,
  /** POST ForkRequest → 201 ForkResponse。 */
  sessionFork: (id: string) => `/api/sessions/${encodeURIComponent(id)}/fork`,
} as const
