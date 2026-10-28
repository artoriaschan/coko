import { Button, cn, useAppFrame } from '@coko/ui'
import { PanelLeftCloseIcon, SearchIcon, SquarePenIcon } from 'lucide-react'
import * as React from 'react'
import type { FixtureWorkspace } from '../../app/fixtures.ts'
import { useI18n } from '../../app/i18n.tsx'
import { IconButton } from '../../app/icon-button.tsx'

const GROUP_PAGE = 5

export interface SidebarProps {
  workspaces: FixtureWorkspace[]
  activeSessionId: string | null
  onSelectSession: (id: string) => void
  footer: React.ReactNode
}

const rowClass =
  'flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-ui-body outline-none hover:bg-sidebar-accent/60 aria-[current=page]:bg-sidebar-accent'

export function Sidebar({ workspaces, activeSessionId, onSelectSession, footer }: SidebarProps) {
  const { t } = useI18n()
  const { toggleSidebar, closeSidebarDrawer } = useAppFrame()

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div data-window-drag className="flex h-(--frame-top-clearance) shrink-0 items-center justify-end ps-[max(8px,var(--frame-leading-clearance))] pe-2">
        <IconButton label={t('sidebar.collapse')} onClick={toggleSidebar}>
          <PanelLeftCloseIcon />
        </IconButton>
      </div>

      <div className="flex shrink-0 flex-col gap-0.5 px-2 pb-2">
        <Button variant="ghost" className="justify-start gap-2 px-2 has-[>svg]:px-2">
          <SquarePenIcon />
          {t('sidebar.newSession')}
        </Button>
        <Button variant="ghost" className="justify-start gap-2 px-2 has-[>svg]:px-2">
          <SearchIcon />
          {t('sidebar.search')}
        </Button>
      </div>

      <nav aria-label={t('sidebar.sessions')} className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {workspaces.map((workspace) => (
          <WorkspaceGroup
            key={workspace.id}
            workspace={workspace}
            activeSessionId={activeSessionId}
            onSelect={(id) => {
              onSelectSession(id)
              closeSidebarDrawer()
            }}
          />
        ))}
      </nav>

      <div className="flex shrink-0 items-center gap-1 border-t-hairline border-sidebar-border px-2 py-2">{footer}</div>
    </div>
  )
}

function WorkspaceGroup({
  workspace,
  activeSessionId,
  onSelect,
}: {
  workspace: FixtureWorkspace
  activeSessionId: string | null
  onSelect: (id: string) => void
}) {
  const { t } = useI18n()
  const [limit, setLimit] = React.useState(GROUP_PAGE)
  const visible = workspace.sessions.slice(0, limit)
  const remaining = workspace.sessions.length - visible.length
  const headingId = `workspace-${workspace.id}`

  return (
    <section aria-labelledby={headingId} className="pt-3 first:pt-1">
      <h2 id={headingId} data-user-content className="truncate px-2 pb-1 text-ui-small font-medium text-muted-foreground" title={workspace.name}>
        {workspace.name}
      </h2>
      <ul className="flex flex-col gap-0.5">
        {visible.map((session) => {
          const title = session.title ?? t('sidebar.untitled')
          return (
            <li key={session.id}>
              <button
                type="button"
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
