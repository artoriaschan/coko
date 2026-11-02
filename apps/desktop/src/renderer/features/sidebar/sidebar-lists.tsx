import { SquarePenIcon } from 'lucide-react'
import * as React from 'react'
import { IconButton } from '../../app/icon-button.tsx'
import type { SidebarCategory } from '../../stores/list-store.ts'
import type { Project, Session } from '@coko/protocol'
import {
  Button,
  SidebarListRow,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from '@coko/ui'
import {
  ChevronDownIcon,
  ChevronRightIcon,
  FolderClosedIcon,
  FolderOpenIcon,
  PlusIcon,
  MoreHorizontalIcon,
  GripVerticalIcon,
  ChevronsDownUpIcon,
  ChevronsUpDownIcon,
} from 'lucide-react'
import { useChat, useChatActions, useChatStoreApi, useLists } from '../../app/chat.tsx'
import { useI18n } from '../../app/i18n.tsx'

export interface SidebarListsProps {
  onAddWorkspace: () => void
  search: string | null
  onSelect: (id: string) => void
  onNewSession: (workspaceId?: string) => void
}

export const sortSessions = (sessions: readonly Session[]) => sessions.toSorted((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))

export function SidebarLists({ onAddWorkspace, search, onSelect, onNewSession }: SidebarListsProps) {
  const { t } = useI18n()
  const sessions = useLists((state) => state.sessions)
  const projects = useLists((state) => state.projects)
  const status = useLists((state) => state.listStatus)
  const order = useLists((state) => state.categoryOrder)
  const dragged = React.useRef<SidebarCategory | null>(null)
  const expanded = useLists((state) => state.categoryExpanded)
  const listActions = useChatStoreApi().lists.getState()
  const projectSort = useLists((state) => state.projectSort)
  const expandedProjects = useLists((state) => state.expandedProjects)
  const counts = useLists((state) => state.visibleCounts)
  const active = useChat((state) => state.activeSessionId)
  const { load } = useChatActions()
  const needle = search?.trim().toLocaleLowerCase() ?? ''
  const visible = sortSessions(
    sessions.filter((session) => session.archivedAt === null && session.pinnedAt === null && session.title.toLocaleLowerCase().includes(needle)),
  )
  const standalone = visible.filter((session) => session.projectId === null)
  const lastUsed = new Map(projects.map((project) => [project.id, project.lastUsedAt]))
  for (const session of sessions) {
    if (session.projectId !== null) lastUsed.set(session.projectId, Math.max(lastUsed.get(session.projectId) ?? 0, session.updatedAt))
  }
  const ordered = projects
    .filter((project) => project.pinnedAt === null)
    .toSorted(
      (a, b) =>
        (projectSort === 'created' ? b.createdAt - a.createdAt : (lastUsed.get(b.id) ?? b.createdAt) - (lastUsed.get(a.id) ?? a.createdAt)) ||
        b.createdAt - a.createdAt ||
        a.id.localeCompare(b.id),
    )
  const shownProjects = ordered.filter((project) => !needle || visible.some((session) => session.projectId === project.id))
  const anyExpanded = ordered.some((project) => expandedProjects[project.id] ?? true)
  return (
    <nav aria-label={t('sidebar.sessions')} aria-busy={status === 'loading' || undefined} className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
      {status === 'loading' && (
        <div aria-hidden className="flex flex-col gap-0.5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-8 rounded-sm bg-skeleton" />
          ))}
        </div>
      )}
      {status === 'error' && (
        <div className="px-2 text-ui-body text-muted-foreground">
          <p>{t('sidebar.loadFailed')}</p>
          <Button size="sm" variant="outline" onClick={() => void load()}>
            {t('sidebar.retry')}
          </Button>
        </div>
      )}
      {needle && visible.length === 0 && <p className="px-2 text-ui-body text-muted-foreground">{t('sidebar.noMatches')}</p>}
      {order.map((category) =>
        category === 'conversations' ? (
          <section
            key="conversations"
            data-category="conversations"
            onDragOver={(event) => {
              if (dragged.current && dragged.current !== 'conversations') event.preventDefault()
            }}
            onDrop={(event) => {
              if (!dragged.current || dragged.current === 'conversations') return
              event.preventDefault()
              listActions.reorderCategories(order[0] === dragged.current ? 'conversations' : dragged.current)
              dragged.current = null
            }}
            className="mb-3"
            aria-labelledby="standalone-heading"
          >
            <SidebarCategoryHeader
              id="standalone-heading"
              name={t('sidebar.conversations')}
              expanded={expanded.conversations ?? true}
              onToggle={() => listActions.toggleCategory('conversations')}
              actions={
                <>
                  <CategoryDrag
                    category="conversations"
                    onStart={(category) => {
                      dragged.current = category
                    }}
                    onEnd={() => {
                      dragged.current = null
                    }}
                    onMove={(first) => listActions.reorderCategories(first)}
                  />
                  <IconButton label={t('sidebar.createConversation')} size="icon-sm" onClick={() => onNewSession()}>
                    <SquarePenIcon />
                  </IconButton>
                </>
              }
            />
            {(expanded.conversations ?? true) && (
              <>
                <div className="flex flex-col gap-0.5">
                  {standalone.slice(0, counts.conversations ?? 5).map((session) => (
                    <SessionRow key={session.id} session={session} active={active} onSelect={onSelect} />
                  ))}
                </div>
                <ListPaging listKey="conversations" total={standalone.length} />
              </>
            )}
          </section>
        ) : (
          <section
            key="projects"
            className="mb-3"
            data-category="projects"
            onDragOver={(event) => {
              if (dragged.current && dragged.current !== 'projects') event.preventDefault()
            }}
            onDrop={(event) => {
              if (!dragged.current || dragged.current === 'projects') return
              event.preventDefault()
              listActions.reorderCategories(order[0] === dragged.current ? 'projects' : dragged.current)
              dragged.current = null
            }}
            aria-labelledby="projects-heading"
          >
            <SidebarCategoryHeader
              id="projects-heading"
              name={t('sidebar.projects')}
              expanded={expanded.projects ?? true}
              onToggle={() => listActions.toggleCategory('projects')}
              actions={
                <>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="toolbar"
                        size="icon-xs"
                        className="size-6 rounded-sm [&_svg]:size-3.5"
                        aria-label={t(anyExpanded ? 'sidebar.collapseAllProjects' : 'sidebar.expandAllProjects')}
                        onClick={() =>
                          listActions.expandProjects(
                            ordered.map((project) => project.id),
                            !anyExpanded,
                          )
                        }
                      >
                        {anyExpanded ? (
                          <ChevronsDownUpIcon className="size-3.5" strokeWidth={1.1} />
                        ) : (
                          <ChevronsUpDownIcon className="size-3.5" strokeWidth={1.1} />
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t(anyExpanded ? 'sidebar.collapseAllProjects' : 'sidebar.expandAllProjects')}</TooltipContent>
                  </Tooltip>
                  <CategoryDrag
                    category="projects"
                    onStart={(category) => {
                      dragged.current = category
                    }}
                    onEnd={() => {
                      dragged.current = null
                    }}
                    onMove={(first) => listActions.reorderCategories(first)}
                  />
                  <ProjectSortMenu value={projectSort} onChange={listActions.sortProjects} />
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="toolbar"
                        size="icon-xs"
                        className="size-6 rounded-sm [&_svg]:size-3.5"
                        aria-label={t('sidebar.addProject')}
                        onClick={onAddWorkspace}
                      >
                        <PlusIcon className="size-3.5" strokeWidth={1.1} />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t('sidebar.addProject')}</TooltipContent>
                  </Tooltip>
                </>
              }
            />
            {(expanded.projects ?? true) && (
              <>
                <div className="flex flex-col gap-0.5">
                  {shownProjects.slice(0, counts.projects ?? 5).map((project) => (
                    <ProjectTree
                      key={project.id}
                      project={project}
                      sessions={visible.filter((session) => session.projectId === project.id)}
                      active={active}
                      onSelect={onSelect}
                      onNewSession={onNewSession}
                    />
                  ))}
                </div>
                <ListPaging listKey="projects" total={shownProjects.length} />
              </>
            )}
          </section>
        ),
      )}
    </nav>
  )
}

