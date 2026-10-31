import type { MessageKey } from '@coko/i18n'
import type { HandoffTarget } from '@coko/protocol'
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle, DropdownMenuItem, Input, Textarea, ToggleGroup, ToggleGroupItem } from '@coko/ui'
import { ArrowRightLeftIcon, LoaderCircleIcon, TriangleAlertIcon } from 'lucide-react'
import * as React from 'react'
import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'
import { useOptionalChatStoreApi } from '../../app/chat.tsx'
import { useI18n } from '../../app/i18n.tsx'
import { IconButton } from '../../app/icon-button.tsx'
import { ApiError } from '../../client/api.ts'
import { handoffStore as defaultHandoffStore, type HandoffStore } from '../../stores/handoff-store.ts'
import { worktreesStore as defaultWorktreesStore, type WorktreesStore } from '../../stores/worktrees-store.ts'
import { HeaderMenuActionContext, type HeaderActionProps } from './header-actions.ts'

// 交接（docs/subsystems/handoff.md）：标题栏的"交接"按钮与对话框。对话框填写下一步目标与目标目录（当前目录 / 新 worktree / 已有 worktree），
// 源会话有未提交改动时提示；提交后显示进行中（可停止），完成后由 handoff store 切到目标会话并把摘要写入其输入区草稿。

const HandoffStoreContext = React.createContext<HandoffStore>(defaultHandoffStore)
const WorktreeListContext = React.createContext<WorktreesStore>(defaultWorktreesStore)

/** 测试注入：交接与 worktree 列表的 store。 */
export function HandoffStoresProvider({ handoff, worktrees, children }: { handoff: HandoffStore; worktrees?: WorktreesStore; children: React.ReactNode }) {
  return (
    <HandoffStoreContext.Provider value={handoff}>
      <WorktreeListContext.Provider value={worktrees ?? defaultWorktreesStore}>{children}</WorktreeListContext.Provider>
    </HandoffStoreContext.Provider>
  )
}

const ERRORS: Partial<Record<string, MessageKey>> = {
  'nothing-to-hand-off': 'handoff.errors.nothing',
  'run-in-progress': 'handoff.errors.running',
  'child-session': 'handoff.errors.childSession',
  'not-a-git-repo': 'handoff.errors.notARepo',
  'invalid-name': 'handoff.errors.invalidName',
  'worktree-exists': 'handoff.errors.exists',
  'worktree-removed': 'handoff.errors.removed',
}

type TargetKind = HandoffTarget['kind']

/**
 * 窄主区中"更多操作"菜单项的打开请求（按会话计数）。对话框由标题栏中始终挂载（窄时隐藏）的 HandoffButton 持有：菜单关闭后菜单项卸载，
 * 对话框不能放在菜单项里。
 */
const openRequests = createStore<Record<string, number>>(() => ({}))
const requestOpen = (sessionId: string) => openRequests.setState((s) => ({ [sessionId]: (s[sessionId] ?? 0) + 1 }))

/** 按钮与菜单项共用：子 Session（子代理）不能交接（Sidecar 409 child-session），不显示；交接进行中时换成进行中的文案与图标。 */
function useHandoffAction(sessionId: string) {
  const { t } = useI18n()
  const store = React.useContext(HandoffStoreContext)
  const chat = useOptionalChatStoreApi()
  const progress = useStore(store, (s) => s.progress[sessionId])
  const child = React.useSyncExternalStore(chat?.subscribe ?? (() => () => {}), () => {
    const session = chat?.getState().sessions.find((s) => s.id === sessionId)
    return session?.parentSessionId !== undefined
  })
  const active = progress !== undefined && progress.phase !== 'stopped'
  const label = active ? t('handoff.headerActionRunning') : t('handoff.headerAction')
  const icon = active ? <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" /> : <ArrowRightLeftIcon />
  return { hidden: child, phase: progress?.phase, label, icon }
}

