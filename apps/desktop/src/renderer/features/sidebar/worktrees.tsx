import type { Workspace, Worktree } from '@coko/protocol'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  toast,
} from '@coko/ui'
import type { MessageKey } from '@coko/i18n'
import { EllipsisIcon, GitBranchPlusIcon, ListTreeIcon, LoaderCircleIcon, TriangleAlertIcon } from 'lucide-react'
import * as React from 'react'
import { useStore } from 'zustand'
import { useChatActions } from '../../app/chat.tsx'
import { useI18n } from '../../app/i18n.tsx'
import { ApiError } from '../../client/api.ts'
import { worktreesStore, type RemoveBlock, type WorktreesActions, type WorktreesState, type WorktreesStore } from '../../stores/worktrees-store.ts'

// 侧栏的 worktree 入口（ADR 0016）：Workspace 组标题的菜单（在新 worktree 中新建会话、worktree…）、新建对话框与 worktree 列表（移除与确认）。

const WorktreesStoreContext = React.createContext<WorktreesStore>(worktreesStore)

export function WorktreesStoreProvider({ store, children }: { store: WorktreesStore; children: React.ReactNode }) {
  return <WorktreesStoreContext.Provider value={store}>{children}</WorktreesStoreContext.Provider>
}

const useWorktreesStoreApi = () => React.useContext(WorktreesStoreContext)
function useWorktrees<T>(selector: (state: WorktreesState & WorktreesActions) => T): T {
  return useStore(useWorktreesStoreApi(), selector)
}

const CREATE_ERRORS: Partial<Record<string, MessageKey>> = {
  'not-a-git-repo': 'worktrees.errors.notARepo',
  'invalid-name': 'worktrees.errors.invalidName',
  'worktree-exists': 'worktrees.errors.exists',
  'unsafe-worktree-path': 'worktrees.errors.unsafePath',
}

/** Workspace 组标题的菜单按钮与它打开的两个对话框。 */
export function WorkspaceWorktreeMenu({ workspace, onOpened }: { workspace: Workspace; onOpened: () => void }) {
  const { t } = useI18n()
  const [dialog, setDialog] = React.useState<'create' | 'list' | null>(null)
  const label = t('worktrees.workspaceMenu', { name: workspace.name })
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="toolbar" size="icon-xs" aria-label={label} title={label} data-action="workspace-menu">
            <EllipsisIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuItem data-action="new-worktree-session" onSelect={() => setDialog('create')}>
            <GitBranchPlusIcon />
            {t('worktrees.newSessionInWorktree')}
          </DropdownMenuItem>
          <DropdownMenuItem data-action="manage-worktrees" onSelect={() => setDialog('list')}>
            <ListTreeIcon />
            {t('worktrees.manage')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <CreateWorktreeDialog workspace={workspace} open={dialog === 'create'} onClose={() => setDialog(null)} onOpened={onOpened} />
      <WorktreeListDialog workspace={workspace} open={dialog === 'list'} onClose={() => setDialog(null)} />
    </>
  )
}

