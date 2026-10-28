// 条目派生读取的最小形状：结构上与 @coko/session 的 SessionEntry、协议的 SessionEntry 和 agent 的 CheckpointEntry 相容。
// 本子路径（@coko/agent/entries）在浏览器中运行：只导入 typebox 与本目录内的模块（见 entries.test.ts 的导入守卫）。

export interface EntryLike {
  seq: number
  kind: string
  runId?: string | null
  payload: unknown
}

/** 被回退的区间 [from, to)：from 为目标消息的 seq，to 为 rewind 条目的 seq。 */
export interface RewoundRange {
  from: number
  to: number
}

/** Run 结束状态（与 run_end payload 的 status 相同）。 */
export type EntryRunStatus = 'completed' | 'aborted' | 'error' | 'paused' | 'interrupted'

/** compaction 条目中派生用到的字段（完整 schema 见 session-entries/context.ts 与协议 context-entries.ts）。 */
export interface CompactionFields {
  summary: string
  firstKeptSeq: number
}

/** 结果确认等待中的调用。 */
export interface UnansweredConfirmation {
  toolCallId: string
  runId: string | null
}

/** 交给模型的消息（结构上是 pi 的 AgentMessage；本子路径不导入 pi）。 */
export type ContextMessage = { role: string; [key: string]: unknown }
