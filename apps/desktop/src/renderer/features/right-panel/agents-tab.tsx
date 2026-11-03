import type { AgentSnapshot } from '@coko/protocol'
import { Button, toast } from '@coko/ui'
import { GitBranchIcon, LoaderCircleIcon, LockIcon, SquareIcon } from 'lucide-react'
import * as React from 'react'
import type { Theme } from '../../app/appearance-store.ts'
import { useChat, useChatActions } from '../../app/chat.tsx'
import { useI18n } from '../../app/i18n.tsx'
import { isAgentRunning } from '../../stores/agents-store.ts'
import { agentUsageText, AgentStatusDot, useAgents, useAgentsStoreApi, useSessionAgents } from '../conversation/agents-button.tsx'
import { formatJobDuration, useNow } from '../conversation/jobs-button.tsx'
import { displayRuns } from '../conversation/process-groups.ts'
import { buildTimeline } from '../conversation/timeline.ts'
import { TimelineView } from '../conversation/timeline-view.tsx'
import { useReadingScroll } from '../conversation/use-reading-scroll.ts'
import type { RightPanelTabProps } from './tabs.ts'

// 右栏 Agents tab（docs/subsystems/subagents.md#界面）：父会话的子代理列表（状态点、类型、描述、时长、用量、worktree）与选中项的只读时间线
// （订阅子 Session，复用 TimelineView，没有输入区与消息动作）、停止按钮。

/** 当前主题：App 在根元素上切换 dark 类（右栏 tab 的 props 不带主题），Markdown 的代码高亮据此选择配色。 */
function useDocumentTheme(): Theme {
  return React.useSyncExternalStore(
    (notify) => {
      const observer = new MutationObserver(notify)
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
      return () => observer.disconnect()
    },
    () => (document.documentElement.classList.contains('dark') ? 'dark' : 'light'),
  )
}

const duration = (agent: AgentSnapshot, now: number) => agent.usage?.durationMs ?? (agent.endedAt ?? now) - agent.startedAt

function AgentListItem({ agent, selected, now, onSelect }: { agent: AgentSnapshot; selected: boolean; now: number; onSelect: () => void }) {
  const { t, locale } = useI18n()
  const detail = agent.usage && !isAgentRunning(agent) ? agentUsageText(t, locale, agent.usage) : formatJobDuration(t, duration(agent, now))
  const summary = [t(`agents.status.${agent.status}`), detail, agent.background ? t('agents.card.background') : undefined].filter(Boolean).join(' · ')
  return (
    <li>
      <button
        type="button"
        data-agent-id={agent.agentId}
        data-status={agent.status}
        aria-current={selected || undefined}
        className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-start focus-ring aria-current:bg-accent [@media(hover:hover)]:hover:bg-accent"
        onClick={onSelect}
      >
        <AgentStatusDot status={agent.status} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-baseline gap-1.5 text-ui-body">
            <span className="shrink-0 font-medium">{agent.agentType}</span>
            <span data-user-content className="min-w-0 truncate" title={agent.description}>
              {agent.description}
            </span>
          </span>
          <span className="truncate text-ui-small text-muted-foreground tabular-nums" title={summary}>
            {summary}
          </span>
          {agent.worktree && (
            <span className="flex min-w-0 items-center gap-1 text-ui-small text-muted-foreground">
              <GitBranchIcon aria-hidden className="size-3 shrink-0" />
              <span data-user-content className="truncate font-mono" title={agent.worktree.path}>
                {agent.worktree.branch}
              </span>
            </span>
          )}
        </span>
      </button>
    </li>
  )
}

/** 子 Session 的只读时间线：显示时订阅子 Session、卸载时释放；没有输入区与消息动作（子 Session 不能提交）。 */
function AgentTimeline({ agent }: { agent: AgentSnapshot }) {
  const { t } = useI18n()
  const theme = useDocumentTheme()
  const { subscribeSession } = useChatActions()
  const conversation = useChat((s) => s.conversations[agent.agentId])
  React.useEffect(() => subscribeSession(agent.agentId), [subscribeSession, agent.agentId])
  // 用量行按当前会话的条目汇总（不是子 Session）：子代理的用量在列表中，这里不显示。
  const items = React.useMemo(() => (conversation ? buildTimeline(conversation).filter((item) => item.kind !== 'run-usage') : []), [conversation])
  const reading = useReadingScroll(agent.agentId, items)
  if (!conversation || (conversation.status === 'loading' && conversation.entries.length === 0))
    return (
      <div className="flex flex-1 items-center justify-center" aria-label={t('agents.tabView.loading')}>
        <LoaderCircleIcon aria-hidden className="size-5 animate-spin text-muted-foreground motion-reduce:animate-none" />
      </div>
    )
  return (
    <div
      ref={reading.ref}
      role="log"
      aria-live="off"
      aria-label={t('agents.tabView.timeline', { description: agent.description })}
      data-slot="agent-timeline"
      data-session-id={agent.agentId}
      tabIndex={0}
      data-scroll-stable
      className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto px-3 py-3 focus-ring"
    >
      {items.length === 0 ? (
        <p className="text-ui-body text-muted-foreground">{t('agents.tabView.timelineEmpty')}</p>
      ) : (
        <TimelineView
          sessionId={agent.agentId}
          items={items}
          runs={conversation ? displayRuns(conversation) : undefined}
          theme={theme}
          onRetry={() => {}}
          actionsDisabled
        />
      )}
    </div>
  )
}

