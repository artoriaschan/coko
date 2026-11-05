import { attachmentReferenceFromText, type AttachmentReference } from '@coko/protocol'
import { originalMessageTime } from './fork-history.ts'
import {
  fileReferencePath,
  type AgentNotificationPayload,
  type ApprovalDecisionPayload,
  type ApprovalRequestPayload,
  type CommandPayload,
  type ConfirmationAnswer,
  type CompactionPayload,
  type GoalPayload,
  type HandoffFailedPayload,
  type HandoffOriginPayload,
  type HandoffPayload,
  type HookRunPayload,
  type JobEndPayload,
  type JobNotificationPayload,
  type JobStartPayload,
  type PlanPayload,
  type ScheduleFirePayload,
  type SessionEntry,
  type TeamMessagePayload,
  type TeamTaskPayload,
} from '@coko/protocol'
import {
  AGENT_NOTIFICATION_TAG,
  pairedStateUpdates,
  HOOK_CONTEXT_TAG,
  JOB_NOTIFICATION_TAG,
  rewoundRanges,
  SCHEDULED_TASK_TAG,
  TEAM_MESSAGE_TAG,
} from '@coko/agent/entries'
import type { Conversation, LiveTool } from '../../stores/chat-store.ts'

const unescapeAttribute = (value: string) =>
  value.replace(/&(quot|lt|gt|apos|#39|amp);/g, (_, name: string) => ({ quot: '"', lt: '<', gt: '>', apos: "'", '#39': "'", amp: '&' })[name] ?? '')

/** <scheduled_task> 包装的 title 属性（属性值由宿主转义）；不是包装时 undefined。 */
function scheduledTaskTitle(text: string): string | undefined {
  if (!text.startsWith(SCHEDULED_TASK_TAG)) return undefined
  const head = text.slice(0, text.indexOf('>') + 1)
  const match = / title="([^"]*)"/.exec(head)
  return match ? unescapeAttribute(match[1]!) : ''
}

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
  /** 工具原有结构化输出；展示层不补造缺失字段。 */
  structuredContent?: unknown
  /** 原始结果块属于该调用自身，供图片等非文本消费者读取。 */
  content?: unknown
}

/** 工具调用的审批：请求，以及（已结束时）决定。 */
export interface ToolApproval {
  request: ApprovalRequestPayload
  decision: ApprovalDecisionPayload | null
}

export type ToolItemStatus = 'running' | 'done' | 'error' | 'pending' | 'awaiting'

/** Display-only association across progress and its committed assistant block. */
export interface AssistantBlockSource {
  sessionId: string
  runId: string | null
  contentIndex: number
}

