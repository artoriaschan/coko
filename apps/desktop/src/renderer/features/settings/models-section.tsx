import type { Provider } from '@coko/protocol'
import { Button, cn, Dialog, DialogContent, DialogDescription, DialogTitle } from '@coko/ui'
import { LoaderCircleIcon, PlusIcon } from 'lucide-react'
import * as React from 'react'
import { useI18n } from '../../app/i18n.tsx'
import { useSettings, useSettingsActions, useSettingsDialog } from '../../app/settings.tsx'
import { DeleteProviderDialog, type DeleteProviderRequest } from './delete-provider-dialog.tsx'
import { draftOf, emptyDraft, isDirty, type FormDraft } from './provider-draft.ts'
import { ProviderForm } from './provider-form.tsx'
import { SettingsCard } from './settings-dialog.tsx'

/** 展开中的表单：新建（id 省略）或编辑某个已有 Provider。key 在表单生命周期内不变。 */
interface OpenForm {
  key: string
  id?: string
  initial: FormDraft
  draft: FormDraft
}

/** 关闭或切换后要聚焦的元素（表单所在位置的入口按钮）。 */
type FocusTarget = { kind: 'add' } | { kind: 'edit'; id: string }

let formSeq = 0

/**
 * 模型服务分区（规格 4.1）：供应商列表，列表底部新建，列表项内编辑；同一时间只展开一个表单。
 * 草稿有未保存修改时，关闭、切换表单或离开分区前提示“放弃更改？”。
 */
export function ModelsSection() {
  const { t } = useI18n()
  const status = useSettings((s) => s.status)
  const providers = useSettings((s) => s.providers)
  const { load } = useSettingsActions()
  const { setLeaveGuard } = useSettingsDialog()
  const [open, setOpen] = React.useState<OpenForm | null>(null)
  const [confirming, setConfirming] = React.useState<{ resolve: (discard: boolean) => void } | null>(null)
  const [deleting, setDeleting] = React.useState<DeleteProviderRequest | null>(null)
  const listId = React.useId()
  const sectionRef = React.useRef<HTMLElement>(null)
  const focusAfter = React.useRef<FocusTarget | null>(null)

  // 编辑中的 Provider 被删除时，表单随列表项一起消失。
  const current = open && (open.id === undefined || providers.some((p) => p.id === open.id)) ? open : null
  const dirty = current !== null && isDirty(current.draft, current.initial)
  const dirtyRef = React.useRef(dirty)
  dirtyRef.current = dirty

  /** 有未保存修改时询问；返回是否可以丢弃当前草稿。 */
  const confirmDiscard = React.useCallback(() => (dirtyRef.current ? new Promise<boolean>((resolve) => setConfirming({ resolve })) : Promise.resolve(true)), [])

  // 离开分区（切换分区、关闭设置）前确认；确认后丢弃草稿。
  React.useEffect(
    () =>
      setLeaveGuard(async () => {
        if (!(await confirmDiscard())) return false
        setOpen(null)
        return true
      }),
    [setLeaveGuard, confirmDiscard],
  )

  /** 关闭当前表单并（可选）展开另一个；当前草稿有修改时先确认。 */
  const switchTo = async (next: OpenForm | null) => {
    if (!(await confirmDiscard())) return
    const closing = current
    if (closing && next === null) focusAfter.current = closing.id === undefined ? { kind: 'add' } : { kind: 'edit', id: closing.id }
    setOpen(next)
  }

  // 表单关闭后焦点回到对应入口，不落到 body（新建表单关闭后“添加”按钮重新出现）。
  React.useEffect(() => {
    const target = focusAfter.current
    if (!target || confirming) return
    focusAfter.current = null
    const root = sectionRef.current
    const active = document.activeElement
    if (!root || (active !== null && active !== document.body && root.contains(active))) return
    const selector = target.kind === 'add' ? '[data-provider-add]' : `[data-provider-id="${CSS.escape(target.id)}"] [data-provider-edit]`
    root.querySelector<HTMLElement>(selector)?.focus()
  })

  const createForm = (): OpenForm => ({ key: `new-${++formSeq}`, initial: emptyDraft(), draft: emptyDraft() })
  const editForm = (provider: Provider): OpenForm => ({ key: `edit-${++formSeq}`, id: provider.id, initial: draftOf(provider), draft: draftOf(provider) })
  const onChange = (draft: FormDraft) => setOpen((form) => form && { ...form, draft })
  /** 保存成功：只关闭发起保存的那个表单。 */
  const onSaved = (key: string) => () =>
    setOpen((form) => {
      if (form?.key !== key) return form
      focusAfter.current = form.id === undefined ? { kind: 'edit', id: form.draft.providerId } : { kind: 'edit', id: form.id }
      return null
    })

  const form = (target: OpenForm, provider?: Provider) => (
    <ProviderForm
      key={target.key}
      id={`${listId}-${target.key}`}
      provider={provider}
      draft={target.draft}
      onChange={onChange}
      takenIds={providers.map((p) => p.id)}
      onCancel={() => void switchTo(null)}
      onSaved={onSaved(target.key)}
    />
  )
  const creating = current !== null && current.id === undefined

  return (
    <section ref={sectionRef} aria-labelledby="settings-models" className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id="settings-models" className="text-ui-heading font-medium">
            {t('providers.title')}
          </h2>
          <p className="text-ui-small text-muted-foreground">{t('providers.description')}</p>
        </div>
        <div aria-hidden className="h-hairline bg-border" />
      </div>

      {status === 'loading' && providers.length === 0 && (
        <div className="flex justify-center py-8">
          <LoaderCircleIcon aria-label={t('settings.models')} className="size-5 animate-spin text-muted-foreground motion-reduce:animate-none" />
        </div>
      )}
      {status === 'error' && (
        <div className="flex flex-col items-start gap-2 text-ui-body text-muted-foreground">
          <p>{t('providers.loadFailed')}</p>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            {t('settings.retry')}
          </Button>
        </div>
      )}
      {status === 'ready' && providers.length === 0 && !creating && <p className="text-ui-body text-muted-foreground">{t('providers.empty')}</p>}

      {providers.length > 0 && (
        <ul aria-label={t('providers.list')} className="flex flex-col gap-1">
          {providers.map((provider, index) => {
            const editing = current?.id === provider.id ? current : null
            const formId = editing ? `${listId}-${editing.key}` : undefined
            return (
              <ProviderRow
                key={provider.id}
                provider={provider}
                expanded={editing !== null}
                formId={formId}
                onEdit={() => void switchTo(editing ? null : editForm(provider))}
                onDelete={() => setDeleting((prev) => ({ provider, index, opened: (prev?.opened ?? 0) + 1, open: true }))}
              >
                {editing && form(editing, provider)}
              </ProviderRow>
            )
          })}
        </ul>
      )}

      {creating ? (
        <SettingsCard className="p-4">{form(current)}</SettingsCard>
      ) : (
        <Button data-provider-add variant="outline" className="w-full" disabled={status !== 'ready'} onClick={() => void switchTo(createForm())}>
          <PlusIcon />
          {t('providers.add')}
        </Button>
      )}

      <DeleteProviderDialog
        key={deleting?.opened ?? 0}
        request={deleting}
        onClose={() => setDeleting((prev) => (prev ? { ...prev, open: false } : prev))}
        focusAfterClose={(request, deleted) => {
          const root = sectionRef.current
          // 取消：回到该项的“删除”。删除后该项已不在：同一位置的列表项（或最后一项、添加入口）。
          if (!deleted) return root?.querySelector<HTMLElement>(`[data-provider-id="${CSS.escape(request.provider.id)}"] [data-provider-delete]`) ?? null
          const items = root?.querySelectorAll<HTMLElement>('[data-provider-id]') ?? []
          const item = items[Math.min(request.index, items.length - 1)]
          return item?.querySelector<HTMLElement>('[data-provider-edit]') ?? root?.querySelector<HTMLElement>('[data-provider-add]') ?? null
        }}
      />
      <DiscardDialog
        open={confirming !== null}
        onAnswer={(discard) => {
          confirming?.resolve(discard)
          setConfirming(null)
        }}
      />
    </section>
  )
}