function AgentDetail({ sessionId, agent }: { sessionId: string; agent: AgentSnapshot }) {
  const { t } = useI18n()
  const store = useAgentsStoreApi()
  const [stopping, setStopping] = React.useState(false)
  const running = isAgentRunning(agent)
  React.useEffect(() => {
    if (!running) setStopping(false)
  }, [running])
  const stop = async () => {
    setStopping(true)
    try {
      await store.getState().cancel(sessionId, agent.agentId)
    } catch (error) {
      setStopping(false)
      toast.error(t('agents.tabView.stopFailed', { message: error instanceof Error ? error.message : String(error) }))
    }
  }
  return (
    <section
      data-slot="agent-detail"
      data-agent-id={agent.agentId}
      data-status={agent.status}
      aria-label={`${agent.agentType} · ${agent.description}`}
      className="flex min-h-0 min-w-0 flex-1 flex-col border-t-hairline border-border"
    >
      <div className="flex min-w-0 shrink-0 items-center gap-2 px-3 py-2">
        <AgentStatusDot status={agent.status} />
        <span data-user-content className="min-w-0 flex-1 truncate text-ui-body" title={agent.description}>
          {agent.description}
        </span>
        {running ? (
          <Button type="button" variant="outline" size="sm" data-action="stop-agent" disabled={stopping} onClick={() => void stop()}>
            {stopping ? <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" /> : <SquareIcon />}
            {stopping ? t('agents.tabView.stopping') : t('agents.tabView.stop')}
          </Button>
        ) : (
          <span className="shrink-0 text-ui-small text-muted-foreground">{t(`agents.status.${agent.status}`)}</span>
        )}
      </div>
      <AgentTimeline agent={agent} />
      <p
        data-slot="agent-read-only"
        className="flex shrink-0 items-center gap-1.5 border-t-hairline border-border px-3 py-2 text-ui-small text-muted-foreground"
      >
        <LockIcon aria-hidden className="size-3.5 shrink-0" />
        {t('agents.tabView.readOnly')}
      </p>
    </section>
  )
}

/** 选中项缺省：最近派发的运行中子代理，否则最近派发的。 */
const defaultAgent = (agents: AgentSnapshot[]) => agents.findLast(isAgentRunning) ?? agents.at(-1)

export function AgentsTab({ sessionId }: RightPanelTabProps) {
  const { t } = useI18n()
  const session = useSessionAgents(sessionId)
  const store = useAgentsStoreApi()
  const selectedId = useAgents((s) => (sessionId === null ? undefined : s.selected[sessionId]))
  const agents = session?.agents ?? []
  const now = useNow(agents.some(isAgentRunning))
  const fallback = selectedId === undefined || !agents.some((a) => a.agentId === selectedId) ? defaultAgent(agents)?.agentId : undefined
  // 缺省选中项一经显示即固定：它结束后详情不跳到另一个运行中的子代理。
  React.useEffect(() => {
    if (sessionId !== null && fallback !== undefined) store.getState().select(sessionId, fallback)
  }, [store, sessionId, fallback])
  const centered = 'flex min-h-0 flex-1 items-center justify-center p-6 text-center text-ui-body text-muted-foreground'
  if (sessionId === null || !session || (session.status !== 'ready' && agents.length === 0)) {
    if (session?.status === 'error')
      return (
        <div className={`${centered} flex-col gap-2`}>
          <p>{t('agents.tabView.loadFailed')}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => sessionId !== null && void store.getState().load(sessionId)}>
            {t('agents.tabView.retry')}
          </Button>
        </div>
      )
    if (session?.status === 'loading')
      return (
        <div className="flex min-h-0 flex-1 items-center justify-center" aria-label={t('agents.tabView.loading')}>
          <LoaderCircleIcon aria-hidden className="size-5 animate-spin text-muted-foreground motion-reduce:animate-none" />
        </div>
      )
    return <div className={centered}>{t('agents.tabView.empty')}</div>
  }
  if (agents.length === 0) return <div className={centered}>{t('agents.tabView.empty')}</div>
  const current = agents.find((a) => a.agentId === selectedId) ?? defaultAgent(agents)!
  return (
    <div data-slot="agents-tab" className="flex min-h-0 min-w-0 flex-1 flex-col">
      <ul aria-label={t('agents.tabView.list')} data-scroll-stable className="flex max-h-[40%] shrink-0 flex-col gap-0.5 overflow-y-auto px-2 pb-2">
        {agents.map((agent) => (
          <AgentListItem
            key={agent.agentId}
            agent={agent}
            selected={agent === current}
            now={now}
            onSelect={() => store.getState().select(sessionId, agent.agentId)}
          />
        ))}
      </ul>
      <AgentDetail key={current.agentId} sessionId={sessionId} agent={current} />
    </div>
  )
}
