import * as React from 'react'
import { SessionBusyDetails } from '@coko/protocol'
import { Value } from 'typebox/value'
import { DropdownMenuItem, toast } from '@coko/ui'
import { IconArchive } from '@tabler/icons-react'
import { useChatStoreApi } from '../../app/chat.tsx'
import { useI18n } from '../../app/i18n.tsx'
import { ApiError } from '../../client/api.ts'
import { SessionMenuIcon } from './session-menu.tsx'

/** Shared by ordinary rows and search; closes its caller before the mutation. */
export function SessionArchiveMenuItem({
  sessionId,
  onSelect,
  onPendingChange,
}: {
  sessionId: string
  onSelect?(): void
  onPendingChange?(pending: boolean): void
}) {
  const chat = useChatStoreApi()
  const { t } = useI18n()
  const [pending, setPending] = React.useState(false)
  return (
    <DropdownMenuItem
      disabled={pending}
      onSelect={() => {
        onSelect?.()
        setPending(true)
        onPendingChange?.(true)
        void chat
          .getState()
          .archiveSession(sessionId)
          .catch((error: unknown) => {
            if (error instanceof ApiError && error.code === 'session-busy' && Value.Check(SessionBusyDetails, error.details)) {
              const keys = {
                run: 'sidebar.deleteBusyRun',
                agent: 'sidebar.deleteBusyAgent',
                job: 'sidebar.deleteBusyJob',
                schedule: 'sidebar.deleteBusySchedule',
              } as const
              toast.error(
                t('sidebar.archiveBusy', {
                  reasons: error.details.reasons.map((reason) => t(keys[reason])).join(', '),
                  sessions: error.details.sessions.map((item) => item.title || t('sidebar.untitled')).join(', '),
                }),
              )
            } else toast.error(t('sidebar.archiveFailed'))
          })
          .finally(() => {
            setPending(false)
            onPendingChange?.(false)
          })
      }}
    >
      <SessionMenuIcon>
        <IconArchive aria-hidden className="size-3.5" stroke={1.1} />
      </SessionMenuIcon>
      {t('sidebar.archiveConversation')}
    </DropdownMenuItem>
  )
}
