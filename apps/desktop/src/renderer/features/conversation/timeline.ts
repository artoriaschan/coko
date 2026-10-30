import {
  fileReferencePath,
  type ApprovalDecisionPayload,
  type ApprovalRequestPayload,
  type CommandPayload,
  type CompactionPayload,
  type GoalPayload,
  type JobEndPayload,
  type JobNotificationPayload,
  type JobStartPayload,
  type PlanPayload,
  type SessionEntry,
} from '@coko/protocol'
import { rewoundRanges } from '@coko/agent/entries'
import type { Conversation, LiveTool } from '../../stores/chat-store.ts'

export interface ToolCallBlock {
  id: string
  name: string
  arguments: unknown
}

/** 工具结果（来自已提交的 toolResult 条目，或进行中的 progress）。 */
export interface ToolResultView {
  isError: boolean
  /** 结果的文本内容。 */
  text: string
  details: unknown
}

/** 工具调用的审批：请求，以及（已结束时）决定。 */
export interface ToolApproval {
  request: ApprovalRequestPayload
  decision: ApprovalDecisionPayload | null
}

export type ToolItemStatus = 'running' | 'done' | 'error' | 'pending' | 'awaiting'

export type TimelineItem =
  /**
   * seq：用户消息条目（Checkpoint 锚点）；checkpoint：在有效上下文中，可以回退到此处或从这里分叉。
   * command：这条消息由命令展开而来（text 为展开后的全文），invocation 为原始调用 "/name 参数"（回退时放回输入区）。
   * references：随消息附上的 File Reference（<file_reference> 文本块的 path，按出现顺序）；块本身不进入 text。
   */
  | { kind: 'user'; key: string; text: string; seq: number; checkpoint: boolean; command?: CommandPayload; invocation?: string; references?: string[] }
  /** 被回退的区间：折叠保留，可展开查看（ADR 0006）。 */
  | { kind: 'rewound'; key: string; items: TimelineItem[] }
  /** 压缩分隔条：之前的消息仍在时间线中；saved 为约节省的 tokens（没有 tokensAfter 时省略）。 */
  | { kind: 'compaction'; key: string; summary: string; trigger: CompactionPayload['trigger']; saved?: number }
  | { kind: 'text'; key: string; text: string; streaming: boolean }
  | { kind: 'thinking'; key: string; text: string; streaming: boolean }
  | {
      kind: 'tool'
      key: string
      call: ToolCallBlock
      result: ToolResultView | null
      /** awaiting：审批请求尚未回答，调用未执行。 */
      status: ToolItemStatus
      live: LiveTool | null
      /** 没有审批（免审批或旧记录）时省略或为 null。 */
      approval?: ToolApproval | null
    }
  | { kind: 'generating'; key: string; retry?: { attempt: number; maxRetries: number } }
  | { kind: 'stopped'; key: string }
  /** Run 以暂停结束。 */
  | { kind: 'paused'; key: string }
  /** Run 被中断（应用或服务退出，启动恢复补记）。 */
  | { kind: 'interrupted'; key: string }
  /** 已发出、尚未送达的追加指令。 */
  | { kind: 'steering'; key: string; text: string }
  /** retryable：只有最后一个 Run 以模型错误结束、且当前没有 Run 时可重试（重新执行该轮）。 */
  | { kind: 'error'; key: string; message: string; retryable: boolean }
  /** M4 的条目：各自的组件在对应功能交付前不渲染（返回 null）。 */
  | { kind: 'plan'; key: string; plan: PlanPayload }
  | { kind: 'goal'; key: string; goal: GoalPayload }
  /** Run 结束后的用量行：只在该 Run 的 assistant 消息带 usage 时出现；用量由组件按 runId 从条目汇总。 */
  | { kind: 'run-usage'; key: string; runId: string }
  | {
      kind: 'job'
      key: string
      job: { kind: 'start'; payload: JobStartPayload } | { kind: 'end'; payload: JobEndPayload } | { kind: 'notification'; payload: JobNotificationPayload }
    }

