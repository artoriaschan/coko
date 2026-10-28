// 回退（ADR 0006，grilling G3）：rewind 条目把 [targetSeq, 本条目) 区间移出有效上下文；原条目保留。多次回退叠加：
// 目标只能是当时有效的用户消息，各区间要么嵌套、要么不相交，被任一区间覆盖的条目都不在有效上下文中。
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type { RunEntry } from '../engine/types.ts'
import type { FileBackupPayload, FileChangePayload, RewindPayload, RunEndPayload, ToolExecPayload } from '../session-entries/index.ts'
import { CHECKPOINT_TOOLS, type CheckpointEntry } from './tracker.ts'

/** 被回退的区间 [from, to)：from 为目标消息的 seq，to 为 rewind 条目的 seq。 */
export interface RewoundRange {
  from: number
  to: number
}

/** 全部 rewind 条目的区间（按 rewind 条目顺序）。 */
export function rewoundRanges(entries: readonly CheckpointEntry[]): RewoundRange[] {
  return entries.flatMap((entry) => (entry.kind === 'rewind' ? [{ from: (entry.payload as RewindPayload).targetSeq, to: entry.seq }] : []))
}

/** 有效条目：不在任何被回退区间内、且不是 rewind 条目本身。 */
export function effectiveEntries<E extends CheckpointEntry>(entries: readonly E[]): E[] {
  const ranges = rewoundRanges(entries)
  if (ranges.length === 0) return [...entries]
  return entries.filter((entry) => entry.kind !== 'rewind' && !ranges.some((range) => entry.seq >= range.from && entry.seq < range.to))
}

/** 模型可见的对话记录：有效条目中的 message payload（恢复运行时用）。 */
export function effectiveMessages(entries: readonly CheckpointEntry[]): AgentMessage[] {
  return effectiveEntries(entries)
    .filter((entry) => entry.kind === 'message')
    .map((entry) => entry.payload as AgentMessage)
}
/** 回退对话、代码或两者（grilling G3）。 */
export type RewindMode = 'conversation' | 'code' | 'both'

/** 目标不是有效的用户消息（不存在、不是用户消息，或已在被回退的区间内）。 */
export class RewindTargetError extends Error {
  override readonly name = 'RewindTargetError'
  readonly targetSeq: number
  constructor(targetSeq: number) {
    super(`Entry ${targetSeq} is not a user message in the current conversation`)
    this.targetSeq = targetSeq
  }
}

/** 回退代码时某个路径要回到的状态：最早一份备份的内容、原先不存在（删除），或超限未追踪（不能恢复）。 */
export type RewindRestore = { kind: 'content'; blob: string } | { kind: 'delete' } | { kind: 'untracked' }

/**
 * 该路径最后一次记录的状态（用来发现 Agent 之外的改动）：最后一次 file_change 的摘要，或之后没有 file_change 时备份的状态。
 * unknown：被中断的 Run 中有 write / edit 执行了却没有记录 file_change（启动恢复补齐的结果），或备份超限未追踪。
 */
export type RewindRecorded = { kind: 'content'; hash: string } | { kind: 'absent' } | { kind: 'unknown' }

export interface RewindFilePlan {
  path: string
  restore: RewindRestore
  recorded: RewindRecorded
}

export interface RewindPlan {
  targetSeq: number
  mode: RewindMode
  /** 目标用户消息的文本（回到输入区）。 */
  text: string
  /** 回退对话时要提交的条目（mode 为 code 时省略）。 */
  entry?: Extract<RunEntry, { kind: 'rewind' }>
  /** 回退代码时涉及的路径，按第一次备份的顺序（mode 为 conversation 时为空）。 */
  files: RewindFilePlan[]
}

