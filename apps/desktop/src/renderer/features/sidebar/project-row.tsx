import * as React from 'react'
import type { Project } from '@coko/protocol'
import {
  Button,
  DropdownMenuItem,
  DropdownMenuSeparator,
  FadingTitle,
  type FadingTitleHandle,
  HoverCard,
  HoverCardTrigger,
  RowHoverCardContent,
  InlineRename,
  RowMenu,
  SidebarListRow,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  toast,
} from '@coko/ui'
import {
  ChevronDownIcon,
  ChevronRightIcon,
  FolderClosedIcon,
  FolderOpenIcon,
  FolderPenIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PinIcon,
  PinOffIcon,
  PlusIcon,
  FolderInputIcon,
  Trash2Icon,
} from 'lucide-react'
import { useChatStoreApi, useLists } from '../../app/chat.tsx'
import { useI18n } from '../../app/i18n.tsx'
import { useEditProject } from '../projects/project-dialogs.tsx'
import { useDeleteProject } from '../projects/project-delete-dialog.tsx'
import { SessionMenuIcon } from './session-menu.tsx'

/** Lifecycle ticket 15 supplies the destructive item after the common commands. */
export interface ProjectMenuSlots {
  delete?: React.ReactNode
}

export function ProjectRow({
  project,
  onNewSession,
  menuSlots = {},
}: {
  project: Project
  onNewSession: (workspaceId?: string) => void
  menuSlots?: ProjectMenuSlots
}) {
  const { t } = useI18n()
  const lists = useChatStoreApi().lists
  const sessionCount = useLists((state) => state.sessions.filter((session) => session.projectId === project.id && session.archivedAt === null).length)
  const expanded = useLists((state) => state.expandedProjects[project.id] ?? true)
  const edit = useEditProject()
  const remove = useDeleteProject()
  const [details, setDetails] = React.useState(false)
  const [menu, setMenu] = React.useState(false)
  const [renaming, setRenaming] = React.useState(false)
  const [pending, setPending] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)
  const more = React.useRef<HTMLButtonElement>(null)
  const row = React.useRef<HTMLButtonElement>(null)
  const card = React.useRef<HTMLDivElement>(null)
  const scrolling = React.useRef<FadingTitleHandle>(null)
  const allowOpen = React.useRef(true)
  const suppressFocus = React.useRef(false)
  const skipMenuFocus = React.useRef(false)
  const Pin = project.pinnedAt === null ? PinIcon : PinOffIcon
  const pinLabel = t(project.pinnedAt === null ? 'sidebar.pinProject' : 'sidebar.unpinProject')
  function closeDetails() {
    allowOpen.current = false
    setDetails(false)
  }
  function focusRow() {
    suppressFocus.current = true
    row.current?.focus()
    queueMicrotask(() => {
      suppressFocus.current = false
    })
  }
  function newChat() {
    closeDetails()
    skipMenuFocus.current = true
    setMenu(false)
    onNewSession(project.primaryWorkspaceId)
  }
  function editProject() {
    skipMenuFocus.current = true
    closeDetails()
    setMenu(false)
    edit?.(project)
  }
  async function togglePin() {
    if (pending) return
    closeDetails()
    setPending(true)
    if (!(await lists.getState().setProjectPinned(project.id, project.pinnedAt === null))) toast.error(t('sidebar.pinFailed'))
    setPending(false)
  }
  React.useEffect(() => {
    if (!menu) return
    const source = row.current?.getBoundingClientRect()
    const viewport = { width: window.innerWidth, height: window.innerHeight }
    const close = () => setMenu(false)
    const resize = () => {
      if (window.innerWidth !== viewport.width || window.innerHeight !== viewport.height) close()
    }
    const scroll = (event: Event) => {
      if (event.target instanceof Element && event.target.closest('[role="menu"]')) return
      const rect = row.current?.getBoundingClientRect()
      if (!source || !rect || source.top !== rect.top || source.left !== rect.left) close()
    }
    window.addEventListener('resize', resize)
    window.addEventListener('scroll', scroll, true)
    return () => {
      window.removeEventListener('resize', resize)
      window.removeEventListener('scroll', scroll, true)
    }
  }, [menu])
  return (
    <HoverCard
      open={details}
      onOpenChange={(open) => {
        if (!open || (allowOpen.current && !menu && !renaming && !deleting)) setDetails(open)
      }}
    >
      <HoverCardTrigger asChild>
        <div
          data-project-row={project.id}
          className="group/project relative rounded-sm hover:bg-sidebar-accent focus-within:bg-sidebar-accent"
          data-menu-open={menu || undefined}
          onPointerOverCapture={(event) => {
            if (event.pointerType !== 'touch') allowOpen.current = true
          }}
          onFocusCapture={() => {
            if (!suppressFocus.current && !menu && !renaming && !deleting) {
              allowOpen.current = true
              setDetails(true)
            }
          }}
          onBlurCapture={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget) && !card.current?.contains(event.relatedTarget)) closeDetails()
          }}
        >
          {renaming ? (
            <div className="flex h-8 items-center px-2">
              <InlineRename
                value={project.name}
                label={t('sidebar.projectName')}
                maxLength={50}
                onSave={async (name) => {
                  const success = await lists.getState().renameProject(project.id, name)
                  if (!success) toast.error(t('sidebar.renameFailed'))
                  return success
                }}
                onComplete={() => {
                  closeDetails()
                  setRenaming(false)
                }}
              />
            </div>
          ) : (
            <>
              <SidebarListRow
                ref={row}
                aria-label={project.name}
                aria-expanded={expanded}
                className={menu ? 'bg-sidebar-accent' : undefined}
                onKeyDown={(event) => scrolling.current?.handleKeyDown(event)}
                onClick={() => lists.getState().toggleProject(project.id)}
              >
                {expanded ? (
                  <FolderOpenIcon aria-hidden className="size-4 shrink-0" strokeWidth={1.1} />
                ) : (
                  <FolderClosedIcon aria-hidden className="size-4 shrink-0" strokeWidth={1.1} />
                )}
                <span className="flex min-w-0 flex-1 items-center gap-2 pr-12">
                  <FadingTitle ref={scrolling}>{project.name}</FadingTitle>
                  {expanded ? <ChevronDownIcon aria-hidden className="size-3 shrink-0" /> : <ChevronRightIcon aria-hidden className="size-3 shrink-0" />}
                </span>
              </SidebarListRow>
              <div
                data-project-actions
                className="absolute right-1 top-1 flex h-6 items-center opacity-0 group-hover/project:opacity-100 group-focus-within/project:opacity-100 pointer-coarse:opacity-100"
              >
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      ref={more}
                      variant="toolbar"
                      size="icon-xs"
                      className="size-6 rounded-sm"
                      aria-label={t('sidebar.moreProject')}
                      aria-haspopup="menu"
                      aria-expanded={menu}
                      onClick={() => {
                        closeDetails()
                        setMenu(true)
                      }}
                    >
                      <MoreHorizontalIcon aria-hidden className="size-3.5" strokeWidth={1.1} />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t('sidebar.moreProject')}</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="toolbar"
                      size="icon-xs"
                      className="size-6 rounded-sm"
                      aria-label={t('sidebar.newSessionIn', { name: project.name })}
                      onClick={newChat}
                    >
                      <PlusIcon aria-hidden className="size-3.5" strokeWidth={1.1} />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t('sidebar.newSessionIn', { name: project.name })}</TooltipContent>
                </Tooltip>
              </div>
            </>
          )}
          <RowMenu
            open={menu}
            onOpenChange={setMenu}
            point={null}
            label={t('sidebar.projectActions')}
            onCloseAutoFocus={(event) => {
              event.preventDefault()
              if (!renaming && !skipMenuFocus.current) focusRow()
              skipMenuFocus.current = false
            }}
          >
            <DropdownMenuItem
              onSelect={() => {
                closeDetails()
                setMenu(false)
                setRenaming(true)
              }}
            >
              <SessionMenuIcon>
                <PencilIcon aria-hidden className="size-3.5" strokeWidth={1.1} />
              </SessionMenuIcon>
              {t('sidebar.rename')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={editProject}>
              <SessionMenuIcon>
                <FolderPenIcon aria-hidden className="size-3.5" strokeWidth={1.1} />
              </SessionMenuIcon>
              {t('sidebar.editProjectMenu')}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={pending} onSelect={() => void togglePin()}>
              <SessionMenuIcon>
                <Pin aria-hidden className="size-3.5 rotate-45" strokeWidth={1.1} />
              </SessionMenuIcon>
              {pinLabel}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={newChat}>
              <SessionMenuIcon>
                <PlusIcon aria-hidden className="size-3.5" strokeWidth={1.1} />
              </SessionMenuIcon>
              {t('sidebar.newSessionIn', { name: project.name })}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                closeDetails()
                void (async () => {
                  try {
                    if (await window.coko?.openDirectory(project.folders.find((folder) => folder.primary)!.path)) return
                  } catch {
                    /* report through the persistent app toaster */
                  }
                  toast.error(t('sidebar.openFinderFailed'))
                })()
              }}
            >
              <SessionMenuIcon>
                <FolderInputIcon aria-hidden className="size-3.5" strokeWidth={1.1} />
              </SessionMenuIcon>
              {t('sidebar.openFinder')}
            </DropdownMenuItem>
            {
              <>
                <DropdownMenuSeparator />
                {menuSlots.delete ?? (
                  <DropdownMenuItem
                    variant="destructive"
                    disabled={!remove}
                    onSelect={() => {
                      closeDetails()
                      skipMenuFocus.current = true
                      setMenu(false)
                      setDeleting(true)
                      remove?.({
                        projectId: project.id,
                        restoreFocus: () => {
                          setDeleting(false)
                          suppressFocus.current = true
                          if (more.current?.isConnected) more.current.focus()
                          else document.querySelector<HTMLButtonElement>('[data-category="conversations"] button')?.focus()
                          queueMicrotask(() => {
                            suppressFocus.current = false
                          })
                        },
                      })
                    }}
                  >
                    <SessionMenuIcon>
                      <Trash2Icon aria-hidden className="size-3.5" strokeWidth={1.1} />
                    </SessionMenuIcon>
                    {t('sidebar.deleteProject')}
                  </DropdownMenuItem>
                )}
              </>
            }
          </RowMenu>
        </div>
      </HoverCardTrigger>
      {details && (
        <RowHoverCardContent
          ref={card}
          role="region"
          tabIndex={0}
          aria-label={t('sidebar.projectDetails')}
          onFocusCapture={() => setDetails(true)}
          onBlurCapture={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget) && !row.current?.parentElement?.contains(event.relatedTarget)) closeDetails()
          }}
          onPointerDownOutside={(event) => {
            if (event.detail.originalEvent.target instanceof Node && row.current?.parentElement?.contains(event.detail.originalEvent.target))
              event.preventDefault()
            else closeDetails()
          }}
          onEscapeKeyDown={() => {
            closeDetails()
            focusRow()
          }}
        >
          <div className="flex items-start gap-2 px-2 py-1">
            <FolderClosedIcon aria-hidden className="mt-1 size-4 shrink-0" strokeWidth={1.1} />
            <span data-user-content className="min-w-0 flex-1 break-words text-ui-title font-medium">
              {project.name}
            </span>
            <Button size="icon-xs" variant="toolbar" className="size-6 rounded-sm" disabled={pending} aria-label={pinLabel} onClick={() => void togglePin()}>
              <Pin aria-hidden className="size-3.5 rotate-45" strokeWidth={1.1} />
            </Button>
          </div>
          <p className="px-2 py-1 text-ui-small text-muted-foreground">{t('sidebar.projectCount', { count: sessionCount })}</p>
          <ul className="max-h-64 overflow-y-auto px-2 py-1 text-ui-body">
            {project.folders.map((folder) => (
              <li key={folder.path} data-user-content className="break-all py-1">
                {folder.path}
                {folder.primary && <span className="ml-2 text-ui-small text-muted-foreground">{t('projectForm.primary')}</span>}
              </li>
            ))}
          </ul>
          <DropdownMenuSeparator />
          <Button variant="ghost" className="w-full justify-start" onClick={editProject}>
            <FolderPenIcon aria-hidden className="size-3.5" strokeWidth={1.1} />
            {t('sidebar.editProject')}
          </Button>
        </RowHoverCardContent>
      )}
    </HoverCard>
  )
}
