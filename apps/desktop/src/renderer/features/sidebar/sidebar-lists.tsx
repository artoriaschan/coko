import * as React from 'react'
import type { Project, Session } from '@coko/protocol'
import { Button, SidebarListRow, Tooltip, TooltipContent, TooltipTrigger } from '@coko/ui'
import { ChevronDownIcon, ChevronRightIcon, FolderClosedIcon, FolderOpenIcon, PlusIcon } from 'lucide-react'
import { useChat, useChatActions, useLists } from '../../app/chat.tsx'
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
  const active = useChat((state) => state.activeSessionId)
  const { load } = useChatActions()
  const needle = search?.trim().toLocaleLowerCase() ?? ''
  const visible = sortSessions(
    sessions.filter((session) => session.archivedAt === null && session.pinnedAt === null && session.title.toLocaleLowerCase().includes(needle)),
  )
  const standalone = visible.filter((session) => session.projectId === null)
  const ordered = projects.toSorted((a, b) => b.lastUsedAt - a.lastUsedAt || b.createdAt - a.createdAt || a.id.localeCompare(b.id))
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
      <section className="mb-3" aria-labelledby="standalone-heading">
        <h2 id="standalone-heading" className="flex h-8 items-center px-2 text-ui-body font-normal">
          {t('sidebar.conversations')}
        </h2>
        <div className="flex flex-col gap-0.5">
          {standalone.map((session) => (
            <SessionRow key={session.id} session={session} active={active} onSelect={onSelect} />
          ))}
        </div>
      </section>
      <section aria-labelledby="projects-heading">
        <div className="flex h-8 items-center px-2">
          <h2 id="projects-heading" className="flex-1 text-ui-body font-normal">
            {t('sidebar.projects')}
          </h2>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="toolbar" size="icon-xs" aria-label={t('sidebar.addProject')} onClick={onAddWorkspace}>
                <PlusIcon />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('sidebar.addProject')}</TooltipContent>
          </Tooltip>
        </div>
        <div className="flex flex-col gap-0.5">
          {ordered
            .filter((project) => !needle || visible.some((session) => session.projectId === project.id))
            .map((project) => (
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
      </section>
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
  const [expanded, setExpanded] = React.useState(true)
  return (
    <div data-project-id={project.id} className="flex flex-col gap-0.5">
      <div className="group relative">
        <SidebarListRow aria-label={project.name} aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
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
          sessions.map((session) => <SessionRow key={session.id} session={session} active={active} onSelect={onSelect} nested />)
        ) : (
          <p className="px-2 py-1 pl-8 text-ui-body text-muted-foreground">{t('sidebar.noConversations')}</p>
        ))}
    </div>
  )
}
