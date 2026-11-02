import * as React from 'react'
import type { Session } from '@coko/protocol'
import {
  Button,
  DropdownMenuItem,
  FadingTitle,
  type FadingTitleHandle,
  HoverCard,
  HoverCardTrigger,
  RowHoverCardContent,
  InlineRename,
  type RowMenuPoint,
  SidebarListRow,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  toast,
} from '@coko/ui'
import { FolderClosedIcon, MessageCircleIcon, MoreHorizontalIcon, PinIcon, PinOffIcon, Trash2Icon } from 'lucide-react'
import { useChatStoreApi, useLists } from '../../app/chat.tsx'
import { useI18n } from '../../app/i18n.tsx'
import { SessionArchiveMenuItem } from './session-archive-menu-item.tsx'
import { SessionMoveMenu } from './session-move-menu.tsx'
import { SessionDeleteDialog } from './session-delete-dialog.tsx'
import { SessionMenuIcon, SessionMenu, type SessionMenuSlots } from './session-menu.tsx'

export function SessionRow({
  session,
  active,
  onSelect,
  nested = false,
  pinned = false,
  menuSlots,
}: {
  session: Session
  active: string | null
  onSelect: (id: string) => void
  nested?: boolean
  pinned?: boolean
  menuSlots?: SessionMenuSlots
}) {
  const { t } = useI18n()
  const [pending, setPending] = React.useState(false)
  const [details, setDetails] = React.useState(false)
  const [menu, setMenu] = React.useState(false)
  const [menuPoint, setMenuPoint] = React.useState<RowMenuPoint | null>(null)
  const [deleting, setDeleting] = React.useState(false)
  const [renaming, setRenaming] = React.useState(false)
  const card = React.useRef<HTMLDivElement>(null)
  const row = React.useRef<HTMLButtonElement>(null)
  const scrolling = React.useRef<FadingTitleHandle>(null)
  const suppressFocus = React.useRef(false)
  const allowOpen = React.useRef(true)
  const chat = useChatStoreApi()
  const lists = chat.lists
  const title = session.title.trim() || t('sidebar.untitled')
  const pinLabel = t(session.pinnedAt === null ? 'sidebar.pinConversation' : 'sidebar.unpinConversation')
  const Pin = session.pinnedAt === null ? PinIcon : PinOffIcon
  function openMenu(point: RowMenuPoint | null) {
    allowOpen.current = false
    setDetails(false)
    setMenuPoint(point)
    setMenu(true)
  }
  React.useEffect(() => {
    if (!menu) return
    const source = row.current?.getBoundingClientRect()
    const viewport = { width: window.innerWidth, height: window.innerHeight }
    const close = () => setMenu(false)
    const resize = () => {
      // A resize queued before opening may arrive after the menu mounts.
      if (window.innerWidth !== viewport.width || window.innerHeight !== viewport.height) close()
    }
    window.addEventListener('resize', resize)
    // A pointer anchor is fixed in the viewport; close it when its source row moves.
    const scroll = (event: Event) => {
      if (event.target instanceof Element && event.target.closest('[role="menu"]')) return
      const rect = row.current?.getBoundingClientRect()
      if (!source || !rect || source.top !== rect.top || source.left !== rect.left) close()
    }
    window.addEventListener('scroll', scroll, true)
    return () => {
      window.removeEventListener('resize', resize)
      window.removeEventListener('scroll', scroll, true)
    }
  }, [menu])
  async function togglePin() {
    if (pending) return
    allowOpen.current = false
    setDetails(false)
    setPending(true)
    const success = await lists.getState().setPinned(session.id, session.pinnedAt === null)
    if (!success) toast.error(t('sidebar.pinFailed'))
    setPending(false)
  }
  return (
    <HoverCard
      open={details}
      onOpenChange={(open) => {
        if (!open || (allowOpen.current && !menu && !renaming && !deleting)) setDetails(open)
      }}
    >
      <HoverCardTrigger asChild>
        <div
          data-session-row={session.id}
          className="group/session relative"
          onContextMenu={(event) => {
            event.preventDefault()
            event.stopPropagation()
            if (!renaming) openMenu({ x: event.clientX, y: event.clientY })
          }}
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
            if (!event.currentTarget.contains(event.relatedTarget) && !card.current?.contains(event.relatedTarget)) {
              allowOpen.current = false
              setDetails(false)
            }
          }}
        >
          {renaming ? (
            <div className={nested ? 'flex h-8 items-center pl-8 pr-2' : 'flex h-8 items-center px-2'}>
              <InlineRename
                value={session.title}
                label={t('sidebar.conversationTitle')}
                maxLength={200}
                onSave={async (title) => {
                  const success = await lists.getState().renameSession(session.id, title)
                  if (!success) toast.error(t('sidebar.renameFailed'))
                  return success
                }}
                onComplete={() => {
                  allowOpen.current = false
                  setRenaming(false)
                }}
              />
            </div>
          ) : (
            <SidebarListRow
              ref={row}
              data-session-id={session.id}
              aria-label={title}
              aria-current={active === session.id ? 'page' : undefined}
              onKeyDown={(event) => scrolling.current?.handleKeyDown(event)}
              onClick={() => onSelect(session.id)}
            >
              <span className={nested ? 'flex min-w-0 flex-1 items-center gap-2 pl-6 pr-12' : 'flex min-w-0 flex-1 items-center gap-2 pr-12'}>
                {pinned && <MessageCircleIcon aria-hidden className="size-3.5 shrink-0" strokeWidth={1.1} />}
                <FadingTitle ref={scrolling}>{title}</FadingTitle>
              </span>
            </SidebarListRow>
          )}
          {!renaming && (
            <div
              data-session-actions
              className="absolute right-1 top-1 flex h-6 items-center opacity-0 group-hover/session:opacity-100 group-focus-within/session:opacity-100 pointer-coarse:opacity-100"
            >
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="toolbar"
                    size="icon-xs"
                    className="size-6 rounded-sm"
                    disabled={pending}
                    aria-label={pinLabel}
                    onClick={() => void togglePin()}
                  >
                    <Pin aria-hidden className="size-3.5 rotate-45" strokeWidth={1.1} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{pinLabel}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="toolbar"
                    size="icon-xs"
                    className="size-6 rounded-sm"
                    aria-label={t('sidebar.moreConversation')}
                    aria-haspopup="menu"
                    aria-expanded={menu}
                    onClick={() => openMenu(null)}
                  >
                    <MoreHorizontalIcon aria-hidden className="size-3.5" strokeWidth={1.1} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t('sidebar.moreConversation')}</TooltipContent>
              </Tooltip>
            </div>
          )}
          <SessionDeleteDialog
            sessionId={session.id}
            open={deleting}
            onOpenChange={setDeleting}
            onCloseAutoFocus={(event) => {
              event.preventDefault()
              suppressFocus.current = true
              row.current?.focus()
              queueMicrotask(() => {
                suppressFocus.current = false
              })
            }}
          />
          <SessionMenu
            session={session}
            open={menu}
            point={menuPoint}
            pending={pending}
            slots={{
              ...menuSlots,
              archive: menuSlots?.archive ?? (
                <SessionArchiveMenuItem
                  sessionId={session.id}
                  onPendingChange={setPending}
                  onSelect={() => {
                    setDetails(false)
                    setMenu(false)
                  }}
                />
              ),
              moveToProject: menuSlots?.moveToProject ?? <SessionMoveMenu session={session} close={() => setMenu(false)} />,
              delete: menuSlots?.delete ?? (
                <DropdownMenuItem
                  variant="destructive"
                  disabled={pending}
                  onSelect={() => {
                    allowOpen.current = false
                    setDetails(false)
                    setMenu(false)
                    setDeleting(true)
                  }}
                >
                  <SessionMenuIcon>
                    <Trash2Icon aria-hidden className="size-3.5" strokeWidth={1.1} />
                  </SessionMenuIcon>
                  {t('sidebar.deleteConversation')}
                </DropdownMenuItem>
              ),
            }}
            onOpenChange={setMenu}
            onPin={() => void togglePin()}
            onRename={() => {
              allowOpen.current = false
              setDetails(false)
              setMenu(false)
              setRenaming(true)
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault()
              if (!renaming && !deleting) {
                suppressFocus.current = true
                row.current?.focus()
                queueMicrotask(() => {
                  suppressFocus.current = false
                })
              }
            }}
          />
        </div>
      </HoverCardTrigger>
      {details && (
        <RowHoverCardContent
          ref={card}
          role="region"
          tabIndex={0}
          aria-label={t('sidebar.conversationDetails')}
          onFocusCapture={() => setDetails(true)}
          onBlurCapture={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget) && !row.current?.closest('[data-session-row]')?.contains(event.relatedTarget))
              setDetails(false)
          }}
          onPointerDownOutside={(event) => {
            const target = event.detail.originalEvent.target
            if (target instanceof Node && row.current?.parentElement?.contains(target)) {
              event.preventDefault()
              return
            }
            allowOpen.current = false
            setDetails(false)
          }}
          onEscapeKeyDown={() => {
            allowOpen.current = false
            setDetails(false)
            suppressFocus.current = true
            row.current?.focus()
            queueMicrotask(() => {
              suppressFocus.current = false
            })
          }}
        >
          <SessionDetails session={session} title={title} />
        </RowHoverCardContent>
      )}
    </HoverCard>
  )
}