function CreateWorktreeDialog({ workspace, open, onClose, onOpened }: { workspace: Workspace; open: boolean; onClose: () => void; onOpened: () => void }) {
  const { t } = useI18n()
  const store = useWorktreesStoreApi()
  const { load, openSession } = useChatActions()
  const [name, setName] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [submitting, setSubmitting] = React.useState(false)
  React.useEffect(() => {
    if (!open) return
    setName('')
    setError(null)
    setSubmitting(false)
  }, [open])

  const submit = async () => {
    setSubmitting(true)
    setError(null)
    try {
      const session = await store.getState().createSession(workspace.id, name.trim() === '' ? undefined : name.trim())
      await load()
      openSession(session.id)
      onClose()
      onOpened()
    } catch (e) {
      const key = e instanceof ApiError ? CREATE_ERRORS[e.code] : undefined
      setError(t(key ?? 'worktrees.errors.createFailed'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent closeLabel={t('worktrees.close')} data-slot="create-worktree-dialog" className="max-w-[480px] gap-4 p-6">
        <div className="flex flex-col gap-1 pe-8">
          <DialogTitle>{t('worktrees.createTitle')}</DialogTitle>
          <DialogDescription>{t('worktrees.createDescription', { path: `${workspace.name}/.coko-worktrees` })}</DialogDescription>
        </div>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (!submitting) void submit()
          }}
        >
          <label className="flex flex-col gap-1.5 text-ui-body">
            <span className="font-medium">{t('worktrees.nameLabel')}</span>
            <Input
              name="worktree-name"
              value={name}
              autoFocus
              autoComplete="off"
              spellCheck={false}
              placeholder={t('worktrees.namePlaceholder')}
              aria-invalid={error !== null || undefined}
              aria-describedby="worktree-name-hint"
              onChange={(event) => setName(event.target.value)}
            />
            <span id="worktree-name-hint" className="text-ui-small text-muted-foreground">
              {t('worktrees.nameHint')}
            </span>
          </label>
          {error !== null && (
            <p role="alert" data-slot="worktree-error" className="text-ui-body text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              {t('worktrees.cancel')}
            </Button>
            <Button type="submit" data-action="create-worktree" disabled={submitting}>
              {submitting && <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" />}
              {submitting ? t('worktrees.creating') : t('worktrees.create')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function blockText(t: ReturnType<typeof useI18n>['t'], block: RemoveBlock): string {
  if (block.kind === 'dirty') return t('worktrees.dirty', { count: block.count })
  return t('worktrees.busy', { reasons: block.reasons.map((reason) => t(`worktrees.busyReasons.${reason}`)).join('、') })
}

function WorktreeListDialog({ workspace, open, onClose }: { workspace: Workspace; open: boolean; onClose: () => void }) {
  const { t } = useI18n()
  const store = useWorktreesStoreApi()
  const entry = useWorktrees((s) => s.workspaces[workspace.id])
  const [confirming, setConfirming] = React.useState<Worktree | null>(null)
  React.useEffect(() => {
    if (open) void store.getState().load(workspace.id)
  }, [open, store, workspace.id])

  return (
    <>
      <Dialog open={open && confirming === null} onOpenChange={(next) => !next && onClose()}>
        <DialogContent closeLabel={t('worktrees.close')} data-slot="worktree-list-dialog" className="max-w-[560px] gap-4 p-6">
          <div className="flex flex-col gap-1 pe-8">
            <DialogTitle>{t('worktrees.listTitle', { name: workspace.name })}</DialogTitle>
            <DialogDescription>{t('worktrees.listDescription')}</DialogDescription>
          </div>
          <div aria-busy={entry?.status === 'loading' || undefined} className="flex max-h-80 min-h-8 flex-col gap-1 overflow-y-auto">
            {(entry === undefined || (entry.status === 'loading' && entry.worktrees.length === 0)) && (
              <p className="flex items-center gap-2 text-ui-body text-muted-foreground">
                <LoaderCircleIcon aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
                {t('worktrees.loading')}
              </p>
            )}
            {entry?.status === 'error' && (
              <div className="flex items-center gap-2 text-ui-body text-muted-foreground">
                <p>{t('worktrees.loadFailed')}</p>
                <Button variant="outline" size="sm" onClick={() => void store.getState().load(workspace.id)}>
                  {t('worktrees.retry')}
                </Button>
              </div>
            )}
            {entry?.status === 'ready' && entry.worktrees.length === 0 && <p className="text-ui-body text-muted-foreground">{t('worktrees.empty')}</p>}
            {entry?.worktrees.length ? (
              <ul className="flex flex-col gap-1">
                {entry.worktrees.map((worktree) => (
                  <WorktreeRow key={worktree.id} worktree={worktree} onRemove={() => setConfirming(worktree)} />
                ))}
              </ul>
            ) : null}
          </div>
          <div className="flex justify-end">
            <Button variant="outline" onClick={onClose}>
              {t('worktrees.close')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <RemoveWorktreeDialog workspace={workspace} worktree={confirming} onClose={() => setConfirming(null)} />
    </>
  )
}

function WorktreeRow({ worktree, onRemove }: { worktree: Worktree; onRemove: () => void }) {
  const { t } = useI18n()
  const block = useWorktrees((s) => s.blocked[worktree.id])
  const removed = worktree.status === 'removed'
  return (
    <li data-worktree-id={worktree.id} data-worktree-status={worktree.status} className="flex flex-col gap-1 rounded-md px-2 py-1.5">
      <div className="flex min-w-0 items-center gap-2">
        <div className="flex min-w-0 flex-1 flex-col">
          <span data-user-content className="truncate text-ui-body font-medium" title={worktree.path}>
            {worktree.name}
          </span>
          <span className="truncate text-ui-small text-muted-foreground">
            <span data-user-content>{worktree.branch}</span> · {t('worktrees.sessions', { count: worktree.sessionCount })}
          </span>
        </div>
        {removed ? (
          <span className="shrink-0 text-ui-small text-muted-foreground">{t('worktrees.removedStatus')}</span>
        ) : (
          <Button variant="outline" size="sm" data-action="remove-worktree" onClick={onRemove}>
            {t('worktrees.remove')}
          </Button>
        )}
      </div>
      {block && !removed && (
        <p role="alert" data-slot="worktree-block" data-block={block.kind} className="flex items-start gap-1.5 text-ui-small text-warning-text">
          <TriangleAlertIcon aria-hidden className="mt-0.5 size-3.5 shrink-0 text-warning" />
          {blockText(t, block)}
        </p>
      )}
    </li>
  )
}

function RemoveWorktreeDialog({ workspace, worktree, onClose }: { workspace: Workspace; worktree: Worktree | null; onClose: () => void }) {
  const { t } = useI18n()
  const store = useWorktreesStoreApi()
  const { load } = useChatActions()
  const [submitting, setSubmitting] = React.useState(false)
  const block = useWorktrees((s) => (worktree ? s.blocked[worktree.id] : undefined))
  React.useEffect(() => setSubmitting(false), [worktree?.id])

  const confirm = async () => {
    if (!worktree) return
    setSubmitting(true)
    try {
      const result = await store.getState().remove(workspace.id, worktree.id)
      if (result === undefined) {
        // 绑定的会话变为只读：重新读取会话列表（DTO 的 worktree.status）。
        await load()
        onClose()
      }
    } catch {
      toast.error(t('worktrees.errors.removeFailed'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={worktree !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent closeLabel={t('worktrees.close')} data-slot="remove-worktree-dialog" className="max-w-[480px] gap-4 p-6">
        {worktree && (
          <>
            <div className="flex flex-col gap-1 pe-8">
              <DialogTitle>{t('worktrees.removeTitle', { name: worktree.name })}</DialogTitle>
              <DialogDescription>{t('worktrees.removeDescription', { path: worktree.path, branch: worktree.branch })}</DialogDescription>
            </div>
            {block && (
              <div role="alert" data-slot="worktree-block" data-block={block.kind} className="flex flex-col gap-1.5 text-ui-body text-warning-text">
                <p className="flex items-start gap-1.5">
                  <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
                  {blockText(t, block)}
                </p>
                {block.kind === 'dirty' && (
                  <ul className="flex max-h-40 flex-col gap-0.5 overflow-y-auto ps-5.5 text-foreground">
                    {block.files.map((file) => (
                      <li key={file} data-user-content className="truncate font-mono text-ui-small" title={file}>
                        {file}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={onClose}>
                {t('worktrees.cancel')}
              </Button>
              <Button variant="destructive" data-action="confirm-remove-worktree" disabled={submitting} onClick={() => void confirm()}>
                {submitting && <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" />}
                {submitting ? t('worktrees.removing') : t('worktrees.confirmRemove')}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