/** 标题栏的"交接"按钮：根会话可用；交接进行中时显示进度并重新打开对话框。窄主区中按钮隐藏，对话框仍由它持有（见 HandoffMenuItem）。 */
export function HandoffButton({ sessionId }: HeaderActionProps) {
  const store = React.useContext(HandoffStoreContext)
  const chat = useOptionalChatStoreApi()
  React.useEffect(() => (chat ? store.getState().attach(chat) : undefined), [chat, store])
  const { hidden, phase, label, icon } = useHandoffAction(sessionId)
  const [open, setOpen] = React.useState(false)
  // 经"更多操作"菜单打开时，记下菜单按钮（菜单项已卸载），对话框关闭后焦点回到那里。标题栏按钮直接打开时保持 Radix 的默认行为。
  const opener = React.useRef<HTMLElement | null>(null)
  const show = (fromMenu: boolean) => {
    opener.current = fromMenu && document.activeElement instanceof HTMLElement ? document.activeElement : null
    setOpen(true)
  }
  // 对话框属于打开它的会话：切换会话（包括交接完成后切到目标会话）时关闭，焦点不回到另一个会话的标题栏。
  React.useEffect(() => {
    opener.current = null
    setOpen(false)
  }, [sessionId])
  // 菜单项的打开请求：只响应本会话在挂载（或切换到本会话）之后的新请求；计数按会话记，切换会话不算新请求。
  const request = useStore(openRequests, (s) => s[sessionId] ?? 0)
  const seen = React.useRef({ sessionId, request })
  React.useEffect(() => {
    const last = seen.current
    seen.current = { sessionId, request }
    if (last.sessionId === sessionId && last.request !== request) show(true)
  }, [sessionId, request])
  if (hidden) return null
  return (
    <>
      <IconButton label={label} data-action="open-handoff" data-handoff-phase={phase} onClick={() => show(false)}>
        {icon}
      </IconButton>
      <HandoffDialog
        sessionId={sessionId}
        open={open}
        onClose={() => setOpen(false)}
        onCloseAutoFocus={(event) => {
          const target = opener.current
          opener.current = null
          // 打开者已卸载或不再显示（例如窗口在此期间变宽或变窄）时交给默认行为。
          if (!target?.isConnected || target.getClientRects().length === 0) return
          event.preventDefault()
          target.focus()
        }}
      />
    </>
  )
}

/** 窄主区中"更多操作"菜单里的"交接"：请求标题栏中隐藏的 HandoffButton 打开对话框。 */
export function HandoffMenuItem({ sessionId }: HeaderActionProps) {
  const { hidden, phase, label, icon } = useHandoffAction(sessionId)
  const afterMenuClose = React.useContext(HeaderMenuActionContext)
  if (hidden) return null
  return (
    <DropdownMenuItem data-action="open-handoff" data-handoff-phase={phase} onSelect={() => afterMenuClose(() => requestOpen(sessionId))}>
      {icon}
      {label}
    </DropdownMenuItem>
  )
}

export interface HandoffDialogProps {
  sessionId: string
  open: boolean
  onClose: () => void
  /** 对话框关闭后的焦点去向（Radix 的 onCloseAutoFocus）。 */
  onCloseAutoFocus?: (event: Event) => void
}