function CredentialStatus({ provider }: { provider: Provider }) {
  const { t } = useI18n()
  const credential = provider.credential
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-ui-small text-muted-foreground">
      <span aria-hidden className={cn('size-1.5 shrink-0 rounded-round', credential ? 'bg-success' : 'bg-muted-foreground')} />
      <span data-credential-status={credential ? 'configured' : 'missing'} className="truncate">
        {credential
          ? credential.hint
            ? t('providers.credentialConfigured', { hint: credential.hint })
            : t('providers.credentialConfiguredNoHint')
          : t('providers.credentialMissing')}
      </span>
    </span>
  )
}

/** 供应商列表项：收起时为 H40/R12 的紧凑行；展开编辑时表单在行内，高度随内容增长。 */
function ProviderRow({
  provider,
  expanded,
  formId,
  onEdit,
  onDelete,
  children,
}: {
  provider: Provider
  expanded: boolean
  formId: string | undefined
  onEdit: () => void
  /** 打开删除确认。 */
  onDelete: () => void
  children: React.ReactNode
}) {
  const { t } = useI18n()
  return (
    <li
      data-provider-id={provider.id}
      data-protocol={provider.api}
      data-expanded={expanded || undefined}
      className={cn('flex shrink-0 flex-col rounded-md border-hairline border-card-stroke bg-background', expanded ? '' : 'h-10')}
    >
      <div className={cn('flex min-w-0 items-center justify-between gap-4 px-3', expanded ? 'min-h-10' : 'flex-1')}>
        <div className="flex min-w-0 items-center gap-2">
          <span data-user-content className="truncate text-ui-body font-medium" title={provider.name}>
            {provider.name}
          </span>
          <CredentialStatus provider={provider} />
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button data-provider-edit variant="outline" size="sm" aria-expanded={expanded} aria-controls={formId} onClick={onEdit}>
            {t('providers.edit')}
          </Button>
          <Button data-provider-delete variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={onDelete}>
            {t('providers.delete')}
          </Button>
        </div>
      </div>
      {expanded && (
        <div className="px-3 pb-3">
          <div className="rounded-lg border-hairline border-card-stroke bg-muted p-4">{children}</div>
        </div>
      )}
    </li>
  )
}

/** “放弃更改？”确认：默认焦点在“继续编辑”；Escape 或点击外部等同继续编辑。 */
function DiscardDialog({ open, onAnswer }: { open: boolean; onAnswer: (discard: boolean) => void }) {
  const { t } = useI18n()
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onAnswer(false)}>
      <DialogContent role="alertdialog" data-discard-dialog className="max-w-[400px] gap-3 p-5">
        <DialogTitle>{t('providers.discard.title')}</DialogTitle>
        <DialogDescription>{t('providers.discard.description')}</DialogDescription>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" onClick={() => onAnswer(false)}>
            {t('providers.discard.keep')}
          </Button>
          <Button variant="destructive" onClick={() => onAnswer(true)}>
            {t('providers.discard.confirm')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
