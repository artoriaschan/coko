import * as React from 'react'
import { Value } from 'typebox/value'
import { SessionBusyDetails } from '@coko/protocol'
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle } from '@coko/ui'
import { useChatStoreApi } from '../../app/chat.tsx'
import { useI18n } from '../../app/i18n.tsx'
import { ApiError } from '../../client/api.ts'

/** Reusable by sidebar, archive and search; the caller holds the selected identity until close. */
export function SessionDeleteDialog({
  sessionId,
  open,
  onOpenChange,
  onCloseAutoFocus,
}: {
  sessionId: string
  open: boolean
  onOpenChange(open: boolean): void
  onCloseAutoFocus?: (event: Event) => void
}) {
  const chat = useChatStoreApi()
  const { t } = useI18n()
  const cancel = React.useRef<HTMLButtonElement>(null)
  const submitting = React.useRef(false)
  const [pending, setPending] = React.useState(false)
  const [preview, setPreview] = React.useState<{ id: string; paths: string[]; failed?: boolean } | null>(null)
  const [previewRetry, setPreviewRetry] = React.useState(0)
  const [copied, setCopied] = React.useState<string | null>(null)
  const loading = open && preview?.id !== sessionId
  React.useEffect(() => {
    if (!open) return
    let active = true
    setPreview(null)
    setCopied(null)
    void chat
      .getState()
      .deletePreview(sessionId)
      .then(
        (value) => {
          if (active) setPreview({ id: sessionId, paths: value.retainedDirectories })
        },
        () => {
          if (active) setPreview({ id: sessionId, paths: [], failed: true })
        },
      )
    return () => {
      active = false
    }
  }, [chat, open, sessionId, previewRetry])
  const [error, setError] = React.useState<string | null>(null)
  React.useEffect(() => {
    if (open) setError(null)
  }, [open, sessionId])
  async function confirm() {
    if (submitting.current || loading || preview?.failed) return
    submitting.current = true
    setPending(true)
    setError(null)
    try {
      await chat.getState().deleteSession(sessionId)
      onOpenChange(false)
    } catch (failure) {
      if (failure instanceof ApiError && failure.code === 'session-busy' && Value.Check(SessionBusyDetails, failure.details)) {
        const keys = {
          run: 'sidebar.deleteBusyRun',
          agent: 'sidebar.deleteBusyAgent',
          job: 'sidebar.deleteBusyJob',
          schedule: 'sidebar.deleteBusySchedule',
        } as const
        setError(
          t('sidebar.deleteBusy', {
            reasons: failure.details.reasons.map((reason) => t(keys[reason])).join(', '),
            sessions: failure.details.sessions.map((session) => session.title || t('sidebar.untitled')).join(', '),
          }),
        )
      } else setError(t('sidebar.deleteFailed'))
    } finally {
      submitting.current = false
      setPending(false)
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!submitting.current) onOpenChange(value)
      }}
    >
      <DialogContent
        role="alertdialog"
        data-session-delete-dialog
        aria-busy={pending || loading}
        closeLabel={t('sidebar.deleteClose')}
        className="w-[480px] max-w-[calc(100vw-32px)] min-h-[184px] gap-3 p-6"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          cancel.current?.focus()
        }}
        onCloseAutoFocus={onCloseAutoFocus}
        onEscapeKeyDown={(event) => {
          if (submitting.current) event.preventDefault()
        }}
      >
        <DialogTitle className="pr-8 text-ui-heading">{t('sidebar.deleteTitle')}</DialogTitle>
        <DialogDescription>{t('sidebar.deleteDescription')}</DialogDescription>
        {preview?.id === sessionId && preview.paths.length > 0 && (
          <div className="min-h-0 space-y-2 overflow-y-auto" data-retained-directories>
            <p className="text-ui-body text-muted-foreground">{t('sidebar.deleteFilesRetained')}</p>
            {preview.paths.map((path) => (
              <div key={path} className="flex items-start gap-2 rounded-md bg-muted p-2">
                <p className="min-w-0 flex-1 break-all font-mono text-ui-caption select-text">{path}</p>
                <Button
                  size="sm"
                  variant="ghost"
                  className="shrink-0"
                  onClick={() => {
                    void navigator.clipboard.writeText(path).then(
                      () => setCopied(path),
                      () => setError(t('sidebar.deleteCopyFailed')),
                    )
                  }}
                >
                  {t(copied === path ? 'sidebar.deletePathCopied' : 'sidebar.deleteCopyPath')}
                </Button>
              </div>
            ))}
          </div>
        )}
        {preview?.id === sessionId && preview.failed && (
          <div className="space-y-2">
            <p role="alert" className="text-ui-body text-destructive">
              {t('sidebar.deletePreviewFailed')}
            </p>
            <Button size="sm" variant="secondary" onClick={() => setPreviewRetry((value) => value + 1)}>
              {t('sidebar.deletePreviewRetry')}
            </Button>
          </div>
        )}
        {error && (
          <p role="alert" className="text-ui-body text-destructive">
            {error}
          </p>
        )}
        <div className="mt-auto flex justify-end gap-2">
          <Button ref={cancel} variant="secondary" disabled={pending} onClick={() => onOpenChange(false)}>
            {t('sidebar.deleteCancel')}
          </Button>
          <Button
            variant="ghost"
            className="bg-destructive/10 text-destructive hover:bg-destructive/20"
            disabled={pending || loading || preview?.failed}
            onClick={() => void confirm()}
          >
            {t('sidebar.deleteConfirm')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
