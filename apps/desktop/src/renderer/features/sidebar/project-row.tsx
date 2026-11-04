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
  type RowMenuPoint,
  SidebarListRow,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  toast,
} from '@coko/ui'
import {
  FolderClosedIcon,
  FolderOpenIcon,
  FolderPenIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PinIcon,
  PinOffIcon,
  SquarePenIcon,
  FolderInputIcon,
  Trash2Icon,
} from 'lucide-react'
import { useChatStoreApi, useLists } from '../../app/chat.tsx'
import { useI18n } from '../../app/i18n.tsx'
import { useEditProject } from '../projects/project-dialogs.tsx'
import { useDeleteProject } from '../projects/project-delete-dialog.tsx'
import { SidebarActivity, sessionExecuting } from './sidebar-activity.tsx'
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
  const executing = useLists((state) =>
    state.sessions.some((session) => session.projectId === project.id && session.archivedAt === null && session.pinnedAt === null && sessionExecuting(session)),
  )
  const expanded = useLists((state) => state.expandedProjects[project.id] ?? true)
  const edit = useEditProject()
  const remove = useDeleteProject()
  const [details, setDetails] = React.useState(false)
  const [menu, setMenu] = React.useState(false)
  const [menuPoint, setMenuPoint] = React.useState<RowMenuPoint | null>(null)
  const [renaming, setRenaming] = React.useState(false)
  const [pending, setPending] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)
  const more = React.useRef<HTMLButtonElement>(null)
  const row = React.useRef<HTMLButtonElement>(null)
  const card = React.useRef<HTMLDivElement>(null)
  const scrolling = React.useRef<FadingTitleHandle>(null)
  const allowOpen = React.useRef(true)
  /** 本次悬停是否已经展示过详情：离开行与卡片之前不再重复弹出。 */
  const hoverShown = React.useRef(false)
  /** 行悬停时长标题自动横向滚动。 */
  const [hovered, setHovered] = React.useState(false)
  const suppressFocus = React.useRef(false)
  const skipMenuFocus = React.useRef(false)
  /** 按下时菜单是否已打开：外部关闭可能先于 click 发生，点击仍应关闭而不是重新打开。 */
  const menuWasOpen = React.useRef(false)
  const Pin = project.pinnedAt === null ? PinIcon : PinOffIcon
  const pinLabel = t(project.pinnedAt === null ? 'sidebar.pinProject' : 'sidebar.unpinProject')
  function closeDetails() {
    allowOpen.current = false
    setDetails(false)
  }
  function openMenu(point: RowMenuPoint | null) {
    closeDetails()
    setMenuPoint(point)
    setMenu(true)
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
        if (!open) {
          setDetails(false)
          return
        }
        if (!allowOpen.current || menu || renaming || deleting || hoverShown.current) return
        hoverShown.current = true
        setDetails(true)
      }}
    >
      <HoverCardTrigger asChild>
        <div
          data-project-row={project.id}
          data-sidebar-activity-row
          data-executing={(!expanded && executing) || undefined}
          className="group/project relative rounded-sm hover:bg-accent focus-within:bg-accent"
          data-menu-open={menu || undefined}
          onPointerOverCapture={(event) => {
            if (event.pointerType !== 'touch') allowOpen.current = true
          }}
          onPointerEnter={(event) => {
            if (event.pointerType !== 'touch') setHovered(true)
          }}
          onFocusCapture={() => {
            // 详情只由悬停触发：焦点来自点击或键盘时不打开（Radix 默认会用焦点打开 HoverCard）。
            allowOpen.current = false
          }}
          onPointerLeave={(event) => {
            setHovered(false)
            // 指针移入详情卡片时保持"已展示"，回到行内也不重新计时。
            const next = event.relatedTarget instanceof Node ? event.relatedTarget : null
            if (card.current?.contains(next)) return
            hoverShown.current = false
          }}
          onBlurCapture={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget) && !card.current?.contains(event.relatedTarget)) {
              hoverShown.current = false
              closeDetails()
            }
          }}
          onContextMenu={(event) => {
            event.preventDefault()
            event.stopPropagation()
            if (!renaming) openMenu({ x: event.clientX, y: event.clientY })
          }}
        >
          {renaming ? (
            <div className="flex h-8 items-center ps-8 pe-2">
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
                className={menu ? 'bg-accent' : undefined}
                onKeyDown={(event) => scrolling.current?.handleKeyDown(event)}
                onClick={() => lists.getState().toggleProject(project.id)}
              >
                <span aria-hidden className="flex size-4 shrink-0 items-center justify-center">
                  {expanded ? <FolderOpenIcon className="size-3" strokeWidth={1.1} /> : <FolderClosedIcon className="size-3" strokeWidth={1.1} />}
                </span>
                <span data-sidebar-row-content className="flex min-w-0 flex-1 items-center gap-2">
                  <FadingTitle ref={scrolling} autoScroll={hovered}>
                    {project.name}
                  </FadingTitle>
                </span>
              </SidebarListRow>
              {!expanded && executing && <SidebarActivity />}
              <div data-project-actions className="absolute right-2 top-1 flex h-6 items-center transition-opacity duration-150 motion-reduce:transition-none">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      ref={more}
                      data-project-more
                      data-menu-toggle
                      variant="toolbar"
                      size="icon-xs"
                      className="size-6 rounded-sm"
                      aria-label={t('sidebar.moreProject')}
                      aria-haspopup="menu"
                      aria-expanded={menu}
                      onPointerDownCapture={() => {
                        menuWasOpen.current = menu
                      }}
                      onClick={() => {
                        if (menuWasOpen.current) {
                          menuWasOpen.current = false
                          setMenu(false)
                          return
                        }
                        openMenu(null)
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
                      <SquarePenIcon aria-hidden className="size-3.5" strokeWidth={1.1} />
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
            point={menuPoint}
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
                <SquarePenIcon aria-hidden className="size-3.5" strokeWidth={1.1} />
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
                          const trigger = more.current?.isConnected
                            ? more.current
                            : document.querySelector<HTMLButtonElement>(`[data-project-row="${CSS.escape(project.id)}"] [data-project-more]`)
                          if (trigger) trigger.focus()
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
          className="w-80"
          role="region"
          tabIndex={0}
          aria-label={t('sidebar.projectDetails')}
          onFocusCapture={() => setDetails(true)}
          onPointerLeave={(event) => {
            const next = event.relatedTarget instanceof Node ? event.relatedTarget : null
            if (row.current?.closest('[data-project-row]')?.contains(next)) return
            hoverShown.current = false
          }}
          onBlurCapture={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget) && !row.current?.parentElement?.contains(event.relatedTarget)) closeDetails()
          }}
          onPointerDownOutside={(event) => {
            if (event.detail.originalEvent.target instanceof Node && row.current?.parentElement?.contains(event.detail.originalEvent.target))
              event.preventDefault()
            else closeDetails()
          }}
          onEscapeKeyDown={(event) => {
            // 由行接管关闭与焦点返回，避免与 Radix 的默认关闭竞争。
            event.preventDefault()
            // 主动关闭后允许再次悬停展示；指针在卡片与行之间往返仍只算一次。
            closeDetails()
            allowOpen.current = true
            hoverShown.current = false
            focusRow()
          }}
        >
          <div className="flex items-center gap-2 px-2 py-1">
            <FolderClosedIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.1} />
            <span data-user-content className="min-w-0 flex-1 break-words text-ui-body font-medium">
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