export interface RewindPlanOptions {
  /** 追踪的工具（名称 → 路径参数）；默认 CHECKPOINT_TOOLS。只用其名称判断执行记录。 */
  tools?: Readonly<Record<string, string>>
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

/** 用户消息的文本（字符串或 text 块，块之间换行）。 */
export function userMessageText(payload: unknown): string | undefined {
  if (!isRecord(payload) || payload.role !== 'user') return undefined
  const content = payload.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.flatMap((block: unknown) => (isRecord(block) && block.type === 'text' && typeof block.text === 'string' ? [block.text] : [])).join('\n')
}

/** 有效上下文中的用户消息（Checkpoint 锚点）；不是时抛 RewindTargetError。 */
export function rewindTarget(entries: readonly CheckpointEntry[], targetSeq: number): { entry: CheckpointEntry; text: string } {
  const entry = effectiveEntries(entries).find((e) => e.seq === targetSeq)
  const text = entry?.kind === 'message' ? userMessageText(entry.payload) : undefined
  if (!entry || text === undefined) throw new RewindTargetError(targetSeq)
  return { entry, text }
}

/** 每个追踪过的路径最后一次记录的状态（全部条目，含被回退区间内的：文件改动并未随对话回退）。 */
function recordedStates(entries: readonly CheckpointEntry[], toolNames: ReadonlySet<string>): Map<string, RewindRecorded> {
  const recorded = new Map<string, RewindRecorded>()
  /** 每个 Run 中追踪工具的执行数、file_change 数与涉及的路径。 */
  const runs = new Map<string, { execs: number; changes: number; paths: Set<string> }>()
  const runOf = (runId: string | null | undefined) => {
    if (!runId) return undefined
    let run = runs.get(runId)
    if (!run) runs.set(runId, (run = { execs: 0, changes: 0, paths: new Set() }))
    return run
  }
  for (const entry of entries) {
    if (entry.kind === 'file_backup') {
      const payload = entry.payload as FileBackupPayload
      recorded.set(payload.path, 'blob' in payload ? { kind: 'content', hash: payload.blob } : 'absent' in payload ? { kind: 'absent' } : { kind: 'unknown' })
      runOf(entry.runId)?.paths.add(payload.path)
    } else if (entry.kind === 'file_change') {
      const payload = entry.payload as FileChangePayload
      recorded.set(payload.path, { kind: 'content', hash: payload.afterHash })
      const run = runOf(entry.runId)
      if (run) {
        run.changes++
        run.paths.add(payload.path)
      }
    } else if (entry.kind === 'tool_exec') {
      if (toolNames.has((entry.payload as ToolExecPayload).toolName)) {
        const run = runOf(entry.runId)
        if (run) run.execs++
      }
    } else if (entry.kind === 'run_end' && (entry.payload as RunEndPayload).status === 'interrupted') {
      // 启动恢复补齐的 write / edit 结果没有 file_change：这些路径的当前内容无从比对，不报告为"Agent 之外改过"。
      const run = entry.runId ? runs.get(entry.runId) : undefined
      if (run && run.execs > run.changes) for (const path of run.paths) recorded.set(path, { kind: 'unknown' })
    }
  }
  return recorded
}

/**
 * 回退计划（纯函数，ADR 0006）。conversation：提交 rewind 条目，有效上下文跳过 [targetSeq, rewind)。code：对目标锚点及其之后
 * 锚点追踪过的每个路径恢复最早的一份备份，原先不存在的删除，并给出最后记录的状态供比对。both：两者。
 * 目标不是有效的用户消息时抛 RewindTargetError。
 */
export function planRewind(entries: readonly CheckpointEntry[], targetSeq: number, mode: RewindMode, options: RewindPlanOptions = {}): RewindPlan {
  const { text } = rewindTarget(entries, targetSeq)
  const plan: RewindPlan = { targetSeq, mode, text, files: [] }
  if (mode !== 'code') plan.entry = { kind: 'rewind', payload: { targetSeq } }
  if (mode === 'conversation') return plan

  const restores = new Map<string, RewindRestore>()
  for (const entry of entries) {
    if (entry.kind !== 'file_backup') continue
    const payload = entry.payload as FileBackupPayload
    if (payload.anchorSeq < targetSeq || restores.has(payload.path)) continue
    restores.set(payload.path, 'blob' in payload ? { kind: 'content', blob: payload.blob } : 'absent' in payload ? { kind: 'delete' } : { kind: 'untracked' })
  }
  const recorded = recordedStates(entries, new Set(Object.keys(options.tools ?? CHECKPOINT_TOOLS)))
  plan.files = [...restores].map(([path, restore]) => ({ path, restore, recorded: recorded.get(path) ?? { kind: 'unknown' } }))
  return plan
}
/** 回退代码的文件端口：当前内容的摘要与快照正文（宿主实现，Sidecar 为 @coko/session/blobs）。 */
export interface RewindFiles {
  /** 文件当前内容的 SHA-256；不存在时以 ENOENT 拒绝。 */
  hashFile(path: string): Promise<string>
  /** 快照正文；不存在时拒绝。 */
  readBlob(hash: string): Promise<Uint8Array>
}

/** 回退代码的结果（dry-run 为将要发生的）：路径为绝对路径。 */
export interface RewindReport {
  /** 写回备份内容的文件（当前内容已等于备份的不列出）。 */
  restored: string[]
  /** 原先不存在、被删除的文件（已不存在的不列出）。 */
  deleted: string[]
  /** 当前状态与最后一次记录不一致：在 Agent 之外被改过或删除。它们照常恢复。 */
  diverged: string[]
  /** 超限未追踪、不能恢复的文件；保持不动。 */
  untracked: string[]
}

const isMissing = (error: unknown) => {
  const code = (error as NodeJS.ErrnoException).code
  return code === 'ENOENT' || code === 'ENOTDIR'
}

async function currentHash(files: RewindFiles, path: string): Promise<string | undefined> {
  try {
    return await files.hashFile(path)
  } catch (error) {
    if (isMissing(error)) return undefined
    throw error
  }
}

/**
 * 按计划恢复文件（ADR 0006）。先判定全部路径，再依次写入；dryRun 只返回报告。备份内容写回原路径（父目录不在时重建），
 * 原先不存在的删除；未追踪的不动。读不到快照正文等失败原样抛出（此前已写入的文件不回滚）。
 */
export async function restoreFiles(files: readonly RewindFilePlan[], port: RewindFiles, options: { dryRun?: boolean } = {}): Promise<RewindReport> {
  const report: RewindReport = { restored: [], deleted: [], diverged: [], untracked: [] }
  const writes: { path: string; blob: string }[] = []
  const deletes: string[] = []
  for (const file of files) {
    const current = await currentHash(port, file.path)
    const { recorded, restore } = file
    if (recorded.kind === 'content' ? current !== recorded.hash : recorded.kind === 'absent' ? current !== undefined : false) report.diverged.push(file.path)
    if (restore.kind === 'untracked') report.untracked.push(file.path)
    else if (restore.kind === 'delete') {
      if (current !== undefined) deletes.push(file.path)
    } else if (current !== restore.blob) writes.push({ path: file.path, blob: restore.blob })
  }
  report.restored = writes.map((w) => w.path)
  report.deleted = [...deletes]
  if (options.dryRun) return report
  for (const { path, blob } of writes) {
    const bytes = await port.readBlob(blob)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, bytes)
  }
  for (const path of deletes) await rm(path, { force: true })
  return report
}
/** 分叉时复制的条目种类：模型可见消息与 Session 的权限状态（模式、Session 规则）。 */
const FORK_KINDS = new Set(['message', 'permission_mode', 'permission_rule'])

/**
 * 从某条用户消息分叉（ADR 0006，grilling G4）：新 Session 的条目为 fork_origin，之后是目标之前的有效消息与权限条目（去掉 runId）。
 * Run 生命周期、审批、执行记录与快照引用不复制：它们的 Run 与锚点属于原 Session；Workspace 文件不复制。
 * 目标不是有效的用户消息时抛 RewindTargetError。
 */
export function forkEntries(entries: readonly CheckpointEntry[], sessionId: string, targetSeq: number): { text: string; entries: RunEntry[] } {
  const { text } = rewindTarget(entries, targetSeq)
  const copied = effectiveEntries(entries)
    .filter((entry) => entry.seq < targetSeq && FORK_KINDS.has(entry.kind))
    .map((entry) => ({ kind: entry.kind, payload: entry.payload }) as RunEntry)
  return { text, entries: [{ kind: 'fork_origin', payload: { sessionId, seq: targetSeq } }, ...copied] }
}
