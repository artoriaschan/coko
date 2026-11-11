import type { Provider } from '@coko/protocol'
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle, toast } from '@coko/ui'
import { IconLoader2 } from '@tabler/icons-react'
import * as React from 'react'
import { useI18n } from '../../app/i18n.tsx'
import { useSettingsActions } from '../../app/settings.tsx'

/** 一次删除确认；opened 每次打开递增，作为对话框的 key。关闭时保留请求只清 open，关闭动画照常进行。 */
export interface DeleteProviderRequest {
  provider: Provider
  /** 该 Provider 在列表中的位置；删除后焦点移到同一位置的列表项。 */
  index: number
  opened: number
  open: boolean
}

type References = { status: 'loading' } | { status: 'ready'; sessions: number } | { status: 'error' }

/**
 * 删除供应商的二次确认：写明引用它的 Session 数量（打开时向 Sidecar 读取）；数量未知时不能确认。确认后删除 Provider 与其 Credential，
 * 引用它的 Session 模型字段被清空。取消、Escape 或点击外部不做任何修改。关闭后焦点交给 focusAfterClose 给出的元素（取消时为
 * 该项的“删除”，删除后为同一位置的列表项），不落到 body。
 */
export function DeleteProviderDialog({
  request,
  onClose,
  focusAfterClose,
}: {
  request: DeleteProviderRequest | null
  onClose: () => void
  focusAfterClose: (request: DeleteProviderRequest, deleted: boolean) => HTMLElement | null
}) {
  const { t } = useI18n()
  const { providerReferences, deleteProvider } = useSettingsActions()
  const [references, setReferences] = React.useState<References>({ status: 'loading' })
  const [deleting, setDeleting] = React.useState(false)
  const deleted = React.useRef(false)
  const reads = React.useRef(0)
  const id = request?.provider.id
  const open = request?.open ?? false

  const count = React.useCallback(async () => {
    if (id === undefined) return
    const read = ++reads.current
    setReferences({ status: 'loading' })
    try {
      const { sessions } = await providerReferences(id)
      if (read === reads.current) setReferences({ status: 'ready', sessions })
    } catch {
      if (read === reads.current) setReferences({ status: 'error' })
    }
  }, [id, providerReferences])

  React.useEffect(() => {
    if (open) void count()
  }, [open, count])

  const confirm = async () => {
    if (id === undefined) return
    setDeleting(true)
    const ok = await deleteProvider(id)
    setDeleting(false)
    if (!ok) {
      toast.error(t('providers.deleteFailed'))
      return
    }
    deleted.current = true
    toast.success(t('providers.deleted'))
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !deleting && onClose()}>
      <DialogContent
        role="alertdialog"
        data-delete-provider-dialog
        className="max-w-[400px] gap-3 p-5"
        onCloseAutoFocus={(event) => {
          if (!request) return
          const target = focusAfterClose(request, deleted.current)
          if (!target) return
          event.preventDefault()
          target.focus()
        }}
      >
        <DialogTitle data-user-content>{request && t('providers.deleteDialog.title', { name: request.provider.name })}</DialogTitle>
        <DialogDescription>{t('providers.deleteDialog.description')}</DialogDescription>
        <div aria-live="polite" data-provider-references={references.status} className="flex min-h-8 items-center gap-2 text-ui-body">
          {references.status === 'loading' && (
            <>
              <IconLoader2 aria-hidden className="size-4 animate-spin text-muted-foreground motion-reduce:animate-none" />
              <span className="text-muted-foreground">{t('providers.deleteDialog.counting')}</span>
            </>
          )}
          {references.status === 'ready' && (
            <p>
              {references.sessions === 0
                ? t('providers.deleteDialog.noReferences')
                : t('providers.deleteDialog.references', { count: String(references.sessions) })}
            </p>
          )}
          {references.status === 'error' && (
            <>
              <p className="min-w-0 flex-1 text-destructive">{t('providers.deleteDialog.referencesFailed')}</p>
              <Button variant="outline" size="sm" onClick={() => void count()}>
                {t('settings.retry')}
              </Button>
            </>
          )}
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" disabled={deleting} onClick={onClose}>
            {t('providers.cancel')}
          </Button>
          <Button variant="destructive" disabled={references.status !== 'ready' || deleting} onClick={() => void confirm()}>
            {deleting && <IconLoader2 aria-hidden className="animate-spin motion-reduce:animate-none" />}
            {t('providers.delete')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