function SessionRow({
  session,
  active,
  onSelect,
  nested = false,
}: {
  session: Session
  active: string | null
  onSelect: (id: string) => void
  nested?: boolean
}) {
  const { t } = useI18n()
  return (
    <SidebarListRow data-session-id={session.id} aria-current={active === session.id ? 'page' : undefined} onClick={() => onSelect(session.id)}>
      <span className={nested ? 'flex min-w-0 flex-1 items-center gap-2 pl-6' : 'flex min-w-0 flex-1 items-center gap-2'}>
        <span data-user-content className="truncate">
          {session.title.trim() || t('sidebar.untitled')}
        </span>
      </span>
    </SidebarListRow>
  )
}

function ProjectTree({
  project,
  sessions,
  active,
  onSelect,
  onNewSession,
}: {
  project: Project
  sessions: Session[]
  active: string | null
  onSelect: (id: string) => void
  onNewSession: (workspaceId?: string) => void
}) {
  const { t } = useI18n()
  const count = useLists((state) => state.visibleCounts[`project:${project.id}`] ?? 5)
  const expanded = useLists((state) => state.expandedProjects[project.id] ?? true)
  const listActions = useChatStoreApi().lists.getState()
  return (
    <div data-project-id={project.id} className="flex flex-col gap-0.5">
      <div className="group relative">
        <SidebarListRow aria-label={project.name} aria-expanded={expanded} onClick={() => listActions.toggleProject(project.id)}>
          {expanded ? <FolderOpenIcon aria-hidden className="size-4 shrink-0" /> : <FolderClosedIcon aria-hidden className="size-4 shrink-0" />}
          <span data-user-content className="min-w-0 flex-1 truncate">
            {project.name}
          </span>
          {expanded ? <ChevronDownIcon aria-hidden className="mr-5 size-3 shrink-0" /> : <ChevronRightIcon aria-hidden className="mr-5 size-3 shrink-0" />}
        </SidebarListRow>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              className="absolute right-1 top-1.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
              variant="toolbar"
              size="icon-xs"
              aria-label={t('sidebar.newSessionIn', { name: project.name })}
              onClick={() => onNewSession(project.primaryWorkspaceId)}
            >
              <PlusIcon />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('sidebar.newSessionIn', { name: project.name })}</TooltipContent>
        </Tooltip>
      </div>
      {expanded &&
        (sessions.length ? (
          <>
            <div className="flex flex-col gap-0.5">
              {sessions.slice(0, count).map((session) => (
                <SessionRow key={session.id} session={session} active={active} onSelect={onSelect} nested />
              ))}
            </div>
            <ListPaging listKey={`project:${project.id}`} total={sessions.length} nested />
          </>
        ) : (
          <p className="px-2 py-1 pl-8 text-ui-body text-muted-foreground">{t('sidebar.noConversations')}</p>
        ))}
    </div>
  )
}