function SessionDetails({ session, title }: { session: Session; title: string }) {
  const { t, locale } = useI18n()
  const project = useLists((state) => state.projects.find((project) => project.id === session.projectId))
  const [now, setNow] = React.useState(Date.now)
  React.useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])
  const minutes = Math.max(0, Math.floor((now - session.updatedAt) / 60_000))
  const time =
    minutes < 1
      ? t('sidebar.justNow')
      : minutes < 60
        ? t('sidebar.minutesAgo', { count: minutes })
        : minutes < 1440
          ? t('sidebar.hoursAgo', { count: Math.floor(minutes / 60) })
          : minutes <= 7 * 1440
            ? t('sidebar.daysAgo', { count: Math.floor(minutes / 1440) })
            : new Intl.DateTimeFormat(locale, { dateStyle: 'short' }).format(session.updatedAt)
  const Ownership = project ? FolderClosedIcon : MessageCircleIcon
  return (
    <>
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1 px-2 py-1">
        <span data-user-content className="min-w-0 flex-1 basis-40 break-words text-ui-title font-medium">
          {title}
        </span>
        <time data-user-content dateTime={new Date(session.updatedAt).toISOString()} className="shrink-0 pt-0.5 text-ui-small text-muted-foreground">
          {time}
        </time>
      </div>
      <div className="flex min-h-8 items-center gap-2 px-2 text-ui-body">
        <Ownership aria-hidden className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.1} />
        <span data-user-content className="min-w-0 break-words">
          {project?.name ?? t('sidebar.conversations')}
        </span>
      </div>
    </>
  )
}
