// 交接（Handoff）：摘要提示、准入判定与目标 Session 的条目推导。摘要请求由运行时的摘要模式发出（trigger handoff：有效上下文加这里的提示，
// 不注册工具）；目标 Session 只复制权限状态（模式与 Session 规则），权限继承与"从此分叉"相同，工具加载、消息、Goal、Todo、计划、Job、子代理与定时任务不复制。
import type { RunEntry } from '../engine/types.ts'
import { effectiveEntries } from '../entries/index.ts'
import type { EntryLike } from '../entries/types.ts'

/** 交接摘要的上限（字符；与 @coko/protocol 的 HANDOFF_SUMMARY_MAX 相同）。超出时截断。 */
export const HANDOFF_SUMMARY_MAX_CHARS = 12_000

/** 目标 Session 复制的条目种类：只复制权限状态；分叉另继承边界内的工具加载记录，交接不继承。 */
export const HANDOFF_COPIED_KINDS: ReadonlySet<string> = new Set(['permission_mode', 'permission_rule'])

/** 摘要提示：模型只回复交接摘要（Markdown），四个小节依次为 Context、Files、Open items 与 Task。 */
export function handoffPrompt(instructions: string): string {
  return [
    'Hand this work off to a new session. Write a handoff summary that another agent, starting with an empty context, will use as its first message.',
    'Reply with the summary only, in Markdown, using exactly these sections:',
    '## Context: the decisions made and the approach taken, with the reasons that still matter.',
    '## Files: the files read or changed and what each one is for.',
    '## Open items: unfinished work and the state of any goal, todo list, background jobs, subagents and scheduled tasks; write "None" when there are none.',
    '## Task: the next goal below, restated as concrete next steps.',
    `Keep the summary under ${HANDOFF_SUMMARY_MAX_CHARS} characters. Do not call tools.`,
    '',
    '<next-goal>',
    instructions.trim(),
    '</next-goal>',
  ].join('\n')
}

/** 有效上下文中（回退区间之外）是否有用户消息：没有时没有可交接的内容。 */
export function hasUserMessage(entries: readonly EntryLike[]): boolean {
  return effectiveEntries(entries).some((entry) => entry.kind === 'message' && (entry.payload as { role?: unknown }).role === 'user')
}

/** 摘要的最终文本：去掉首尾空白，超过上限时截断。 */
export function handoffSummaryText(summary: string): string {
  const text = summary.trim()
  return text.length > HANDOFF_SUMMARY_MAX_CHARS ? text.slice(0, HANDOFF_SUMMARY_MAX_CHARS) : text
}

/**
 * 目标 Session 的条目：首条 handoff_origin（指向源 Session 中 handoff 条目的 seq），之后是源 Session 有效条目中的权限条目（去掉 runId，
 * 顺序不变）。
 */
export function handoffTargetEntries(entries: readonly EntryLike[], sourceSessionId: string, handoffSeq: number): RunEntry[] {
  const origin: RunEntry = { kind: 'handoff_origin', payload: { sessionId: sourceSessionId, seq: handoffSeq } }
  const copied = effectiveEntries(entries)
    .filter((entry) => HANDOFF_COPIED_KINDS.has(entry.kind))
    .map((entry) => ({ kind: entry.kind, payload: entry.payload }) as RunEntry)
  return [origin, ...copied]
}