type TimelineContent =
  /**
   * seq：用户消息条目（Checkpoint 锚点）；checkpoint：在有效上下文中，可以回退到此处或从这里分叉。
   * command：这条消息由命令展开而来（text 为展开后的全文），invocation 为原始调用 "/name 参数"（回退时放回输入区）。
   * references：随消息附上的 File Reference（<file_reference> 文本块的 path，按出现顺序）；块本身不进入 text。
   */
  | {
      kind: 'user'
      key: string
      text: string
      seq: number
      checkpoint: boolean
      command?: CommandPayload
      invocation?: string
      references?: string[]
      attachments?: AttachmentReference[]
      images?: { data: string; mimeType: string }[]
    }
  /** 被回退的区间：折叠保留，可展开查看（ADR 0006）。 */
  | { kind: 'rewound'; key: string; items: TimelineItem[] }
  /** 压缩分隔条：之前的消息仍在时间线中；saved 为约节省的 tokens（没有 tokensAfter 时省略）。 */
  | { kind: 'compaction'; key: string; summary: string; trigger: CompactionPayload['trigger']; saved?: number }
  | { kind: 'text'; key: string; text: string; streaming: boolean; source?: AssistantBlockSource; finalResponse?: boolean }
  | { kind: 'thinking'; key: string; text: string; streaming: boolean; source?: AssistantBlockSource }
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
      /** Recovery facts; never inferred from a missing result or from assistant text. */
      confirmation?: { answer: ConfirmationAnswer | null }
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
  /** Persisted Run ending seat, including absent usage; the renderer places its single footer here unless attached to the final reply. */
  | { kind: 'run-usage'; key: string; runId: string }
  | {
      kind: 'job'
      key: string
      job: { kind: 'start'; payload: JobStartPayload } | { kind: 'end'; payload: JobEndPayload } | { kind: 'notification'; payload: JobNotificationPayload }
    }
  /** M5 的条目：各自的组件在对应功能交付前不渲染（返回 null）。agent_start / agent_end / subagent_origin 不单独成行（由工具卡表示）。 */
  | { kind: 'hook'; key: string; hook: HookRunPayload }
  | { kind: 'agent-notification'; key: string; notification: AgentNotificationPayload }
  /** 团队消息（ADR 0018）：送达它的 user message 中的 <team-message> 块不成气泡，由该行显示。 */
  | { kind: 'team-message'; key: string; message: TeamMessagePayload; body?: string }
  /** 任务板的一次变更（根 Session）。 */
  | { kind: 'team-task'; key: string; task: TeamTaskPayload }
  /** title：定时任务 Run 的输入包装中的标题（任务已删除、列表中找不到时的后备）。 */
  | { kind: 'schedule-fire'; key: string; fire: ScheduleFirePayload; title?: string; prompt?: string }
  | {
      kind: 'handoff'
      key: string
      handoff:
        | { kind: 'source'; payload: HandoffPayload }
        | { kind: 'failed'; payload: HandoffFailedPayload }
        | { kind: 'origin'; payload: HandoffOriginPayload }
    }

/** Display provenance comes only from the actual entry or live Run; never from a key or adjacent row. */
export type TimelineItem = TimelineContent & { origin?: { runId: string | null; seq?: number; createdAt?: number } }

