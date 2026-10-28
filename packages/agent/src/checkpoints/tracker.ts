// Checkpoint tracker（ADR 0006）：每条已提交的用户消息（含 Run 中途送达的追加指令）是一个锚点。write、edit 在某个锚点下
// 第一次修改某路径之前，经 SnapshotPort 保存原内容并提交 file_backup；修改之后提交 file_change { afterHash }。
// 经 ToolHooks 接入，位于权限 hook 之后：被拒绝或等待中的调用不备份。bash 与外部进程的改动不追踪。
import type { BeforeToolCallResult } from '@earendil-works/pi-agent-core'
import type { ToolHooks } from '../extensions/hooks.ts'
import type { SnapshotPort } from '../ports/checkpoints.ts'
import { realLocation } from '../policy/paths.ts'
import type { FileBackupPayload, FileChangePayload } from '../session-entries/index.ts'
import { resolveToCwd } from '../tools/paths.ts'
import type { RunEntry } from '../engine/types.ts'

export type { SnapshotPort } from '../ports/checkpoints.ts'

/** tracker 读取的已提交条目（结构上与 @coko/session 的 SessionEntry 相容）。 */
export interface CheckpointEntry {
  seq: number
  kind: string
  runId?: string | null
  payload: unknown
}

export interface CheckpointTrackerOptions {
  /** Workspace 目录；相对路径参数按它解析。 */
  cwd: string
  snapshots: SnapshotPort
  /** 提交并发布一条条目，兑现为已提交的条目（带 seq）。 */
  commit: (entry: RunEntry) => Promise<CheckpointEntry>
  /** 已提交的条目（Session 打开时读一次），用来恢复当前锚点与已备份的路径。 */
  history: () => Promise<readonly CheckpointEntry[]>
  /** 追踪的工具与其路径参数；默认 write、edit 的 `path`。 */
  tools?: Readonly<Record<string, string>>
  /** 备份或摘要失败时的诊断（不含文件内容）。 */
  onError?: (error: unknown, context: { phase: 'backup' | 'change'; toolCallId: string }) => void
}

export interface CheckpointTracker {
  /** 放在权限 hook 之后（AgentRuntimeOptions.hooks）。 */
  readonly hooks: ToolHooks
  /** 每条条目提交之后调用（含运行时与 tracker 自己提交的）。 */
  observe(entry: CheckpointEntry): void
}

/** 内置文件工具：write 与 edit 的 path 参数（ADR 0006 的追踪范围）。 */
export const CHECKPOINT_TOOLS: Readonly<Record<string, string>> = { write: 'path', edit: 'path' }

interface PendingChange {
  anchorSeq: number
  path: string
}

const isUserMessage = (entry: CheckpointEntry) =>
  entry.kind === 'message' && typeof entry.payload === 'object' && entry.payload !== null && (entry.payload as { role?: unknown }).role === 'user'

export function createCheckpointTracker(options: CheckpointTrackerOptions): CheckpointTracker {
  const tools = options.tools ?? CHECKPOINT_TOOLS
  let anchorSeq: number | undefined
  /** 当前锚点下已备份（或正在备份）的真实路径。 */
  let backedUp = new Map<string, Promise<void>>()
  let runId: string | undefined
  const changes = new Map<string, PendingChange>()

  const apply = (entry: CheckpointEntry) => {
    if (isUserMessage(entry)) {
      if (anchorSeq === undefined || entry.seq > anchorSeq) {
        anchorSeq = entry.seq
        backedUp = new Map()
      }
    } else if (entry.kind === 'file_backup') {
      const payload = entry.payload as FileBackupPayload
      if (payload.anchorSeq === anchorSeq && !backedUp.has(payload.path)) backedUp.set(payload.path, Promise.resolve())
    } else if (entry.kind === 'run_start') {
      runId = entry.runId ?? undefined
    } else if (entry.kind === 'run_end') {
      runId = undefined
      changes.clear()
    }
  }

  // 读入历史期间到达的条目先缓存，读完后按 seq 去重再应用。
  let buffered: CheckpointEntry[] | undefined = []
  const ready = options.history().then(
    (entries) => {
      let last = 0
      for (const entry of entries) {
        apply(entry)
        last = Math.max(last, entry.seq)
      }
      for (const entry of buffered ?? []) if (entry.seq > last) apply(entry)
      buffered = undefined
    },
    (error: unknown) => {
      buffered = undefined
      throw error
    },
  )
  ready.catch(() => undefined)

  const target = (toolName: string, args: unknown): string | undefined => {
    const key = tools[toolName]
    if (key === undefined || typeof args !== 'object' || args === null) return undefined
    const value = (args as Record<string, unknown>)[key]
    return typeof value === 'string' && value !== '' ? value : undefined
  }

  const backup = async (anchor: number, path: string) => {
    const saved = await options.snapshots.saveFile(path)
    const payload: FileBackupPayload =
      saved.kind === 'stored'
        ? { anchorSeq: anchor, path, blob: saved.hash }
        : saved.kind === 'absent'
          ? { anchorSeq: anchor, path, absent: true }
          : { anchorSeq: anchor, path, untracked: true }
    await options.commit({ kind: 'file_backup', ...(runId ? { runId } : {}), payload })
  }

  const block = (reason: string): BeforeToolCallResult => ({ block: true, reason })

  const hooks: ToolHooks = {
    async beforeToolCall({ toolCall, args }) {
      const subject = target(toolCall.name, args)
      if (subject === undefined) return undefined
      try {
        await ready
      } catch (error) {
        options.onError?.(error, { phase: 'backup', toolCallId: toolCall.id })
        return block('Checkpoint unavailable: the Session history could not be read, so the file was not changed.')
      }
      if (anchorSeq === undefined) return undefined
      const anchor = anchorSeq
      const path = await realLocation(resolveToCwd(subject, options.cwd))
      let pending = backedUp.get(path)
      if (!pending) {
        const map = backedUp
        pending = backup(anchor, path)
        map.set(path, pending)
        pending.catch(() => {
          if (map.get(path) === pending) map.delete(path)
        })
      }
      try {
        await pending
      } catch (error) {
        options.onError?.(error, { phase: 'backup', toolCallId: toolCall.id })
        return block('Checkpoint backup failed, so the file was not changed. Tell the user that the file snapshot could not be saved.')
      }
      changes.set(toolCall.id, { anchorSeq: anchor, path })
      return undefined
    },
    async afterToolCall({ toolCall }) {
      const change = changes.get(toolCall.id)
      if (!change) return undefined
      changes.delete(toolCall.id)
      let afterHash: string
      try {
        afterHash = await options.snapshots.hashFile(change.path)
      } catch (error) {
        // 修改后文件不存在（或不可读）：没有可记录的新内容。
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') options.onError?.(error, { phase: 'change', toolCallId: toolCall.id })
        return undefined
      }
      const payload: FileChangePayload = { anchorSeq: change.anchorSeq, path: change.path, afterHash }
      try {
        await options.commit({ kind: 'file_change', ...(runId ? { runId } : {}), payload })
      } catch (error) {
        options.onError?.(error, { phase: 'change', toolCallId: toolCall.id })
      }
      return undefined
    },
  }

  return {
    hooks,
    observe(entry) {
      if (buffered) buffered.push(entry)
      else apply(entry)
    },
  }
}
