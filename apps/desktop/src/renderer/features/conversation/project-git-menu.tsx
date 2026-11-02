import { BRANCH_PREFIX_SETTING, branchNameError, type Project } from '@coko/protocol'
import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuStackedSubContent,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  Input,
} from '@coko/ui'
import { GitBranchIcon, Settings2Icon } from 'lucide-react'
import * as React from 'react'
import { useStore } from 'zustand'
import { useNewChat } from '../../app/chat.tsx'
import { useI18n } from '../../app/i18n.tsx'
import { useSettings, useSettingsActions } from '../../app/settings.tsx'
import { ApiError } from '../../client/api.ts'
import { branchesStore, type BranchesStore } from '../../stores/branches-store.ts'

const BranchContext = React.createContext<BranchesStore>(branchesStore)
export function BranchesProvider({ store, children }: { store: BranchesStore; children: React.ReactNode }) {
  return <BranchContext.Provider value={store}>{children}</BranchContext.Provider>
}

/** The worktree slot precedes Branch. Base-branch mode selects draft configuration without changing the primary checkout. */
export function ProjectGitMenu({
  project,
  worktreeSlot,
}: {
  project: Project | undefined
  worktreeSlot?: React.ReactNode | ((state: { available: boolean; pending: boolean; loading: boolean }) => React.ReactNode)
}) {
  const { t } = useI18n()
  const store = React.useContext(BranchContext)
  const git = useStore(store, (state) => (project ? state.projects[project.id] : undefined))
  const pending = useStore(store, (state) => state.pending)
  const configure = useNewChat((state) => state.configure)
  const draftBranch = useNewChat((state) => state.branch)
  const newWorktree = useNewChat((state) => state.newWorktree)
  const sending = useNewChat((state) => state.sending)
  const prefix = useSettings((state) => state.values[BRANCH_PREFIX_SETTING]?.value)
  const { saveSetting } = useSettingsActions()
  const [open, setOpen] = React.useState(false)
  const [subOpen, setSubOpen] = React.useState(false)
  const [dialog, setDialog] = React.useState(false)
  const [search, setSearch] = React.useState('')
  const [name, setName] = React.useState('')
  const [editingPrefix, setEditingPrefix] = React.useState(false)
  const [prefixDraft, setPrefixDraft] = React.useState('')
  const [prefixStatus, setPrefixStatus] = React.useState('')
  const [prefixSaving, setPrefixSaving] = React.useState(false)
  const [error, setError] = React.useState('')
  const [loading, setLoading] = React.useState(false)
  const requestedDialog = React.useRef(false)
  const settingsTrigger = React.useRef<HTMLButtonElement>(null)
  const branchTrigger = React.useRef<HTMLDivElement>(null)
  const searchInput = React.useRef<HTMLInputElement>(null)
  const nameInput = React.useRef<HTMLInputElement>(null)
  const id = React.useId()
  const failure = (error: unknown) =>
    t(
      error instanceof ApiError && error.code === 'git-dirty'
        ? 'worktrees.branchDirty'
        : error instanceof ApiError && error.code === 'session-busy'
          ? 'worktrees.branchBusy'
          : error instanceof ApiError && error.code === 'already-exists'
            ? 'worktrees.branchExists'
            : 'worktrees.branchFailed',
    )
  const load = async () => {
    if (!project) return
    setLoading(true)
    try {
      await store.getState().load(project.id)
    } catch {
      setError(t('worktrees.branchLoadFailed'))
    } finally {
      setLoading(false)
    }
  }
  React.useEffect(() => {
    setOpen(false)
    setSubOpen(false)
    setDialog(false)
    setError('')
  }, [project?.id])
  React.useEffect(() => {
    if (!subOpen) return
    const frame = requestAnimationFrame(() => searchInput.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [subOpen])
  const previousSubOpen = React.useRef(false)
  React.useEffect(() => {
    const closed = previousSubOpen.current && !subOpen
    previousSubOpen.current = subOpen
    if (!closed || !open || requestedDialog.current) return
    const frame = requestAnimationFrame(() => branchTrigger.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [subOpen, open])
  const selected = newWorktree ? (draftBranch ?? git?.current) : git?.current
  const validation = branchNameError(name)
  const validationText =
    validation === 'empty'
      ? t('worktrees.branchEmptyName')
      : validation === 'trailingSlash'
        ? t('worktrees.branchTrailingSlash')
        : validation
          ? t('worktrees.branchInvalid')
          : ''
  const choose = async (branch: string) => {
    if (!project || pending) return
    setError('')
    try {
      if (!newWorktree && branch !== git?.current) await store.getState().checkout(project.id, { name: branch })
      configure({ branch })
      setSubOpen(false)
      branchTrigger.current?.focus()
    } catch (error) {
      setError(failure(error))
    }
  }
  const create = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!project || validation || pending) return
    setError('')
    try {
      await store.getState().checkout(project.id, { name, create: true })
      configure({ branch: name })
      setDialog(false)
    } catch (error) {
      setError(failure(error))
    }
  }
  return (
    <>
      <DropdownMenu
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (next) {
            setError('')
            void load()
          }
        }}
      >
        <DropdownMenuTrigger asChild>
          <Button
            ref={settingsTrigger}
            type="button"
            variant="toolbar"
            size="icon-sm"
            disabled={sending}
            aria-label={t('worktrees.projectConfiguration')}
            className="ml-auto size-7 [&_svg]:size-3.5"
          >
            <Settings2Icon aria-hidden strokeWidth={1.1} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="top"
          sideOffset={6}
          align="end"
          aria-label={t('worktrees.projectConfiguration')}
          aria-labelledby={undefined}
          className="w-64"
          onCloseAutoFocus={(event) => {
            if (requestedDialog.current) {
              event.preventDefault()
              requestedDialog.current = false
              setDialog(true)
            }
          }}
        >
          {typeof worktreeSlot === 'function'
            ? worktreeSlot({ available: Boolean(project && git?.available), pending: pending || sending, loading })
            : worktreeSlot}
          <DropdownMenuSub
            open={subOpen}
            onOpenChange={(next) => {
              setSubOpen(next)
              if (next) setSearch('')
            }}
          >
            <DropdownMenuSubTrigger ref={branchTrigger} disabled={!project || !git?.available || loading || pending} onClick={() => setSubOpen(true)}>
              <GitBranchIcon aria-hidden className="size-3.5" strokeWidth={1.1} />
              <span>{t('worktrees.branchLabel')}</span>
              <span data-user-content className="ml-auto max-w-32 truncate text-muted-foreground">
                {selected ?? (git?.available ? t('worktrees.branchDetached') : '')}
              </span>
            </DropdownMenuSubTrigger>
            <DropdownMenuStackedSubContent
              alignEnd
              aria-label={t('worktrees.branchSearch')}
              aria-labelledby={undefined}
              className="w-72 max-w-[calc(100vw-16px)]"
              onEscapeKeyDown={(event) => {
                event.preventDefault()
                setSubOpen(false)
                branchTrigger.current?.focus()
              }}
            >
              <div className="p-1">
                <Input
                  ref={searchInput}
                  aria-label={t('worktrees.branchSearch')}
                  placeholder={t('worktrees.branchSearch')}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowDown') {
                      event.preventDefault()
                      event.currentTarget.closest('[role="menu"]')?.querySelector<HTMLElement>('[role="menuitemradio"]')?.focus()
                    }
                    if (event.key !== 'Escape' && event.key !== 'Tab') event.stopPropagation()
                  }}
                />
              </div>
              <DropdownMenuRadioGroup value={selected ?? ''}>
                {(git?.branches ?? [])
                  .filter((branch) => branch.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
                  .map((branch) => (
                    <DropdownMenuRadioItem
                      key={branch.name}
                      value={branch.name}
                      indicatorAlign="end"
                      disabled={pending}
                      onSelect={(event) => {
                        event.preventDefault()
                        void choose(branch.name)
                      }}
                    >
                      <span data-user-content className="truncate">
                        {branch.name}
                      </span>
                    </DropdownMenuRadioItem>
                  ))}
              </DropdownMenuRadioGroup>
              {!git?.branches.some((branch) => branch.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())) && (
                <p role="status" className="px-2 py-2 text-ui-body text-muted-foreground">
                  {t('worktrees.branchEmpty')}
                </p>
              )}
              {!newWorktree && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    disabled={pending}
                    onSelect={() => {
                      requestedDialog.current = true
                      setName(typeof prefix === 'string' ? prefix : '')
                      setPrefixDraft(typeof prefix === 'string' ? prefix : '')
                      setEditingPrefix(false)
                      setPrefixStatus('')
                      setError('')
                      setSubOpen(false)
                      setOpen(false)
                    }}
                  >
                    {t('worktrees.branchCreateEntry')}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuStackedSubContent>
          </DropdownMenuSub>
          {(!project || !git?.available || loading) && (
            <p role="status" className="px-2 py-1 text-ui-small text-muted-foreground">
              {!project
                ? t('worktrees.selectProject')
                : loading
                  ? t('worktrees.loading')
                  : git?.reason === 'git-unavailable'
                    ? t('worktrees.gitUnavailable')
                    : git?.reason === 'not-a-git-repo'
                      ? t('worktrees.notGitPrimary')
                      : error}
            </p>
          )}
          {error && git?.available && (
            <p role="alert" className="px-2 py-1 text-ui-body text-destructive">
              {error}
            </p>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog
        open={dialog}
        onOpenChange={(next) => {
          if (!pending) setDialog(next)
        }}
      >
        <DialogContent
          closeLabel={t('worktrees.close')}
          aria-describedby={undefined}
          className="max-w-[440px] gap-5 p-6"
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            nameInput.current?.focus()
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            settingsTrigger.current?.focus()
          }}
        >
          <DialogTitle className="pr-8">{t('worktrees.branchCreateTitle')}</DialogTitle>
          <form onSubmit={create} className="flex flex-col gap-3">
            <label htmlFor={id} className="text-ui-body font-medium">
              {t('worktrees.branchName')}
            </label>
            <Input
              id={id}
              ref={nameInput}
              value={name}
              disabled={pending}
              onChange={(event) => {
                setName(event.target.value)
                setError('')
              }}
              aria-invalid={Boolean(validation)}
              aria-describedby={`${id}-validation`}
            />
            <Button type="button" variant="ghost" size="sm" className="self-start" disabled={pending} onClick={() => setEditingPrefix((value) => !value)}>
              {t('worktrees.branchPrefix')}
            </Button>
            {editingPrefix && (
              <div className="flex flex-col gap-2">
                <label htmlFor={`${id}-prefix`} className="text-ui-body">
                  {t('worktrees.branchPrefix')}
                </label>
                <div className="flex gap-2">
                  <Input id={`${id}-prefix`} value={prefixDraft} disabled={prefixSaving} onChange={(event) => setPrefixDraft(event.target.value)} />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={prefixSaving}
                    onClick={async () => {
                      setPrefixSaving(true)
                      const result = await saveSetting(BRANCH_PREFIX_SETTING, prefixDraft)
                      setPrefixSaving(false)
                      setPrefixStatus(t(result.status === 'saved' ? 'worktrees.branchPrefixSaved' : 'worktrees.branchPrefixFailed'))
                    }}
                  >
                    {t('worktrees.branchSavePrefix')}
                  </Button>
                </div>
                <p role="status" className="min-h-5 text-ui-small text-muted-foreground">
                  {prefixStatus}
                </p>
              </div>
            )}
            <div id={`${id}-validation`} aria-live="polite" className="h-12 text-ui-body text-destructive">
              {error || validationText}
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" disabled={pending} onClick={() => setDialog(false)}>
                {t('worktrees.close')}
              </Button>
              <Button type="submit" disabled={Boolean(validation) || pending || prefixSaving}>
                {t(pending ? 'worktrees.branchCreating' : 'worktrees.branchCreate')}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
