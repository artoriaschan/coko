import * as React from 'react'
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle } from '@coko/ui'
import { useChatStoreApi } from '../../app/chat.tsx'
import { useI18n } from '../../app/i18n.tsx'
import { ApiError } from '../../client/api.ts'

type Removal = { projectId: string; restoreFocus(): void }
const ProjectDeleteContext = React.createContext<((request: Removal) => void) | null>(null)
export const useDeleteProject = () => React.useContext(ProjectDeleteContext)

/** Lives outside individual project rows so sorting, pinning and list refresh cannot retarget confirmation. */
export function ProjectDeleteProvider({ children }: { children: React.ReactNode }) {
  const [request, setRequest] = React.useState<Removal | null>(null)
  return (
    <ProjectDeleteContext.Provider value={setRequest}>
      {children}
      {request && (
        <ProjectDeleteDialog
          projectId={request.projectId}
          onClose={() => setRequest(null)}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            request.restoreFocus()
          }}
        />
      )}
    </ProjectDeleteContext.Provider>
  )
}

/** The caller keeps the selected Project identity stable while this confirmation is open. */
export function ProjectDeleteDialog({ projectId, onClose, onCloseAutoFocus }: { projectId: string; onClose(): void; onCloseAutoFocus(event: Event): void }) {
  const chat = useChatStoreApi()
  const { t } = useI18n()
  const cancel = React.useRef<HTMLButtonElement>(null)
  const submitting = React.useRef(false)
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  async function confirm() {
    if (submitting.current) return
    submitting.current = true
    setPending(true)
    setError(null)
    try {
      await chat.getState().deleteProject(projectId)
      onClose()
    } catch (failure) {
      setError(t(failure instanceof ApiError && failure.details?.reason === 'stop-failed' ? 'sidebar.deleteProjectStopFailed' : 'sidebar.deleteProjectFailed'))
    } finally {
      submitting.current = false
      setPending(false)
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !submitting.current) onClose()
      }}
    >
      <DialogContent
        role="alertdialog"
        data-project-delete-dialog
        aria-busy={pending}
        closeLabel={t('sidebar.deleteClose')}
        className="w-[480px] max-w-[calc(100vw-32px)] min-h-[208px] gap-3 p-6"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          cancel.current?.focus()
        }}
        onCloseAutoFocus={onCloseAutoFocus}
        onEscapeKeyDown={(event) => {
          if (submitting.current) event.preventDefault()
        }}
        onPointerDownOutside={(event) => event.preventDefault()}
      >
        <DialogTitle className="pr-8 text-ui-heading">{t('sidebar.deleteProjectTitle')}</DialogTitle>
        <DialogDescription>{t('sidebar.deleteProjectDescription')}</DialogDescription>
        {error && (
          <p role="alert" className="text-ui-body text-destructive">
            {error}
          </p>
        )}
        <div className="mt-auto flex justify-end gap-2">
          <Button ref={cancel} variant="ghost" className="text-muted-foreground" disabled={pending} onClick={onClose}>
            {t('sidebar.deleteCancel')}
          </Button>
          <Button variant="ghost" className="bg-destructive/10 text-destructive hover:bg-destructive/20" disabled={pending} onClick={() => void confirm()}>
            {t('sidebar.deleteConfirm')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
