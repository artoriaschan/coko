import type { Session, Workspace } from '@coko/protocol'
import { Button, cn, Input, useAppFrame } from '@coko/ui'
import { FolderPlusIcon, PanelLeftCloseIcon, PlusIcon, SearchIcon, SquarePenIcon } from 'lucide-react'
import * as React from 'react'
import { useChat, useChatActions } from '../../app/chat.tsx'
import { useI18n } from '../../app/i18n.tsx'
import { IconButton } from '../../app/icon-button.tsx'
import { SettingsButton } from '../settings/settings-button.tsx'

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

/** 运行中的会话上浮，其余按最近更新排序。 */
export function groupSessions(workspaces: readonly Workspace[], sessions: readonly Session[]) {
  return workspaces.map((workspace) => ({
    workspace,
    sessions: sessions
      .filter((s) => s.workspaceId === workspace.id)
      .toSorted((a, b) => Number(b.running) - Number(a.running) || b.updatedAt - a.updatedAt || a.id.localeCompare(b.id)),
  }))
}

export function Sidebar({ onAddWorkspace, search, onSearchChange }: SidebarProps) {
  const { t } = useI18n()
  const { toggleSidebar, closeSidebarDrawer } = useAppFrame()
  const workspaces = useChat((s) => s.workspaces)
  const sessions = useChat((s) => s.sessions)
  const activeSessionId = useChat((s) => s.activeSessionId)
  const listStatus = useChat((s) => s.listStatus)
  const { openSession, startDraft, load } = useChatActions()
  const grouped = React.useMemo(() => groupSessions(workspaces, sessions), [workspaces, sessions])
  const groups = React.useMemo(() => (search === null ? grouped : filterGroups(grouped, search)), [grouped, search])
  const filtering = search !== null && search.trim() !== ''

  const newSession = (workspaceId?: string) => {
    if (workspaces.length === 0) onAddWorkspace()
    else startDraft(workspaceId)
    closeSidebarDrawer()
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div data-window-drag className="flex h-(--frame-top-clearance) shrink-0 items-center justify-end ps-[max(8px,var(--frame-leading-clearance))] pe-2">
        <IconButton label={t('sidebar.collapse')} onClick={toggleSidebar}>
          <PanelLeftCloseIcon />
        </IconButton>
      </div>

      <div className="flex shrink-0 flex-col gap-0.5 px-2 pb-2">
        <Button variant="ghost" className="justify-start gap-2 px-2 has-[>svg]:px-2" onClick={() => newSession()}>
          <SquarePenIcon />
          {t('sidebar.newSession')}
        </Button>
        {search === null ? (
          <Button variant="ghost" className="justify-start gap-2 px-2 has-[>svg]:px-2" onClick={() => onSearchChange('')}>
            <SearchIcon />
            {t('sidebar.search')}
          </Button>
        ) : (
          <div className="flex h-9 items-center gap-2 px-2">
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
                // 只关闭搜索：不关闭侧栏抽屉，也不触发全局 Escape（停止 Run）。
                event.preventDefault()
                event.stopPropagation()
                onSearchChange(null)
              }}
              className="h-7"
            />
          </div>
        )}
        <Button variant="ghost" className="justify-start gap-2 px-2 has-[>svg]:px-2" onClick={onAddWorkspace}>
          <FolderPlusIcon />
          {t('sidebar.addWorkspace')}
        </Button>
      </div>

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
            onSelect={(id) => {
              openSession(id)
              closeSidebarDrawer()
            }}
          />
        ))}
      </nav>

      <div className="flex shrink-0 items-center gap-1 border-t-hairline border-sidebar-border px-2 py-2">
        <SettingsButton />
      </div>
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
}: {
  workspace: Workspace
  sessions: Session[]
  activeSessionId: string | null
  onSelect: (id: string) => void
  onNewSession: () => void
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
                {session.running && <span role="img" aria-label={t('sidebar.running')} className="size-2 shrink-0 rounded-round bg-success" />}
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