interface Block {
  type?: unknown
  text?: unknown
  thinking?: unknown
  id?: unknown
  name?: unknown
  arguments?: unknown
}

const blocksOf = (content: unknown): Block[] => (Array.isArray(content) ? (content.filter((b) => b && typeof b === 'object') as Block[]) : [])

/** 用户与工具结果消息的文本内容。 */
export function contentText(content: unknown): string {
  if (typeof content === 'string') return content
  return blocksOf(content)
    .flatMap((b) => (b.type === 'text' && typeof b.text === 'string' ? [b.text] : []))
    .join('\n')
}

/** 工具结果的文本：AgentToolResult 或 toolResult 条目的 content。 */
export function resultText(result: unknown): string {
  if (result && typeof result === 'object' && 'content' in result) return contentText((result as { content: unknown }).content)
  return typeof result === 'string' ? result : ''
}

const resultDetails = (result: unknown) => (result && typeof result === 'object' && 'details' in result ? (result as { details: unknown }).details : undefined)

/**
 * 由已提交条目与当前 Run 的临时状态派生显示项（纯函数）。工具卡把 assistant 消息中的 toolCall 与对应的
 * toolResult 条目按 toolCallId 配对；尚无结果的工具使用 progress 中的实时状态。
 */
export function buildTimeline(conversation: Conversation): TimelineItem[] {
  const items: TimelineItem[] = []
  const tools = new Map<string, Extract<TimelineItem, { kind: 'tool' }>>()
  const requests = new Map<string, Extract<TimelineItem, { kind: 'tool' }>>()
  let lastRunId: string | null = null
  /** trigger compact 的 Run：其错误不可重试（重试会重新执行上一轮对话），也不显示"生成中"。 */
  const compactRuns = new Set<string>()
  /** assistant 消息带 usage 的 Run：结束后显示用量行。 */
  const usageRuns = new Set<string>()
  // command 条目紧接在其展开后的 user message 之前（同一 Run）；run_start 时丢弃未配对的。
  let pendingCommand: CommandPayload | null = null
  const ranges = rewoundRanges(conversation.entries)

  /**
   * 一层条目：被该层最外层回退区间覆盖的条目收进一个 rewound 项（在其中递归，内层回退照样折叠），其余逐条转换。
   * 工具与审批的配对跨层共享（同一 Run 不会跨越区间边界）。
   */
  const pushLevel = (entries: readonly SessionEntry[], out: TimelineItem[], hidden: boolean) => {
    const seqs = new Set(entries.map((e) => e.seq))
    const outer = ranges.filter((r) => seqs.has(r.to) && !ranges.some((o) => o !== r && seqs.has(o.to) && o.from <= r.from && r.to < o.to))
    let group: { range: { from: number; to: number }; entries: SessionEntry[] } | undefined
    const flush = () => {
      if (!group) return
      const inner: TimelineItem[] = []
      pushLevel(group.entries, inner, true)
      out.push({ kind: 'rewound', key: `rewound:${group.range.to}`, items: inner })
      group = undefined
    }
    for (const entry of entries) {
      const range = outer.find((r) => entry.seq >= r.from && entry.seq < r.to)
      if (range) {
        if (group?.range !== range) {
          flush()
          group = { range, entries: [] }
        }
        group.entries.push(entry)
        continue
      }
      flush()
      if (entry.kind === 'rewind') continue
      pushEntry(entry, out, hidden)
    }
    flush()
  }

  const pushEntry = (entry: SessionEntry, items: TimelineItem[], hidden: boolean) => {
    if (entry.runId) lastRunId = entry.runId
    if (entry.kind === 'run_start') {
      pendingCommand = null
      if (entry.payload.trigger === 'compact' && entry.runId) compactRuns.add(entry.runId)
    }
    if (entry.kind === 'compaction') {
      const { summary, trigger, tokensBefore, tokensAfter } = entry.payload
      items.push({
        kind: 'compaction',
        key: `${entry.seq}`,
        summary,
        trigger,
        ...(tokensAfter === undefined ? {} : { saved: Math.max(0, tokensBefore - tokensAfter) }),
      })
      return
    }
    if (entry.kind === 'command') {
      pendingCommand = entry.payload
      return
    }
    if (entry.kind === 'plan') {
      items.push({ kind: 'plan', key: `${entry.seq}`, plan: entry.payload })
      return
    }
    if (entry.kind === 'goal') {
      items.push({ kind: 'goal', key: `${entry.seq}`, goal: entry.payload })
      return
    }
    if (entry.kind === 'job_start' || entry.kind === 'job_end' || entry.kind === 'job_notification') {
      const job =
        entry.kind === 'job_start'
          ? ({ kind: 'start', payload: entry.payload } as const)
          : entry.kind === 'job_end'
            ? ({ kind: 'end', payload: entry.payload } as const)
            : ({ kind: 'notification', payload: entry.payload } as const)
      items.push({ kind: 'job', key: `${entry.seq}`, job })
      return
    }
    if (entry.kind === 'run_end') {
      const payload = entry.payload
      // 未结束的工具在 Run 结束后不会再有结果。
      for (const tool of tools.values()) if (tool.result === null && (tool.status === 'running' || tool.status === 'awaiting')) tool.status = 'pending'
      if (payload.status === 'aborted') items.push({ kind: 'stopped', key: `${entry.seq}` })
      else if (payload.status === 'paused') items.push({ kind: 'paused', key: `${entry.seq}` })
      else if (payload.status === 'interrupted') items.push({ kind: 'interrupted', key: `${entry.seq}` })
      // 被回退区间内的错误不可重试。
      else if (payload.status === 'error')
        items.push({
          kind: 'error',
          key: `${entry.seq}`,
          message: payload.error?.message ?? '',
          retryable: !hidden && !(entry.runId && compactRuns.has(entry.runId)),
        })
      if (entry.runId && usageRuns.has(entry.runId)) items.push({ kind: 'run-usage', key: `usage:${entry.seq}`, runId: entry.runId })
      return
    }
    if (entry.kind === 'approval_request') {
      const tool = tools.get(entry.payload.toolCallId)
      if (tool) {
        tool.approval = { request: entry.payload, decision: null }
        if (tool.result === null) tool.status = 'awaiting'
        requests.set(entry.payload.requestId, tool)
      }
      return
    }
    if (entry.kind === 'approval_decision') {
      const tool = requests.get(entry.payload.requestId)
      if (tool?.approval) {
        tool.approval = { ...tool.approval, decision: entry.payload }
        if (tool.result === null && tool.status === 'awaiting') tool.status = 'running'
      }
      return
    }
    if (entry.kind !== 'message') return
    const message = entry.payload
    if (message.role === 'user') {
      const command = pendingCommand
      pendingCommand = null
      const references: string[] = []
      const own = blocksOf(message.content).filter((b) => {
        const path = b.type === 'text' && typeof b.text === 'string' ? fileReferencePath(b.text) : undefined
        if (path !== undefined) references.push(path)
        return path === undefined
      })
      items.push({
        kind: 'user',
        key: `${entry.seq}`,
        text: typeof message.content === 'string' ? message.content : contentText(own),
        ...(references.length > 0 ? { references } : {}),
        seq: entry.seq,
        checkpoint: !hidden,
        ...(command ? { command, invocation: command.args === '' ? `/${command.name}` : `/${command.name} ${command.args}` } : {}),
      })
    } else if (message.role === 'assistant') {
      if (entry.runId && 'usage' in message && message.usage) usageRuns.add(entry.runId)
      blocksOf(message.content).forEach((block, index) => {
        const key = `${entry.seq}:${index}`
        if (block.type === 'text' && typeof block.text === 'string' && block.text.trim() !== '')
          items.push({ kind: 'text', key, text: block.text, streaming: false })
        else if (block.type === 'thinking' && typeof block.thinking === 'string' && block.thinking.trim() !== '')
          items.push({ kind: 'thinking', key, text: block.thinking, streaming: false })
        else if (block.type === 'toolCall' && typeof block.id === 'string') {
          const item: Extract<TimelineItem, { kind: 'tool' }> = {
            kind: 'tool',
            key: `tool:${block.id}`,
            call: { id: block.id, name: typeof block.name === 'string' ? block.name : '', arguments: block.arguments },
            result: null,
            status: 'running',
            live: null,
            approval: null,
          }
          tools.set(block.id, item)
          items.push(item)
        }
      })
    } else if (message.role === 'toolResult') {
      const tool = tools.get(message.toolCallId)
      const result: ToolResultView = { isError: message.isError, text: contentText(message.content), details: message.details }
      if (tool) {
        tool.result = result
        tool.status = result.isError ? 'error' : 'done'
      }
    }
  }

  pushLevel(conversation.entries, items, false)

  const live = conversation.live
  if (live) {
    for (const liveTool of Object.values(live.tools)) {
      const tool = tools.get(liveTool.toolCallId)
      if (tool) {
        if (tool.result === null) {
          tool.live = liveTool
          // 等待审批时进度仍报告 running（pi 在审批前发出 tool_start）；以条目中的审批状态为准。
          if (!(tool.status === 'awaiting' && liveTool.status === 'running')) tool.status = liveTool.status
          if (liveTool.status !== 'running')
            tool.result = { isError: liveTool.status === 'error', text: resultText(liveTool.result), details: resultDetails(liveTool.result) }
        }
      } else {
        // 中途订阅时可能先看到工具进度、后补到调用条目。
        items.push({
          kind: 'tool',
          key: `tool:${liveTool.toolCallId}`,
          call: { id: liveTool.toolCallId, name: liveTool.toolName, arguments: liveTool.args },
          result:
            liveTool.status === 'running'
              ? null
              : { isError: liveTool.status === 'error', text: resultText(liveTool.result), details: resultDetails(liveTool.result) },
          status: liveTool.status,
          live: liveTool,
          approval: null,
        })
      }
    }
    let visible = false
    live.blocks.forEach((block, index) => {
      if (!block || block.text === '') return
      visible = true
      items.push({ kind: block.kind, key: `live:${index}`, text: block.text, streaming: true })
    })
    // 以合并后的工具项判断：断线期间错过的 tool_end 由已提交的 toolResult 补上。
    const toolRunning = items.some((i) => i.kind === 'tool' && (i.status === 'running' || i.status === 'awaiting'))
    // 手动压缩的 Run 没有对话输出：状态行在输入区上方。
    const compacting = live.runId !== null && compactRuns.has(live.runId)
    if (!visible && !toolRunning && !compacting) items.push({ kind: 'generating', key: 'generating', ...(live.retry ? { retry: live.retry } : {}) })
  }

  // 待送达的追加指令排在最后（送达后由 user 条目替代）。
  conversation.steering?.forEach((text, index) => items.push({ kind: 'steering', key: `steering:${index}`, text }))

  // run_end 条目没能提交：只由进度得知结束。记录不完整，不提供重试。
  const unrecorded = conversation.unrecordedEnd
  if (unrecorded && !conversation.running) {
    for (const tool of tools.values()) if (tool.result === null && (tool.status === 'running' || tool.status === 'awaiting')) tool.status = 'pending'
    if (unrecorded.status === 'aborted') items.push({ kind: 'stopped', key: `unrecorded:${unrecorded.runId}` })
    else if (unrecorded.status === 'paused') items.push({ kind: 'paused', key: `unrecorded:${unrecorded.runId}` })
    else if (unrecorded.status === 'error')
      items.push({ kind: 'error', key: `unrecorded:${unrecorded.runId}`, message: unrecorded.error?.message ?? '', retryable: false })
  }

  // 只有最后一个 Run 的错误可以重试，且当前没有 Run。
  for (const item of items) {
    if (item.kind !== 'error') continue
    const isLast = item === items.findLast((i) => i.kind === 'error') && lastRunIsError(conversation.entries, lastRunId) && !unrecorded
    if (!isLast || conversation.running) item.retryable = false
  }
  return items
}

function lastRunIsError(entries: SessionEntry[], lastRunId: string | null): boolean {
  const last = entries.at(-1)
  return last?.kind === 'run_end' && last.runId === lastRunId && last.payload.status === 'error'
}
