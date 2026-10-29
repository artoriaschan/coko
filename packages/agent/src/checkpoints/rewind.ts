// 回退（ADR 0006）：rewind 条目把 [targetSeq, 本条目) 区间移出有效上下文；原条目保留。多次回退叠加：
// 目标只能是当时有效的用户消息，各区间要么嵌套、要么不相交，被任一区间覆盖的条目都不在有效上下文中。
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { effectiveEntries, modelContext } from '../entries/index.ts'
import { isProtectedPath, isWithin } from '../policy/decide.ts'
import { realLocation } from '../policy/paths.ts'
import type { RewindFiles } from '../ports/checkpoints.ts'
import type { RunEntry } from '../engine/types.ts'
import type { FileBackupPayload, FileChangePayload, RunEndPayload, ToolExecPayload } from '../session-entries/index.ts'
import { CHECKPOINT_TOOLS, type CheckpointEntry } from './tracker.ts'

// 有效条目与模型上下文的唯一实现在 entries/（@coko/agent/entries）；这里只保留回退计划与文件恢复。

/** 模型可见的对话记录（恢复运行时用）：entries/ 的 modelContext（回退与压缩都已应用）。 */
export function effectiveMessages(entries: readonly CheckpointEntry[]): AgentMessage[] {
  return modelContext(entries) as AgentMessage[]
}
/** 回退对话、代码或两者（ADR 0006）。 */
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
  // 只应用回退：压缩之前的用户消息仍是 Checkpoint（回退到它时压缩落在被回退区间，原历史生效）。
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
export type { RewindFiles } from '../ports/checkpoints.ts'

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
  /**
   * 将恢复或删除的路径中位于 Workspace 之外或属于受保护路径（.git、.coko、shell 配置等）的：照常处理，确认对话框单独列出并警告。
   */
  outside: string[]
  /** 真实路径与记录不一致（例如父目录在备份之后被换成了符号链接）而不处理的路径：不跟随链接写到别处。 */
  skipped: string[]
}

/** 空的回退报告（只回退对话时）。 */
export const emptyRewindReport = (): RewindReport => ({ restored: [], deleted: [], diverged: [], untracked: [], outside: [], skipped: [] })

export interface RestoreOptions {
  /** Workspace 的真实路径：之外的路径列入 outside。 */
  workspace: string
  /** 只返回报告，不改文件。 */
  dryRun?: boolean
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

/** 路径的真实位置仍是记录的位置（备份时记录的就是真实路径）。 */
const unchanged = async (path: string) => (await realLocation(path)) === path

/**
 * 按计划恢复文件（ADR 0006）。先判定全部路径，再依次写入；dryRun 只返回报告。每个路径先重新解析真实路径：与记录不同时（父目录被
 * 换成了符号链接等）列入 skipped 且不处理；写入与删除前再复核一次。备份内容经端口原子写回原路径（父目录不在时重建），原先不存在的
 * 删除；未追踪的不动。Workspace 之外与受保护路径列入 outside。读不到快照正文等失败原样抛出（此前已写入的文件不回滚）。
 */
export async function restoreFiles(files: readonly RewindFilePlan[], port: RewindFiles, options: RestoreOptions): Promise<RewindReport> {
  const report = emptyRewindReport()
  const writes: { path: string; blob: string }[] = []
  const deletes: string[] = []
  for (const file of files) {
    if (!(await unchanged(file.path))) {
      report.skipped.push(file.path)
      continue
    }
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
  report.outside = [...report.restored, ...report.deleted].filter(
    (path) => !isWithin(path, options.workspace) || isProtectedPath({ resolved: path, real: path }),
  )
  if (options.dryRun) return report
  const recheck = async (path: string) => {
    if (await unchanged(path)) return true
    report.skipped.push(path)
    report.restored = report.restored.filter((p) => p !== path)
    report.deleted = report.deleted.filter((p) => p !== path)
    return false
  }
  for (const { path, blob } of writes) {
    const bytes = await port.readBlob(blob)
    if (await recheck(path)) await port.writeFile(path, bytes)
  }
  for (const path of deletes) if (await recheck(path)) await port.remove(path)
  return report
}