function ListPaging({ listKey, total, nested = false }: { listKey: string; total: number; nested?: boolean }) {
  const { t } = useI18n()
  const count = useLists((state) => state.visibleCounts[listKey] ?? 5)
  const actions = useChatStoreApi().lists.getState()
  if (total <= 5) return null
  return (
    <div className={`flex h-7 items-center gap-5 text-ui-small text-muted-foreground ${nested ? 'pl-8' : 'px-2'}`}>
      {count < total && (
        <button type="button" className="focus-ring hover:text-foreground" onClick={() => actions.showMore(listKey)}>
          {t('sidebar.expandList')}
        </button>
      )}
      {count > 5 && (
        <button type="button" className="focus-ring hover:text-foreground" onClick={() => actions.showLess(listKey)}>
          {t('sidebar.collapseList')}
        </button>
      )}
    </div>
  )
}

/** 分类标题的固定布局；右端 actions 按分类规则传入，置顶不传操作。 */
export function SidebarCategoryHeader({
  id,
  name,
  expanded,
  onToggle,
  actions,
  muted = false,
}: {
  id: string
  name: string
  expanded: boolean
  onToggle: () => void
  actions?: React.ReactNode
  muted?: boolean
}) {
  const { t } = useI18n()
  const Arrow = expanded ? ChevronDownIcon : ChevronRightIcon
  return (
    <div data-category-header className="group/category flex h-8 items-center px-2">
      <h2 id={id} aria-label={name} className="min-w-0 flex-1 text-ui-body font-normal">
        <button
          type="button"
          aria-label={t(expanded ? 'sidebar.collapseCategory' : 'sidebar.expandCategory', { name })}
          aria-expanded={expanded}
          onClick={onToggle}
          className={`flex max-w-full items-center gap-1 rounded-xs focus-ring ${muted ? 'text-muted-foreground' : ''}`}
        >
          <span data-category-label className="truncate">
            {name}
          </span>
          <Arrow
            aria-hidden
            data-category-arrow
            className={`size-3 shrink-0 ${expanded ? 'opacity-0 group-hover/category:opacity-100 group-focus-within/category:opacity-100' : ''}`}
          />
        </button>
      </h2>
      {actions && (
        <div
          data-category-actions
          className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover/category:opacity-100 group-focus-within/category:opacity-100"
        >
          {actions}
        </div>
      )}
    </div>
  )
}

function ProjectSortMenu({ value, onChange }: { value: 'recent' | 'created'; onChange: (value: 'recent' | 'created') => void }) {
  const { t } = useI18n()
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="toolbar" size="icon-xs" className="size-6 rounded-sm [&_svg]:size-3.5" aria-label={t('sidebar.sortProjects')}>
              <MoreHorizontalIcon className="size-3.5" strokeWidth={1.1} />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{t('sidebar.sortProjects')}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(value) => {
            if (value === 'recent' || value === 'created') onChange(value)
          }}
        >
          <DropdownMenuRadioItem value="created">{t('sidebar.byCreated')}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="recent">{t('sidebar.byRecent')}</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function CategoryDrag({
  category,
  onStart,
  onEnd,
  onMove,
}: {
  category: SidebarCategory
  onStart: (category: SidebarCategory) => void
  onEnd: () => void
  onMove: (first: SidebarCategory) => void
}) {
  const { t } = useI18n()
  const label = t('sidebar.dragCategory', { name: t(category === 'projects' ? 'sidebar.projects' : 'sidebar.conversations') })
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="toolbar"
          size="icon-xs"
          aria-label={label}
          draggable
          className="size-6 cursor-grab rounded-sm active:cursor-grabbing [&_svg]:size-3.5"
          onDragStart={(event) => {
            event.dataTransfer.effectAllowed = 'move'
            event.dataTransfer.setData('text/plain', category)
            onStart(category)
          }}
          onDragEnd={onEnd}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
            event.preventDefault()
            const handle = event.currentTarget
            onMove(event.key === 'ArrowUp' ? category : category === 'projects' ? 'conversations' : 'projects')
            requestAnimationFrame(() => handle.focus())
          }}
        >
          <GripVerticalIcon className="size-3.5" strokeWidth={1.1} />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
