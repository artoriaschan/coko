import * as React from 'react'
import { Button } from '@coko/ui'
import { useChatStoreApi, useLists } from '../../app/chat.tsx'
import { useI18n } from '../../app/i18n.tsx'
import { useSettingsPage } from '../../app/settings.tsx'
import { SessionDeleteDialog } from '../sidebar/session-delete-dialog.tsx'
import { SettingsCard } from './settings-page.tsx'

export function ArchivedSection() {
  const chat = useChatStoreApi()
  const { t, locale } = useI18n()
  const { back } = useSettingsPage()
  const sessions = useLists((state) => state.archivedSessions)
  const projects = useLists((state) => state.projects)
  const [status, setStatus] = React.useState<'loading' | 'ready' | 'error'>('loading')
  const [deleting, setDeleting] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState<string | null>(null)
  const [error, setError] = React.useState(false)
  const load = React.useCallback(async () => {
    setStatus('loading')
    try {
      await chat.lists.getState().loadArchived()
      setStatus('ready')
    } catch {
      setStatus('error')
    }
  }, [chat])
  React.useEffect(() => {
    void load()
  }, [load])
  return (
    <section aria-labelledby="settings-archived" className="flex flex-col gap-4">
      <h2 id="settings-archived" className="text-ui-body-lg font-medium">
        {t('sidebar.archivedConversations')}
      </h2>
      {status === 'loading' && <SettingsCard aria-busy className="h-16 bg-skeleton" />}
      {status === 'error' && (
        <SettingsCard className="flex items-center gap-3 px-4 py-3">
          <p role="alert">{t('sidebar.archiveLoadFailed')}</p>
          <Button variant="outline" onClick={() => void load()}>
            {t('sidebar.archiveRetry')}
          </Button>
        </SettingsCard>
      )}
      {error && (
        <p role="alert" className="text-ui-body text-destructive">
          {t('sidebar.restoreFailed')}
        </p>
      )}
      {status === 'ready' && (
        <SettingsCard>
          {sessions.length === 0 ? (
            <p className="px-4 py-3 text-ui-body text-muted-foreground">{t('sidebar.archiveEmpty')}</p>
          ) : (
            <ul>
              {sessions
                .toSorted((a, b) => b.archivedAt! - a.archivedAt!)
                .map((session) => (
                  <li
                    key={session.id}
                    data-archived-session={session.id}
                    className="flex flex-wrap items-center gap-3 px-4 py-3 not-last:border-b-hairline not-last:border-border"
                  >
                    <div className="min-w-0 flex-1">
                      <p data-user-content className="break-words text-ui-body font-medium">
                        {session.title || t('sidebar.untitled')}
                      </p>
                      <p className="text-ui-small text-muted-foreground">
                        <span data-user-content>{projects.find((project) => project.id === session.projectId)?.name ?? t('sidebar.conversations')}</span> ·{' '}
                        <time dateTime={new Date(session.archivedAt!).toISOString()}>
                          {new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(session.archivedAt!)}
                        </time>
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={pending !== null}
                        onClick={() => {
                          chat.getState().openSession(session.id)
                          back()
                        }}
                      >
                        {t('sidebar.openArchived')}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={pending !== null}
                        onClick={() => {
                          setPending(session.id)
                          setError(false)
                          void chat
                            .getState()
                            .restoreSession(session.id)
                            .catch(() => setError(true))
                            .finally(() => setPending(null))
                        }}
                      >
                        {t('sidebar.restore')}
                      </Button>
                      <Button variant="ghost" size="sm" disabled={pending !== null} onClick={() => setDeleting(session.id)}>
                        {t('sidebar.deleteConfirm')}
                      </Button>
                    </div>
                  </li>
                ))}
            </ul>
          )}
        </SettingsCard>
      )}
      {deleting && (
        <SessionDeleteDialog
          sessionId={deleting}
          open
          onOpenChange={(open) => {
            if (!open) setDeleting(null)
          }}
        />
      )}
    </section>
  )
}