interface Block {
  type?: unknown
  data?: unknown
  mimeType?: unknown
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
function resultContent(value: unknown): unknown {
  return typeof value === 'object' && value !== null ? (value as { content?: unknown }).content : undefined
}

export function resultText(result: unknown): string {
  if (result && typeof result === 'object' && 'content' in result) return contentText((result as { content: unknown }).content)
  return typeof result === 'string' ? result : ''
}

const approvalStopped = (approval: ToolApproval | null | undefined) =>
  approval?.decision?.outcome === 'denied' || approval?.decision?.outcome === 'cancelled' || approval?.decision?.outcome === 'expired'

const resultStructured = (result: unknown) => (result && typeof result === 'object' && 'structuredContent' in result ? result.structuredContent : undefined)

const resultDetails = (result: unknown) => (result && typeof result === 'object' && 'details' in result ? (result as { details: unknown }).details : undefined)

/**
 * 由已提交条目与当前 Run 的临时状态派生显示项（纯函数）。工具卡把 assistant 消息中的 toolCall 与对应的
 * toolResult 条目按 toolCallId 配对；尚无结果的工具使用 progress 中的实时状态。
 */
export function buildTimeline(conversation: Conversation): TimelineItem[] {
  const stateUpdates = pairedStateUpdates(conversation.entries)
  const items: TimelineItem[] = []
  const tools = new Map<string, Extract<TimelineItem, { kind: 'tool' }>>()
  const requests = new Map<string, Extract<TimelineItem, { kind: 'tool' }>>()
  let lastRunId: string | null = null
  /** trigger compact 的 Run：其错误不可重试（重试会重新执行上一轮对话），也不显示"生成中"。 */
  const compactRuns = new Set<string>()
  /** assistant 消息带 usage 的 Run：结束后显示用量行。 */
  const lastAssistantSeq = new Map<string, number>()
  // command 条目紧接在其展开后的 user message 之前（同一 Run）；run_start 时丢弃未配对的。
  let pendingCommand: CommandPayload | null = null
  const ranges = rewoundRanges(conversation.entries)
  /** trigger schedule 的 Run 中尚未出现的输入消息（按 runId），及开始它的 schedule_fire 行。 */
  const scheduleInputs = new Set<string>()
  const fireItems = new Map<string, Extract<TimelineItem, { kind: 'schedule-fire' }>>()
  const scheduleOccurrences = new Map<string, Extract<TimelineItem, { kind: 'schedule-fire' }>>()
  /** 紧接在当前条目之前的宿主通知条目（job_notification / agent_notification）的 kind。 */
  let notices = new Set<string>()
  let teamMessages: Extract<TimelineItem, { kind: 'team-message' }>[] = []

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
    const first = items.length
    try {
      const preceding = notices
      const precedingTeams = teamMessages
      notices =
        entry.kind === 'job_notification' || entry.kind === 'agent_notification' || entry.kind === 'team_message'
          ? new Set([...preceding, entry.kind])
          : new Set()
      if (notices.size === 0) teamMessages = []
      if (entry.runId) lastRunId = entry.runId
      if (entry.kind === 'run_start') {
        pendingCommand = null
        if (entry.payload.trigger === 'compact' && entry.runId) compactRuns.add(entry.runId)
        if (entry.payload.trigger === 'schedule' && entry.runId) {
          scheduleInputs.add(entry.runId)
          const schedule = entry.payload.schedule
          if (schedule) {
            const fire = scheduleOccurrences.get(JSON.stringify([schedule.scheduleId, schedule.occurrence]))
            if (fire) fireItems.set(entry.runId, fire)
          }
        }
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
      if (entry.kind === 'hook_run') {
        items.push({ kind: 'hook', key: `${entry.seq}`, hook: entry.payload })
        return
      }
      if (entry.kind === 'team_message') {
        const item: Extract<TimelineItem, { kind: 'team-message' }> = { kind: 'team-message', key: `${entry.seq}`, message: entry.payload }
        items.push(item)
        teamMessages.push(item)
        return
      }
      if (entry.kind === 'team_task') {
        items.push({ kind: 'team-task', key: `${entry.seq}`, task: entry.payload })
        return
      }
      if (entry.kind === 'agent_notification') {
        items.push({ kind: 'agent-notification', key: `${entry.seq}`, notification: entry.payload })
        return
      }
      if (entry.kind === 'schedule_fire') {
        const item: Extract<TimelineItem, { kind: 'schedule-fire' }> = { kind: 'schedule-fire', key: `${entry.seq}`, fire: entry.payload }
        if (entry.payload.runId) fireItems.set(entry.payload.runId, item)
        if (entry.payload.status === 'started') scheduleOccurrences.set(JSON.stringify([entry.payload.scheduleId, entry.payload.occurrence]), item)
        items.push(item)
        return
      }
      if (entry.kind === 'handoff' || entry.kind === 'handoff_failed' || entry.kind === 'handoff_origin') {
        const handoff =
          entry.kind === 'handoff'
            ? ({ kind: 'source', payload: entry.payload } as const)
            : entry.kind === 'handoff_failed'
              ? ({ kind: 'failed', payload: entry.payload } as const)
              : ({ kind: 'origin', payload: entry.payload } as const)
        items.push({ kind: 'handoff', key: `${entry.seq}`, handoff })
        return
      }
      if (entry.kind === 'model_request') return
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
        if (entry.runId) items.push({ kind: 'run-usage', key: `usage:${entry.seq}`, runId: entry.runId })
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
          if (tool.result === null && tool.status === 'awaiting') tool.status = approvalStopped(tool.approval) ? 'pending' : 'running'
        }
        return
      }
      if (entry.kind === 'confirmation_request' || entry.kind === 'confirmation_answer') {
        const tool = tools.get(entry.payload.toolCallId)
        if (tool) tool.confirmation = { answer: entry.kind === 'confirmation_answer' ? entry.payload.answer : null }
        return
      }
      if (entry.kind !== 'message') return
      const message = entry.payload
      if (message.role === 'user') {
        const command = pendingCommand
        pendingCommand = null
        const references: string[] = []
        const attachments: AttachmentReference[] = []
        // 后台任务的完成通知（<job-notification> 文本块）由 job_notification 行显示，不进入用户气泡；只有通知的消息不成气泡。
        // UserPromptSubmit Hook 追加的上下文（<hook-context> 文本块）由 hook_run 行显示，同样不进入气泡（也不随回退放回输入区）。
        // 后台子代理的结束通知（<agent-notification> 文本块，紧接在 agent_notification 条目之后）由该行显示；定时任务 Run 的输入
        // （该 Run 的第一条 user message，<scheduled_task> 包装）由 schedule_fire 行表示。两者都只认宿主条目确定的位置，用户输入的同样文本照常显示。
        const scheduleInput = entry.runId !== null && scheduleInputs.delete(entry.runId)
        const agentNotice = preceding.has('agent_notification')
        // 团队消息（<team-message> 文本块，紧接在 team_message 条目之后）同样只按条目确定的位置去掉。
        const teamNotice = preceding.has('team_message')
        const plain = typeof message.content === 'string' && !scheduleInput && !agentNotice && !teamNotice
        const blocks: Block[] = typeof message.content === 'string' ? (plain ? [] : [{ type: 'text', text: message.content }]) : blocksOf(message.content)
        const stateIndices = new Set(stateUpdates.get(entry.seq)?.map((pair) => pair.blockIndex))
        const inputIndex = blocks.findIndex((_, index) => !stateIndices.has(index))
        const own = blocks.filter((b, index) => {
          if (stateIndices.has(index)) return false
          if (b.type !== 'text' || typeof b.text !== 'string') return true
          if (b.text.startsWith(JOB_NOTIFICATION_TAG) || b.text.startsWith(HOOK_CONTEXT_TAG)) return false
          if (agentNotice && b.text.startsWith(AGENT_NOTIFICATION_TAG)) return false
          if (teamNotice && b.text.startsWith(TEAM_MESSAGE_TAG)) {
            // Association is proven by the preceding host entry, never by a user's text alone.
            const headEnd = b.text.indexOf('>')
            const head = b.text.slice(0, headEnd + 1)
            const messageId = / message-id="([^"]*)"/.exec(head)?.[1]
            const from = / from="([^"]*)"/.exec(head)?.[1]
            const row = precedingTeams.find(
              (item) =>
                messageId !== undefined &&
                from !== undefined &&
                item.message.messageId === unescapeAttribute(messageId) &&
                item.message.from === unescapeAttribute(from),
            )
            if (!row) return true
            const raw = b.text.slice(headEnd + 1)
            const end = raw.lastIndexOf('</team-message>')
            row.body = end < 0 ? b.text : raw.slice(0, end).replace(/^\n/, '').replace(/\n$/, '')
            return false
          }
          if (scheduleInput && index === inputIndex) {
            const title = scheduledTaskTitle(b.text)
            if (title !== undefined) {
              const fire = fireItems.get(entry.runId!)
              if (fire) {
                if (title !== '') fire.title = title
                const end = b.text.lastIndexOf('</scheduled_task>')
                fire.prompt = end < 0 ? b.text : b.text.slice(b.text.indexOf('>') + 1, end)
              }
              return false
            }
          }
          const attachment = attachmentReferenceFromText(b.text)
          if (attachment) {
            attachments.push(attachment)
            return false
          }
          const path = fileReferencePath(b.text)
          if (path !== undefined) references.push(path)
          return path === undefined
        })
        if (!plain && blocks.length > 0 && own.length === 0 && references.length === 0 && attachments.length === 0) return
        items.push({
          kind: 'user',
          key: `${entry.seq}`,
          text: plain ? (message.content as string) : contentText(own),
          images: own
            .filter(
              (block): block is Block & { type: 'image'; data: string; mimeType: string } =>
                block.type === 'image' && typeof block.data === 'string' && typeof block.mimeType === 'string',
            )
            .map(({ data, mimeType }) => ({ data, mimeType })),
          ...(references.length > 0 ? { references } : {}),
          ...(attachments.length > 0 ? { attachments } : {}),
          seq: entry.seq,
          checkpoint: !hidden,
          ...(command ? { command, invocation: command.args === '' ? `/${command.name}` : `/${command.name} ${command.args}` } : {}),
        })
      } else if (message.role === 'assistant') {
        if (entry.runId) lastAssistantSeq.set(entry.runId, entry.seq)
        blocksOf(message.content).forEach((block, index) => {
          const key = `${entry.seq}:${index}`
          const source = { sessionId: entry.sessionId, runId: entry.runId, contentIndex: index }
          if (block.type === 'text' && typeof block.text === 'string' && block.text.trim() !== '')
            items.push({
              kind: 'text',
              key,
              text: block.text,
              streaming: false,
              source,
              finalResponse: message.stopReason === 'stop' || message.stopReason === 'length',
            })
          else if (block.type === 'thinking' && typeof block.thinking === 'string' && block.thinking.trim() !== '')
            items.push({ kind: 'thinking', key, text: block.thinking, streaming: false, source })
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
        const result: ToolResultView = {
          isError: message.isError,
          text: contentText(message.content),
          content: message.content,
          details: message.details,
          structuredContent: resultStructured(message),
        }
        if (tool) {
          tool.result = result
          tool.status = result.isError ? 'error' : 'done'
        }
      }
    } finally {
      for (let index = first; index < items.length; index++)
        items[index]!.origin = { runId: entry.runId, seq: entry.seq, createdAt: originalMessageTime(conversation.entries, entry) }
    }
  }

  pushLevel(conversation.entries, items, false)

  const live = conversation.live
  if (live) {
    for (const liveTool of Object.values(live.tools)) {
      const tool = tools.get(liveTool.toolCallId)
      if (tool) {
        // A matching live result is an actual source when committed output omits structured content.
        if (tool.result !== null && tool.result.structuredContent === undefined) tool.result.structuredContent = resultStructured(liveTool.result)
        if (tool.result === null) {
          tool.live = liveTool
          // 等待审批时进度仍报告 running（pi 在审批前发出 tool_start）；以条目中的审批状态为准。
          if (!(liveTool.status === 'running' && (tool.status === 'awaiting' || approvalStopped(tool.approval)))) tool.status = liveTool.status
          if (liveTool.status !== 'running')
            tool.result = {
              isError: liveTool.status === 'error',
              text: resultText(liveTool.result),
              content: resultContent(liveTool.result),
              details: resultDetails(liveTool.result),
              structuredContent: resultStructured(liveTool.result),
            }
        }
      } else {
        // 中途订阅时可能先看到工具进度、后补到调用条目。
        items.push({
          kind: 'tool',
          key: `tool:${liveTool.toolCallId}`,
          origin: { runId: live.runId },
          call: { id: liveTool.toolCallId, name: liveTool.toolName, arguments: liveTool.args },
          result:
            liveTool.status === 'running'
              ? null
              : {
                  isError: liveTool.status === 'error',
                  text: resultText(liveTool.result),
                  content: resultContent(liveTool.result),
                  details: resultDetails(liveTool.result),
                  structuredContent: resultStructured(liveTool.result),
                },
          status: liveTool.status,
          live: liveTool,
          approval: null,
        })
      }
    }
    let visible = false
    live.blocks.forEach((block, index) => {
      if (!block || block.text.trim() === '') return
      visible = true
      items.push({
        kind: block.kind,
        key: `live:${live.runId}:${lastAssistantSeq.get(live.runId ?? '') ?? 'start'}:${index}`,
        text: block.text,
        streaming: true,
        origin: { runId: live.runId },
        source: { sessionId: conversation.entries[0]?.sessionId ?? '', runId: live.runId, contentIndex: index },
      })
    })
    // 以合并后的工具项判断：断线期间错过的 tool_end 由已提交的 toolResult 补上。
    const toolRunning = items.some((i) => i.kind === 'tool' && (i.status === 'running' || i.status === 'awaiting'))
    // 手动压缩的 Run 没有对话输出：状态行在输入区上方。
    const compacting = live.runId !== null && compactRuns.has(live.runId)
    if (!visible && !toolRunning && !compacting)
      items.push({ kind: 'generating', key: 'generating', origin: { runId: live.runId }, ...(live.retry ? { retry: live.retry } : {}) })
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
    items.push({ kind: 'run-usage', key: `usage:unrecorded:${unrecorded.runId}`, runId: unrecorded.runId, origin: { runId: unrecorded.runId } })
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
