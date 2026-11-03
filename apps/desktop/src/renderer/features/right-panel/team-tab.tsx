import type { TeamMember, TeamSnapshot, TeamTaskView } from '@coko/protocol'
import { Button } from '@coko/ui'
import { GitBranchIcon, LoaderCircleIcon, LockIcon, TriangleAlertIcon, XIcon } from 'lucide-react'
import * as React from 'react'
import type { Theme } from '../../app/appearance-store.ts'
import { useChat, useChatActions, useOptionalChatStoreApi } from '../../app/chat.tsx'
import { useI18n } from '../../app/i18n.tsx'
import { IconButton } from '../../app/icon-button.tsx'
import { agentUsageText, useAgents, useAgentsStoreApi } from '../conversation/agents-button.tsx'
import { MemberStatusDot, useSessionTeam, useTeamStoreApi } from '../conversation/team-button.tsx'
import { buildTimeline } from '../conversation/timeline.ts'
import { TimelineView } from '../conversation/timeline-view.tsx'
import type { RightPanelTabProps } from './tabs.ts'

// 右栏 Team tab（docs/subsystems/teams.md#界面）：根会话的名册（状态点、当前活动、用量、worktree）、任务板（按 pending / in_progress /
// completed 分组，owner、可认领与阻塞关系，writeScopes 重叠警告）与选中成员的只读时间线（订阅其子 Session，复用 TimelineView）。
// 用户不能直接给成员发消息（子 Session 的提交为 409 child-session），经 lead 转达。

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

const listFormat = (locale: string, items: readonly string[]) => new Intl.ListFormat(locale, { type: 'conjunction' }).format(items)

function MemberItem({ member, selected, onSelect }: { member: TeamMember; selected: boolean; onSelect: () => void }) {
  const { t, locale } = useI18n()
  // 运行中的活动：agent_update 的最近一次工具调用比快照新（快照只在名册或任务变化时推送）。
  const live = useAgents((s) => s.activity[member.agentId])
  const activity = member.status === 'running' ? (live ?? member.activity) : undefined
  const detail = activity ? t('agents.card.activity', { tool: activity.toolName, summary: activity.summary }) : agentUsageText(t, locale, member.usage)
  const summary = [t(`teams.member.${member.status}`), detail].join(' · ')
  return (
    <li>
      <button
        type="button"
        data-member={member.name}
        data-agent-id={member.agentId}
        data-status={member.status}
        aria-current={selected || undefined}
        aria-label={t('teams.tabView.openMember', { name: member.name })}
        className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-start focus-ring aria-current:bg-accent [@media(hover:hover)]:hover:bg-accent"
        onClick={onSelect}
      >
        <MemberStatusDot status={member.status} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span data-user-content className="truncate text-ui-body font-medium">
            {member.name}
          </span>
          <span data-slot="member-summary" className="truncate text-ui-small text-muted-foreground tabular-nums" title={summary}>
            {summary}
          </span>
          {member.worktree && (
            <span className="flex min-w-0 items-center gap-1 text-ui-small text-muted-foreground">
              <GitBranchIcon aria-hidden className="size-3 shrink-0" />
              <span data-user-content className="truncate font-mono" title={member.worktree.path}>
                {member.worktree.branch}
              </span>
            </span>
          )}
        </span>
      </button>
    </li>
  )
}

const GROUPS = ['pending', 'in_progress', 'completed'] as const

function TaskItem({ task, byId, overlap }: { task: TeamTaskView; byId: Map<string, TeamTaskView>; overlap: boolean }) {
  const { t, locale } = useI18n()
  // 未完成的前置任务（已删除的不再阻塞）。
  const waiting = task.blockedBy.filter((id) => {
    const status = byId.get(id)?.status
    return status !== 'completed' && status !== 'deleted'
  })
  const claimable = task.status === 'pending' && task.ready && task.owner === undefined
  return (
    <li
      data-task-id={task.taskId}
      data-task-status={task.status}
      data-overlap={overlap || undefined}
      className="flex min-w-0 flex-col gap-0.5 rounded-md px-2 py-1.5"
    >
      <span className="flex min-w-0 items-baseline gap-1.5 text-ui-body">
        <span className="shrink-0 font-mono text-ui-small text-muted-foreground">{task.taskId}</span>
        <span data-user-content className="min-w-0 flex-1 truncate" title={task.subject}>
          {task.subject}
        </span>
        {claimable && (
          <span data-slot="task-claimable" className="shrink-0 rounded-xs bg-muted px-1.5 text-ui-small text-success-text">
            {t('teams.board.claimable')}
          </span>
        )}
      </span>
      {(task.owner !== undefined || waiting.length > 0 || overlap) && (
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 text-ui-small text-muted-foreground">
          {task.owner !== undefined && <span data-slot="task-owner">{t('teams.board.owner', { owner: task.owner })}</span>}
          {waiting.length > 0 && <span data-slot="task-blocked">{t('teams.board.blockedBy', { tasks: listFormat(locale, waiting) })}</span>}
          {overlap && (
            <span data-slot="task-overlap" className="flex items-center gap-1 text-warning-text">
              <TriangleAlertIcon aria-hidden className="size-3 shrink-0" />
              {t('teams.board.overlapBadge')}
            </span>
          )}
        </span>
      )}
    </li>
  )
}

