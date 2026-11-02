import * as React from 'react'
import { createPortal } from 'react-dom'
import type { Session } from '@coko/protocol'
import { Dialog, DialogContent, DialogTitle, DropdownMenuItem, InlineRename, Input, SidebarListRow, toast, type RowMenuPoint } from '@coko/ui'
import { MessageCircleIcon, SearchIcon, Trash2Icon } from 'lucide-react'
import { useChatStoreApi, useLists } from '../../app/chat.tsx'
import { useI18n } from '../../app/i18n.tsx'
import { useWorkbenchNavigation } from '../../app/workbench.tsx'
import { SessionMenu, SessionMenuIcon } from './session-menu.tsx'
import { SessionDeleteDialog } from './session-delete-dialog.tsx'
import { SessionArchiveMenuItem } from './session-archive-menu-item.tsx'
import { SessionMoveMenu } from './session-move-menu.tsx'
import { sessionTime } from './session-time.ts'
import { sortSessions } from './sidebar-lists.tsx'

/** Search owns presentation only; the list store and workbench keep Session identity. */
export function ConversationSearch({ open, onOpenChange }: { open: boolean; onOpenChange(open: boolean): void }) {
  const { t, locale } = useI18n()
  const sessions = useLists((state) => state.sessions)
  const projects = useLists((state) => state.projects)
  const lists = useChatStoreApi().lists
  const navigation = useWorkbenchNavigation()
  const [query, setQuery] = React.useState('')
  const [committed, setCommitted] = React.useState('')
  const composing = React.useRef(false)
  const [current, setCurrent] = React.useState(0)
  const input = React.useRef<HTMLInputElement>(null)
  const returnFocus = React.useRef<HTMLElement | null>(null)
  const [menu, setMenu] = React.useState<{ session: Session; point: RowMenuPoint } | null>(null)
  const [deleting, setDeleting] = React.useState<Session | null>(null)
  const [renaming, setRenaming] = React.useState<string | null>(null)
  const menuAction = React.useRef(false)
  const [pending, setPending] = React.useState(false)
  const [now, setNow] = React.useState(Date.now)
  const listId = React.useId()
  const needle = committed.trim().toLowerCase()
  const unique = [...new Map(sessions.filter((session) => session.archivedAt === null).map((session) => [session.id, session])).values()]
  const matches = sortSessions(unique).filter((session) => session.title.toLowerCase().includes(needle))
  const results = needle ? matches : matches.slice(0, 10)
  const selected = results[Math.min(current, results.length - 1)]
  React.useEffect(() => {
    if (!open) return
    setQuery('')
    setCommitted('')
    setCurrent(0)
    composing.current = false
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [open])
  React.useEffect(() => {
    if (open && selected) document.getElementById(`${listId}-${selected.id}`)?.scrollIntoView({ block: 'nearest' })
  }, [open, selected?.id, listId])
  function choose(session: Session) {
    onOpenChange(false)
    navigation.openSession(session.id)
  }
  function update(value: string) {
    setQuery(value)
    if (!composing.current) {
      setCommitted(value)
      setCurrent(0)
    }
  }
  const target = menu ? (sessions.find((session) => session.id === menu.session.id) ?? menu.session) : null
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!deleting && !menu) onOpenChange(value)
      }}
    >
      <DialogContent
        aria-describedby={undefined}
        data-conversation-search
        className="h-[432px] w-[640px] max-w-[calc(100vw-32px)] gap-2 p-3"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
          input.current?.focus()
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          returnFocus.current?.focus()
        }}
        onEscapeKeyDown={(event) => {
          if (composing.current || event.isComposing || event.keyCode === 229 || deleting || menu) event.preventDefault()
        }}
      >
        <DialogTitle className="sr-only">{t('sidebar.searchConversations')}</DialogTitle>
        <div className="relative h-10 shrink-0">
          <SearchIcon aria-hidden className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" strokeWidth={1.1} />
          <Input
            ref={input}
            role="combobox"
            aria-label={t('sidebar.searchConversations')}
            aria-autocomplete="list"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={selected ? `${listId}-${selected.id}` : undefined}
            placeholder={t('sidebar.searchPlaceholder')}
            value={query}
            className="h-10 rounded-md pl-9"
            onChange={(event) => update(event.target.value)}
            onCompositionStart={() => {
              composing.current = true
            }}
            onCompositionEnd={(event) => {
              composing.current = false
              update(event.currentTarget.value)
            }}
            onKeyDown={(event) => {
              if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) {
                event.stopPropagation()
                return
              }
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault()
                if (results.length)
                  setCurrent((index) => (Math.min(index, results.length - 1) + (event.key === 'ArrowDown' ? 1 : results.length - 1)) % results.length)
              } else if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
                event.preventDefault()
                event.stopPropagation()
                const row = selected && document.getElementById(`${listId}-${selected.id}`)
                if (selected && row) {
                  const bounds = row.getBoundingClientRect()
                  menuAction.current = false
                  setMenu({ session: selected, point: { x: bounds.left, y: bounds.bottom } })
                }
              } else if (event.key === 'Enter') {
                event.preventDefault()
                if (selected) choose(selected)
              }
            }}
          />
        </div>
        <h2 className="shrink-0 px-2 text-ui-small text-muted-foreground">{t(needle ? 'sidebar.searchResults' : 'sidebar.recentConversations')}</h2>
        <div id={listId} role="listbox" aria-label={t('sidebar.searchResults')} className="min-h-0 flex-1 overflow-y-auto" onScroll={() => setMenu(null)}>
          {results.map((session, index) => {
            const title = session.title.trim() || t('sidebar.untitled')
            const project = projects.find((project) => project.id === session.projectId)
            const highlighted: React.ReactNode[] = []
            let offset = 0
            let start = needle ? title.toLowerCase().indexOf(needle) : -1
            while (start >= 0) {
              highlighted.push(
                title.slice(offset, start),
                <mark key={start} className="rounded-xs bg-primary/15 text-foreground">
                  {title.slice(start, start + needle.length)}
                </mark>,
              )
              offset = start + needle.length
              start = title.toLowerCase().indexOf(needle, offset)
            }
            highlighted.push(title.slice(offset))
            return (
              <div key={session.id}>
                {renaming === session.id ? (
                  <div className="flex h-8 items-center px-2">
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
                        setRenaming(null)
                        input.current?.focus()
                      }}
                    />
                  </div>
                ) : (
                  <SidebarListRow
                    type="button"
                    id={`${listId}-${session.id}`}
                    role="option"
                    tabIndex={-1}
                    aria-selected={selected?.id === session.id}
                    aria-label={title}
                    data-search-session={session.id}
                    className="aria-selected:bg-accent"
                    onPointerMove={() => setCurrent(index)}
                    onClick={() => choose(session)}
                    onContextMenu={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      setCurrent(index)
                      menuAction.current = false
                      setMenu({ session, point: { x: event.clientX, y: event.clientY } })
                    }}
                  >
                    <MessageCircleIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.1} />
                    <span data-user-content className="min-w-0 flex-1 truncate">
                      {highlighted}
                    </span>
                    {project && (
                      <span data-user-content className="max-w-32 truncate rounded-xs bg-muted px-1.5 text-ui-small text-muted-foreground">
                        {project.name}
                      </span>
                    )}
                    <time dateTime={new Date(session.updatedAt).toISOString()} className="shrink-0 text-ui-small text-muted-foreground">
                      {sessionTime(session.updatedAt, now, locale, t)}
                    </time>
                  </SidebarListRow>
                )}
              </div>
            )
          })}
          {!results.length && (
            <div role="status" className="flex h-full flex-col items-center justify-center gap-1 text-ui-body text-muted-foreground">
              <p>{t(needle ? 'sidebar.searchNoMatches' : 'sidebar.noRecentConversations')}</p>
              {needle && <p className="text-ui-small">{t('sidebar.searchTryAgain')}</p>}
            </div>
          )}
        </div>
        {/* Keep the pointer anchor outside the transformed modal while retaining its React focus ancestry. */}
        {target &&
          menu &&
          createPortal(
            <SessionMenu
              session={target}
              open
              point={menu.point}
              pending={pending}
              onOpenChange={(value) => {
                if (!value) setMenu(null)
              }}
              onCloseAutoFocus={(event) => {
                event.preventDefault()
                if (!menuAction.current) input.current?.focus()
              }}
              onRename={() => {
                menuAction.current = true
                setRenaming(target.id)
                setMenu(null)
              }}
              onPin={() => {
                setPending(true)
                void lists
                  .getState()
                  .setPinned(target.id, target.pinnedAt === null)
                  .then((success) => {
                    if (!success) toast.error(t('sidebar.pinFailed'))
                    setPending(false)
                  })
              }}
              slots={{
                archive: <SessionArchiveMenuItem sessionId={target.id} onSelect={() => setMenu(null)} onPendingChange={setPending} />,
                moveToProject: <SessionMoveMenu session={target} close={() => setMenu(null)} />,
                delete: (
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() => {
                      menuAction.current = true
                      setDeleting(target)
                      setMenu(null)
                    }}
                  >
                    <SessionMenuIcon>
                      <Trash2Icon aria-hidden className="size-3.5" strokeWidth={1.1} />
                    </SessionMenuIcon>
                    {t('sidebar.deleteConversation')}
                  </DropdownMenuItem>
                ),
              }}
            />,
            document.body,
          )}

        {deleting && (
          <SessionDeleteDialog
            sessionId={deleting.id}
            open
            onOpenChange={(value) => {
              if (!value) setDeleting(null)
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault()
              input.current?.focus()
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
