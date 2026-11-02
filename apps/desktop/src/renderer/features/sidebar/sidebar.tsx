import type { Session, Workspace } from '@coko/protocol'
import { Button, cn, Input, SidebarAccount, useAppFrame } from '@coko/ui'
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ClockIcon,
  PanelLeftCloseIcon,
  PlusIcon,
  PuzzleIcon,
  SearchIcon,
  SettingsIcon,
  SquarePenIcon,
  UserRoundIcon,
} from 'lucide-react'
import * as React from 'react'
import { useChat, useChatActions } from '../../app/chat.tsx'
import { useI18n } from '../../app/i18n.tsx'
import { IconButton } from '../../app/icon-button.tsx'
import { useWorkbenchNavigation } from '../../app/workbench.tsx'
import { WorktreeChip } from '../conversation/worktree-chip.tsx'
import { useSettingsPage } from '../../app/settings.tsx'
import { WorkspaceWorktreeMenu } from './worktrees.tsx'

const GROUP_PAGE = 5

export interface SidebarProps {
  onAddWorkspace: () => void
  /** 搜索：null 为关闭；字符串为当前查询词（按会话标题过滤，不区分大小写）。由 App 持有，rail 也能打开。 */
  search: string | null
  onSearchChange: (query: string | null) => void
}

/** 按标题过滤会话；空查询不过滤。没有命中会话的工作区不显示。 */
export function filterGroups(groups: ReturnType<typeof groupSessions>, query: string) {
  const needle = query.trim().toLocaleLowerCase()
  if (needle === '') return groups
  return groups
    .map((group) => ({ ...group, sessions: group.sessions.filter((s) => s.title.toLocaleLowerCase().includes(needle)) }))
    .filter((group) => group.sessions.length > 0)
}

const rowClass =
  'flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-ui-body focus-ring hover:bg-sidebar-accent/60 aria-[current=page]:bg-sidebar-accent'

/** 组内排序的优先级：等待用户处理（审批、结果确认）的会话在组首，其次被中断的，再次运行中的。 */
const rank = (session: Session) =>
  session.activity === 'awaiting-approval' || session.activity === 'awaiting-confirmation'
    ? 3
    : session.activity === 'interrupted'
      ? 2
      : session.running
        ? 1
        : 0

/** 需要用户处理的会话位于组首，被中断的与运行中的其次，其余按最近更新排序。 */
const BADGES = {
  'awaiting-approval': { label: 'sidebar.awaitingApproval', tone: 'bg-warning' },
  'awaiting-confirmation': { label: 'sidebar.awaitingConfirmation', tone: 'bg-warning' },
  interrupted: { label: 'sidebar.interrupted', tone: 'bg-muted-foreground' },
} as const

export function groupSessions(workspaces: readonly Workspace[], sessions: readonly Session[]) {
  return workspaces.map((workspace) => ({
    workspace,
    sessions: sessions
      .filter((s) => s.workspaceId === workspace.id)
      .toSorted((a, b) => rank(b) - rank(a) || b.updatedAt - a.updatedAt || a.id.localeCompare(b.id)),
  }))
}

export function Sidebar({ onAddWorkspace, search, onSearchChange }: SidebarProps) {
  const { t } = useI18n()
  const navigation = useWorkbenchNavigation()
  const { open: openSettings } = useSettingsPage()
  const { toggleSidebar, closeSidebarDrawer } = useAppFrame()
  const workspaces = useChat((s) => s.workspaces)
  const sessions = useChat((s) => s.sessions)
  const activeSessionId = useChat((s) => s.activeSessionId)
  const listStatus = useChat((s) => s.listStatus)
  const { load } = useChatActions()
  const grouped = React.useMemo(() => groupSessions(workspaces, sessions), [workspaces, sessions])
  const groups = React.useMemo(() => (search === null ? grouped : filterGroups(grouped, search)), [grouped, search])
  const filtering = search !== null && search.trim() !== ''

  const newSession = (workspaceId?: string) => {
    if (workspaces.length === 0) onAddWorkspace()
    else navigation.newChat(workspaceId)
    closeSidebarDrawer()
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        data-window-drag
        data-workbench-window-controls
        className="flex h-(--frame-top-clearance) shrink-0 items-start gap-1 ps-[max(8px,calc(var(--frame-leading-clearance)_+_12px))] pt-[7px]"
      >
        <IconButton label={t('sidebar.collapse')} size="icon-sm" onClick={toggleSidebar}>
          <PanelLeftCloseIcon />
        </IconButton>
        <IconButton label={t('sidebar.back')} size="icon-sm" disabled={!navigation.canBack} onClick={navigation.back}>
          <ArrowLeftIcon />
        </IconButton>
        <IconButton label={t('sidebar.forward')} size="icon-sm" disabled={!navigation.canForward} onClick={navigation.forward}>
          <ArrowRightIcon />
        </IconButton>
      </div>

      <nav aria-label={t('sidebar.navigation')} className="flex shrink-0 flex-col gap-0.5 px-2 pt-1 pb-2">
        <div data-workbench-nav className="flex h-8 items-center gap-1 rounded-md hover:bg-accent">
          <Button
            variant="ghost"
            className="h-8 min-w-0 flex-1 justify-start gap-2 px-2 has-[>svg]:px-2"
            aria-current={navigation.location.kind === 'new-chat' ? 'page' : undefined}
            onClick={() => newSession()}
          >
            <SquarePenIcon />
            {t('sidebar.newSession')}
          </Button>
          <IconButton label={t('sidebar.search')} size="icon-sm" onClick={() => onSearchChange(search === null ? '' : null)}>
            <SearchIcon />
          </IconButton>
        </div>
        <Button
          data-workbench-nav
          variant="ghost"
          className="h-8 justify-start gap-2 px-2 has-[>svg]:px-2"
          aria-current={navigation.location.kind === 'plugins' ? 'page' : undefined}
          onClick={() => {
            navigation.visit({ kind: 'plugins' })
            closeSidebarDrawer()
          }}
        >
          <PuzzleIcon />
          {t('settings.nav.plugins')}
        </Button>
        <Button
          data-workbench-nav
          variant="ghost"
          className="h-8 justify-start gap-2 px-2 has-[>svg]:px-2"
          aria-current={navigation.location.kind === 'schedules' ? 'page' : undefined}
          onClick={() => {
            navigation.visit({ kind: 'schedules' })
            closeSidebarDrawer()
          }}
        >
          <ClockIcon />
          {t('schedules.settings')}
        </Button>
      </nav>
      {search !== null && (
        <div className="flex h-9 shrink-0 items-center gap-2 px-4">
          <SearchIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <Input
            type="search"
            autoFocus
            aria-label={t('sidebar.searchSessions')}
            placeholder={t('sidebar.searchPlaceholder')}
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Escape' || event.nativeEvent.isComposing) return
              event.preventDefault()
              event.stopPropagation()
              onSearchChange(null)
            }}
            className="h-7"
          />
        </div>
      )}

      <nav aria-label={t('sidebar.sessions')} aria-busy={listStatus === 'loading' || undefined} className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {listStatus === 'loading' && <SessionSkeleton />}
        {listStatus === 'error' && (
          <div className="flex flex-col items-start gap-1 px-2 pt-1 text-ui-body text-muted-foreground">
            <p>{t('sidebar.loadFailed')}</p>
            <Button variant="outline" size="sm" onClick={() => void load()}>
              {t('sidebar.retry')}
            </Button>
          </div>
        )}
        {filtering && groups.length === 0 && <p className="px-2 pt-2 text-ui-body text-muted-foreground">{t('sidebar.noMatches')}</p>}
        {groups.map(({ workspace, sessions: items }) => (
          <WorkspaceGroup
            key={workspace.id}
            workspace={workspace}
            sessions={items}
            activeSessionId={activeSessionId}
            onNewSession={() => newSession(workspace.id)}
            onOpened={closeSidebarDrawer}
            onSelect={(id) => {
              navigation.openSession(id)
              closeSidebarDrawer()
            }}
          />
        ))}
      </nav>

      <SidebarAccount
        username={t('sidebar.localUser')}
        label={t('sidebar.settings')}
        avatar={<UserRoundIcon aria-hidden className="size-4" />}
        icon={<SettingsIcon aria-hidden className="size-4" />}
        onClick={() => openSettings()}
      />
    </div>
  )
}

function SessionSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-0.5 pt-1">
      <div className="mx-2 mb-1 h-4.5 w-20 rounded-xs bg-skeleton" />
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-8 rounded-md bg-skeleton" />
      ))}
    </div>
  )
}

function WorkspaceGroup({
  workspace,
  sessions,
  activeSessionId,
  onSelect,
  onNewSession,
  onOpened,
}: {
  workspace: Workspace
  sessions: Session[]
  activeSessionId: string | null
  onSelect: (id: string) => void
  onNewSession: () => void
  /** 在新 worktree 中新建的会话已打开。 */
  onOpened: () => void
}) {
  const { t } = useI18n()
  const [limit, setLimit] = React.useState(GROUP_PAGE)
  const visible = sessions.slice(0, limit)
  const remaining = sessions.length - visible.length
  const headingId = `workspace-${workspace.id}`

  return (
    <section aria-labelledby={headingId} className="pt-3 first:pt-1">
      <div className="flex h-6 items-center gap-1 ps-2 pb-1">
        <h2 id={headingId} data-user-content className="min-w-0 flex-1 truncate text-ui-small font-medium text-muted-foreground" title={workspace.path}>
          {workspace.name}
        </h2>
        <Button
          variant="toolbar"
          size="icon-xs"
          aria-label={t('sidebar.newSessionIn', { name: workspace.name })}
          title={t('sidebar.newSessionIn', { name: workspace.name })}
          onClick={onNewSession}
        >
          <PlusIcon />
        </Button>
        <WorkspaceWorktreeMenu workspace={workspace} onOpened={onOpened} />
      </div>
      <ul className="flex flex-col gap-0.5">
        {visible.map((session) => {
          const title = session.title || t('sidebar.untitled')
          return (
            <li key={session.id}>
              <button
                type="button"
                data-session-id={session.id}
                aria-current={session.id === activeSessionId ? 'page' : undefined}
                className={rowClass}
                title={title}
                onClick={() => onSelect(session.id)}
              >
                <span data-user-content={session.title ? '' : undefined} className={cn('min-w-0 flex-1 truncate', !session.title && 'text-muted-foreground')}>
                  {title}
                </span>
                {session.worktree && <WorktreeChip worktree={session.worktree} className="max-w-24" />}
                {session.activity in BADGES ? (
                  <span
                    role="img"
                    data-activity={session.activity}
                    aria-label={t(BADGES[session.activity as keyof typeof BADGES].label)}
                    className={cn('size-2 shrink-0 rounded-round', BADGES[session.activity as keyof typeof BADGES].tone)}
                  />
                ) : (
                  session.running && <span role="img" aria-label={t('sidebar.running')} className="size-2 shrink-0 rounded-round bg-success" />
                )}
              </button>
            </li>
          )
        })}
      </ul>
      {remaining > 0 && (
        <button type="button" className={cn(rowClass, 'text-muted-foreground')} onClick={() => setLimit((n) => n + GROUP_PAGE)}>
          {t('sidebar.showMore', { count: Math.min(GROUP_PAGE, remaining) })}
        </button>
      )}
    </section>
  )
}