export function HandoffDialog({ sessionId, open, onClose, onCloseAutoFocus }: HandoffDialogProps) {
  const { t } = useI18n()
  const store = React.useContext(HandoffStoreContext)
  const worktrees = React.useContext(WorktreeListContext)
  const chat = useOptionalChatStoreApi()
  const workspaceId = React.useSyncExternalStore(
    chat?.subscribe ?? (() => () => {}),
    () => chat?.getState().sessions.find((s) => s.id === sessionId)?.workspaceId,
  )
  const progress = useStore(store, (s) => s.progress[sessionId])
  const git = useStore(store, (s) => s.gitStatus[sessionId])
  const list = useStore(worktrees, (s) => (workspaceId === undefined ? undefined : s.workspaces[workspaceId]?.worktrees))
  const available = React.useMemo(() => (list ?? []).filter((w) => w.status === 'active'), [list])
  const [instructions, setInstructions] = React.useState('')
  const [kind, setKind] = React.useState<TargetKind>('current')
  const [name, setName] = React.useState('')
  const [worktreeId, setWorktreeId] = React.useState<string | undefined>(undefined)
  const [error, setError] = React.useState<string | null>(null)
  const [submitting, setSubmitting] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    setError(null)
    setSubmitting(false)
    void store.getState().loadGitStatus(sessionId)
    if (workspaceId !== undefined) void worktrees.getState().load(workspaceId)
  }, [open, sessionId, workspaceId, store, worktrees])

  const repo = git?.repo === true
  const effectiveKind: TargetKind = repo ? kind : 'current'
  const selected = effectiveKind === 'worktree' ? (available.find((w) => w.id === worktreeId) ?? available[0]) : undefined
  const busy = progress !== undefined && progress.phase !== 'stopped'
  const canSubmit = instructions.trim() !== '' && !submitting && !busy && (effectiveKind !== 'worktree' || selected !== undefined)

  const submit = async () => {
    if (!canSubmit) return
    const target: HandoffTarget =
      effectiveKind === 'current'
        ? { kind: 'current' }
        : effectiveKind === 'new-worktree'
          ? { kind: 'new-worktree', ...(name.trim() === '' ? {} : { name: name.trim() }) }
          : { kind: 'worktree', worktreeId: selected!.id }
    setSubmitting(true)
    setError(null)
    store.getState().dismiss(sessionId)
    try {
      await store.getState().start(sessionId, { instructions: instructions.trim(), target })
    } catch (e) {
      const key = e instanceof ApiError ? ERRORS[e.code] : undefined
      setError(t(key ?? 'handoff.errors.failed'))
    } finally {
      setSubmitting(false)
    }
  }

  const dirty = git?.dirtyFiles ?? 0
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        closeLabel={t('handoff.close')}
        onCloseAutoFocus={onCloseAutoFocus}
        data-slot="handoff-dialog"
        data-phase={progress?.phase ?? 'idle'}
        className="max-w-[560px] gap-4 p-6"
      >
        <div className="flex flex-col gap-1 pe-8">
          <DialogTitle>{t('handoff.title')}</DialogTitle>
          <DialogDescription>{t('handoff.description')}</DialogDescription>
        </div>
        {busy ? (
          <div role="status" data-slot="handoff-progress" className="flex items-center gap-2 text-ui-body text-muted-foreground">
            <LoaderCircleIcon aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
            <span className="min-w-0 flex-1">{progress.phase === 'summarizing' ? t('handoff.summarizing') : t('handoff.creating')}</span>
            {progress.phase === 'summarizing' && (
              <Button size="sm" variant="outline" data-action="stop-handoff" onClick={() => void store.getState().stop(sessionId)}>
                {t('handoff.stop')}
              </Button>
            )}
          </div>
        ) : (
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              void submit()
            }}
          >
            {progress?.phase === 'stopped' && (
              <p role="status" data-slot="handoff-stopped" className="text-ui-body text-muted-foreground">
                {t('handoff.stopped')}
              </p>
            )}
            <div className="flex flex-col gap-1.5 text-ui-body">
              <label htmlFor="handoff-instructions" className="font-medium">
                {t('handoff.instructionsLabel')}
              </label>
              <Textarea
                id="handoff-instructions"
                name="handoff-instructions"
                value={instructions}
                autoFocus
                rows={3}
                placeholder={t('handoff.instructionsPlaceholder')}
                aria-describedby="handoff-submit-hint"
                onChange={(event) => setInstructions(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) {
                    event.preventDefault()
                    void submit()
                  }
                }}
              />
              <span id="handoff-submit-hint" className="text-ui-small text-muted-foreground">
                {t('handoff.submitHint')}
              </span>
            </div>
            <div className="flex flex-col gap-1.5">
              <span id="handoff-target-label" className="text-ui-body font-medium">
                {t('handoff.targetLabel')}
              </span>
              <ToggleGroup
                type="single"
                aria-labelledby="handoff-target-label"
                value={effectiveKind}
                onValueChange={(value) => value && setKind(value as TargetKind)}
                className="flex-wrap"
              >
                <ToggleGroupItem value="current" data-handoff-target="current">
                  {t('handoff.targets.current')}
                </ToggleGroupItem>
                <ToggleGroupItem value="new-worktree" data-handoff-target="new-worktree" disabled={!repo}>
                  {t('handoff.targets.newWorktree')}
                </ToggleGroupItem>
                <ToggleGroupItem value="worktree" data-handoff-target="worktree" disabled={!repo || available.length === 0}>
                  {t('handoff.targets.worktree')}
                </ToggleGroupItem>
              </ToggleGroup>
              {git !== undefined && !repo && <p className="text-ui-small text-muted-foreground">{t('handoff.notARepo')}</p>}
            </div>
            {effectiveKind === 'new-worktree' && (
              <label className="flex flex-col gap-1.5 text-ui-body">
                <span className="font-medium">{t('handoff.worktreeName')}</span>
                <Input
                  name="handoff-worktree-name"
                  value={name}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={t('handoff.worktreeNamePlaceholder')}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
            )}
            {effectiveKind === 'worktree' && (
              <div className="flex flex-col gap-1.5">
                <span id="handoff-worktree-label" className="text-ui-body font-medium">
                  {t('handoff.worktreeLabel')}
                </span>
                {available.length === 0 ? (
                  <p className="text-ui-small text-muted-foreground">{t('handoff.noWorktrees')}</p>
                ) : (
                  <ToggleGroup
                    type="single"
                    aria-labelledby="handoff-worktree-label"
                    value={selected?.id ?? ''}
                    onValueChange={(value) => value && setWorktreeId(value)}
                    className="flex-wrap"
                  >
                    {available.map((w) => (
                      <ToggleGroupItem key={w.id} value={w.id} data-worktree-id={w.id}>
                        <span data-user-content className="truncate">
                          {w.branch}
                        </span>
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                )}
              </div>
            )}
            {repo && dirty > 0 && (
              <p role="alert" data-slot="handoff-dirty" data-count={dirty} className="flex items-start gap-1.5 text-ui-body text-warning-text">
                <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
                {effectiveKind === 'current' ? t('handoff.dirtyCurrent', { count: dirty }) : t('handoff.dirtyWorktree', { count: dirty })}
              </p>
            )}
            {error !== null && (
              <p role="alert" data-slot="handoff-error" className="text-ui-body text-destructive">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                {t('handoff.cancel')}
              </Button>
              <Button type="submit" data-action="submit-handoff" disabled={!canSubmit}>
                {submitting && <LoaderCircleIcon aria-hidden className="animate-spin motion-reduce:animate-none" />}
                {t('handoff.submit')}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
