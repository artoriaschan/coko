import type { Translator } from '@coko/i18n'
import type { AgentEndPayload, AgentStartPayload, AgentStatus, AgentUsage, SessionEntry } from '@coko/protocol'
import { cn } from '@coko/ui'
import { BotIcon } from 'lucide-react'
import * as React from 'react'
import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'
import { useOptionalChatStoreApi } from '../../app/chat.tsx'
import { useI18n } from '../../app/i18n.tsx'
import { IconButton } from '../../app/icon-button.tsx'
import type { ChatState } from '../../stores/chat-store.ts'
import { agentsStore, isAgentRunning, type AgentsActions, type AgentsState, type AgentsStore, type SessionAgents } from '../../stores/agents-store.ts'
import type { HeaderActionProps } from './header-actions.ts'
import { formatJobDuration } from './jobs-button.tsx'
import { formatCount } from './session-cost.tsx'
import { useReloadOnEntryCount } from './use-reload-on-entry-count.ts'

// 子代理视图共用的接线（docs/subsystems/subagents.md#界面）：agents store 的 context（测试可换成自己的 store）、按父会话读取与订阅、
// 工具调用与子代理的对应（agent_start / agent_end 条目）、状态点与用量文案，以及会话标题栏的"子代理"按钮。

const AgentsStoreContext = React.createContext<AgentsStore>(agentsStore)

export function AgentsStoreProvider({ store, children }: { store: AgentsStore; children: React.ReactNode }) {
  return <AgentsStoreContext.Provider value={store}>{children}</AgentsStoreContext.Provider>
}

export const useAgentsStoreApi = (): AgentsStore => React.useContext(AgentsStoreContext)

export function useAgents<T>(selector: (state: AgentsState & AgentsActions) => T): T {
  return useStore(useAgentsStoreApi(), selector)
}

const EMPTY_ENTRIES: SessionEntry[] = []
/** 不在对话 store 之内（组件测试）时使用的空 store。 */
const noChat = createStore<Pick<ChatState, 'activeSessionId' | 'conversations'>>()(() => ({ activeSessionId: null, conversations: {} }))

/** 当前会话与其条目（时间线中的工具卡与通知行属于当前会话；子时间线中没有 agent 调用）。 */
export function useActiveEntries(): { sessionId: string | null; entries: readonly SessionEntry[] } {
  const chat = useOptionalChatStoreApi() ?? noChat
  const sessionId = useStore(chat, (s) => s.activeSessionId)
  const entries = useStore(chat, (s) => (s.activeSessionId === null ? EMPTY_ENTRIES : (s.conversations[s.activeSessionId]?.entries ?? EMPTY_ENTRIES)))
  return { sessionId, entries }
}

/** 会话中的子代理记录：agent_start 与（结束后）agent_end，按派发顺序；同一条目数组只计算一次。 */
export interface AgentRecord {
  start: AgentStartPayload
  end?: AgentEndPayload
}
const records = new WeakMap<readonly SessionEntry[], AgentRecord[]>()
export function agentRecords(entries: readonly SessionEntry[]): AgentRecord[] {
  let list = records.get(entries)
  if (list === undefined) {
    const byId = new Map<string, AgentRecord>()
    for (const entry of entries) {
      if (entry.kind === 'agent_start') byId.set(entry.payload.agentId, { start: entry.payload })
      else if (entry.kind === 'agent_end') {
        const record = byId.get(entry.payload.agentId)
        if (record) record.end = entry.payload
      }
    }
    list = [...byId.values()]
    records.set(entries, list)
  }
  return list
}

/** 这些条目的数量变化时（包括重连后补发）重新读取列表。 */
const AGENT_ENTRY_KINDS = ['agent_start', 'agent_end'] as const

/**
 * 父会话的子代理列表：把 agents store 接到对话 store 的 progress（agent_update），打开会话与子代理条目数变化时重新读取。
 */
export function useSessionAgents(sessionId: string | null): SessionAgents | undefined {
  const store = useAgentsStoreApi()
  const chat = useOptionalChatStoreApi()
  React.useEffect(() => (chat ? store.getState().attach(chat.getState()) : undefined), [chat, store])
  useReloadOnEntryCount(sessionId, AGENT_ENTRY_KINDS, store.getState().load)
  return useStore(store, (s) => (sessionId === null ? undefined : s.sessions[sessionId]))
}

/** 显示用的状态：agent_end 为准，其次是列表快照（agent_update 合并），有 agent_start 时为运行中。 */
export function useAgentStatus(record: AgentRecord | undefined, sessionId: string | null): AgentStatus | undefined {
  const live = useAgents((s) =>
    record === undefined || sessionId === null ? undefined : s.sessions[sessionId]?.agents.find((a) => a.agentId === record.start.agentId)?.status,
  )
  if (!record) return undefined
  return record.end?.status ?? live ?? 'running'
}

const DOT: Record<AgentStatus, string> = {
  running: 'bg-success',
  completed: 'bg-muted-foreground',
  failed: 'bg-destructive',
  cancelled: 'bg-warning',
  'max-turns': 'bg-warning',
  interrupted: 'bg-warning',
  dismissed: 'bg-muted-foreground',
}

/** 状态点：颜色之外另有无障碍名称（状态名）。 */
export function AgentStatusDot({ status, className }: { status: AgentStatus; className?: string }) {
  const { t } = useI18n()
  return (
    <span
      role="img"
      aria-label={t(`agents.status.${status}`)}
      data-agent-status={status}
      className={cn('size-2 shrink-0 rounded-round', DOT[status], className)}
    />
  )
}

/** 结束后的用量：轮次、工具调用、Token 与时长。 */
export function agentUsageText(t: Translator, locale: string, usage: AgentUsage): string {
  return t('agents.card.usage', {
    turns: usage.turns,
    toolCalls: usage.toolCalls,
    tokens: t('usage.tokens', { count: formatCount(locale, usage.tokens) }),
    duration: formatJobDuration(t, usage.durationMs),
  })
}

/**
 * 会话标题栏的"子代理"按钮：会话有子代理时显示（与后台任务按钮一致），徽标为 running 的数量（没有时不显示徽标）；点击打开右栏的
 * Agents tab。工具卡与通知行的打开请求（agents store 的 openRequests）也经这里打开右栏。只显示状态并打开 tab，窄主区中留在标题栏。
 */
export function AgentsButton({ sessionId, openTab }: HeaderActionProps) {
  const { t } = useI18n()
  const session = useSessionAgents(sessionId)
  const running = session?.agents.filter(isAgentRunning).length ?? 0
  const request = useAgents((s) => s.openRequests[sessionId] ?? 0)
  const seen = React.useRef(request)
  React.useEffect(() => {
    if (request === seen.current) return
    seen.current = request
    openTab('agents')
  }, [request, openTab])
  if (!session || session.agents.length === 0) return null
  const label = running > 0 ? t('agents.headerActionRunning', { count: running }) : t('agents.headerAction')
  return (
    <IconButton label={label} data-action="open-agents" data-running={running} className="relative" onClick={() => openTab('agents')}>
      <BotIcon />
      {running > 0 && (
        <span
          aria-hidden
          data-slot="agents-badge"
          className="absolute -end-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-round bg-primary px-1 text-ui-caption font-medium text-primary-foreground"
        >
          {running}
        </span>
      )}
    </IconButton>
  )
}