function TaskBoard({ team, compact }: { team: TeamSnapshot; compact: boolean }) {
  const { t, locale } = useI18n()
  const byId = React.useMemo(() => new Map(team.tasks.map((task) => [task.taskId, task])), [team.tasks])
  const overlapping = new Set(team.warnings.flatMap((w) => w.taskIds))
  const visible = team.tasks.filter((task) => task.status !== 'deleted')
  return (
    <section
      data-slot="team-board"
      aria-labelledby="team-board-title"
      data-scroll-stable
      className={compact ? 'flex max-h-[35%] shrink-0 flex-col overflow-y-auto px-2 pb-2' : 'flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-2'}
    >
      <h3 id="team-board-title" className="px-2 pt-1 pb-1 text-ui-small text-muted-foreground">
        {t('teams.board.title')}
      </h3>
      {team.warnings.map((warning) => (
        <p
          key={warning.taskIds.join(',')}
          role="status"
          data-slot="team-overlap"
          className="mx-2 mb-1 flex items-start gap-1.5 rounded-md border border-warning px-2 py-1 text-ui-small text-warning-text"
        >
          <TriangleAlertIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          <span>{t('teams.board.overlap', { tasks: listFormat(locale, warning.taskIds) })}</span>
        </p>
      ))}
      {visible.length === 0 ? (
        <p className="px-2 py-1 text-ui-body text-muted-foreground">{t('teams.board.empty')}</p>
      ) : (
        GROUPS.map((status) => {
          const tasks = visible.filter((task) => task.status === status)
          if (tasks.length === 0) return null
          return (
            <div key={status} data-task-group={status} className="flex flex-col">
              <h4 className="flex items-baseline gap-1.5 px-2 pt-1 text-ui-small text-muted-foreground">
                <span>{t(`teams.board.status.${status}`)}</span>
                <span className="tabular-nums">{t('teams.board.count', { count: tasks.length })}</span>
              </h4>
              <ul className="flex flex-col">
                {tasks.map((task) => (
                  <TaskItem key={task.taskId} task={task} byId={byId} overlap={overlapping.has(task.taskId)} />
                ))}
              </ul>
            </div>
          )
        })
      )}
    </section>
  )
}

/** 成员子 Session 的只读时间线：显示时订阅子 Session、卸载时释放；没有输入区与消息动作（子 Session 不能提交）。 */
function MemberTimeline({ member }: { member: TeamMember }) {
  const { t } = useI18n()
  const theme = useDocumentTheme()
  const { subscribeSession } = useChatActions()
  const conversation = useChat((s) => s.conversations[member.agentId])
  React.useEffect(() => subscribeSession(member.agentId), [subscribeSession, member.agentId])
  // 用量行按当前会话的条目汇总（不是子 Session）：成员的用量在名册中，这里不显示。
  const items = React.useMemo(() => (conversation ? buildTimeline(conversation).filter((item) => item.kind !== 'run-usage') : []), [conversation])
  const scroller = React.useRef<HTMLDivElement>(null)
  const pinned = React.useRef(true)
  React.useLayoutEffect(() => {
    const el = scroller.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [items])
  if (!conversation || (conversation.status === 'loading' && conversation.entries.length === 0))
    return (
      <div className="flex flex-1 items-center justify-center" aria-label={t('teams.tabView.loading')}>
        <LoaderCircleIcon aria-hidden className="size-5 animate-spin text-muted-foreground motion-reduce:animate-none" />
      </div>
    )
  return (
    <div
      ref={scroller}
      role="log"
      aria-live="off"
      aria-label={t('teams.tabView.timeline', { name: member.name })}
      data-slot="team-member-timeline"
      data-session-id={member.agentId}
      tabIndex={0}
      data-scroll-stable
      className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto px-3 py-3 focus-ring"
      onScroll={(event) => {
        const el = event.currentTarget
        pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 32
      }}
    >
      {items.length === 0 ? (
        <p className="text-ui-body text-muted-foreground">{t('teams.tabView.timelineEmpty')}</p>
      ) : (
        <TimelineView sessionId={member.agentId} items={items} theme={theme} onRetry={() => {}} actionsDisabled />
      )}
    </div>
  )
}

function MemberDetail({ member, onClose }: { member: TeamMember; onClose: () => void }) {
  const { t } = useI18n()
  return (
    <section
      data-slot="team-member-detail"
      data-agent-id={member.agentId}
      data-status={member.status}
      aria-label={t('teams.tabView.timeline', { name: member.name })}
      className="flex min-h-0 min-w-0 flex-1 flex-col border-t-hairline border-border"
    >
      <div className="flex min-w-0 shrink-0 items-center gap-2 ps-3 pe-2 py-1">
        <MemberStatusDot status={member.status} />
        <span data-user-content className="min-w-0 flex-1 truncate text-ui-body font-medium">
          {member.name}
        </span>
        <span className="shrink-0 text-ui-small text-muted-foreground">{t(`teams.member.${member.status}`)}</span>
        <IconButton label={t('teams.tabView.close')} data-action="close-member" onClick={onClose}>
          <XIcon />
        </IconButton>
      </div>
      <MemberTimeline member={member} />
      <p
        data-slot="team-read-only"
        className="flex shrink-0 items-center gap-1.5 border-t-hairline border-border px-3 py-2 text-ui-small text-muted-foreground"
      >
        <LockIcon aria-hidden className="size-3.5 shrink-0" />
        {t('teams.tabView.readOnly')}
      </p>
    </section>
  )
}

export function TeamTab({ sessionId }: RightPanelTabProps) {
  const { t } = useI18n()
  const session = useSessionTeam(sessionId)
  const store = useTeamStoreApi()
  // 名册中运行中成员的活动来自 agent_update：把 agents store 接到同一 progress（与标题栏的子代理按钮共用订阅）。
  const agents = useAgentsStoreApi()
  const chat = useOptionalChatStoreApi()
  React.useEffect(() => (chat ? agents.getState().attach(chat.getState()) : undefined), [chat, agents])
  // 选中的成员（renderer 内存，随会话切换失效；缺省不选中，任务板占满）。
  const [selection, setSelection] = React.useState<{ sessionId: string; agentId: string } | null>(null)
  const team = session?.team
  const centered = 'flex min-h-0 flex-1 items-center justify-center p-6 text-center text-ui-body text-muted-foreground'
  if (sessionId === null || !team) {
    if (session?.status === 'error')
      return (
        <div className={`${centered} flex-col gap-2`}>
          <p>{t('teams.tabView.loadFailed')}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => sessionId !== null && void store.getState().load(sessionId)}>
            {t('teams.tabView.retry')}
          </Button>
        </div>
      )
    if (session?.status === 'loading')
      return (
        <div className="flex min-h-0 flex-1 items-center justify-center" aria-label={t('teams.tabView.loading')}>
          <LoaderCircleIcon aria-hidden className="size-5 animate-spin text-muted-foreground motion-reduce:animate-none" />
        </div>
      )
    return <div className={centered}>{t('teams.tabView.empty')}</div>
  }
  if (team.members.length === 0 && team.tasks.length === 0) return <div className={centered}>{t('teams.tabView.empty')}</div>
  const selected = selection?.sessionId === sessionId ? team.members.find((m) => m.agentId === selection.agentId) : undefined
  return (
    <div data-slot="team-tab" className="flex min-h-0 min-w-0 flex-1 flex-col">
      {team.members.length > 0 && (
        <ul
          data-slot="team-roster"
          aria-label={t('teams.tabView.roster')}
          data-scroll-stable
          className="flex max-h-[30%] shrink-0 flex-col gap-0.5 overflow-y-auto px-2 pb-2"
        >
          {team.members.map((member) => (
            <MemberItem
              key={member.agentId}
              member={member}
              selected={member === selected}
              onSelect={() => setSelection({ sessionId, agentId: member.agentId })}
            />
          ))}
        </ul>
      )}
      <TaskBoard team={team} compact={selected !== undefined} />
      {selected && <MemberDetail key={selected.agentId} member={selected} onClose={() => setSelection(null)} />}
    </div>
  )
}
