import type { Schedule } from '@coko/protocol'
import { Button } from '@coko/ui'
import { ExternalLinkIcon } from 'lucide-react'
import * as React from 'react'
import { useChat, useChatActions } from '../../app/chat.tsx'
import { useI18n } from '../../app/i18n.tsx'
import { useSettingsPage } from '../../app/settings.tsx'
import { useAllSchedules, useSchedulesStoreApi } from '../conversation/schedules-button.tsx'
import { DeleteScheduleDialog, ScheduleRowActions, ScheduleSummary } from '../right-panel/schedules-tab.tsx'
import { SettingsCard } from './settings-page.tsx'

/**
 * 设置 → 定时任务（docs/subsystems/schedules.md#界面）：全部会话的任务，按会话分组；每项可打开所在会话（返回应用并切到右栏的 Schedules tab）、
 * 暂停 / 恢复与删除（确认）。新建与编辑在会话的 Schedules tab 中。
 */
export function SchedulesSection() {
  const { t } = useI18n()
  const store = useSchedulesStoreApi()
  const list = useAllSchedules()
  const sessions = useChat((s) => s.sessions)
  const [deleting, setDeleting] = React.useState<Schedule | null>(null)
  const groups = React.useMemo(() => {
    const bySession = new Map<string, Schedule[]>()
    for (const schedule of list?.schedules ?? []) bySession.set(schedule.sessionId, [...(bySession.get(schedule.sessionId) ?? []), schedule])
    return [...bySession]
  }, [list])

  let body: React.ReactNode
  if (!list || (list.status === 'loading' && groups.length === 0))
    body = (
      <SettingsCard aria-label={t('schedules.loading')} aria-busy className="flex flex-col gap-2 px-4 py-3">
        {[0, 1].map((i) => (
          <div key={i} aria-hidden className="h-12 rounded-md bg-skeleton" />
        ))}
      </SettingsCard>
    )
  else if (list.status === 'error' && groups.length === 0)
    body = (
      <SettingsCard className="flex items-center gap-2 px-4 py-3 text-ui-body text-muted-foreground">
        <p>{t('schedules.loadFailed')}</p>
        <Button variant="outline" size="sm" onClick={() => void store.getState().load()}>
          {t('schedules.retry')}
        </Button>
      </SettingsCard>
    )
  else if (groups.length === 0)
    body = (
      <SettingsCard>
        <p className="px-4 py-3 text-ui-body text-muted-foreground">{t('schedules.settingsEmpty')}</p>
      </SettingsCard>
    )
  else
    body = groups.map(([sessionId, schedules]) => {
      const session = sessions.find((s) => s.id === sessionId)
      const headingId = `settings-schedules-${sessionId}`
      return (
        <div key={sessionId} className="flex flex-col gap-2" data-schedule-session={sessionId}>
          <h3 id={headingId} data-user-content={session?.title ? '' : undefined} className="truncate text-ui-body font-medium">
            {session?.title || t('sidebar.untitled')}
          </h3>
          <SettingsCard>
            <ul aria-labelledby={headingId}>
              {schedules.map((schedule) => (
                <SettingsScheduleItem key={schedule.id} schedule={schedule} onDelete={() => setDeleting(schedule)} />
              ))}
            </ul>
          </SettingsCard>
        </div>
      )
    })

  return (
    <section aria-labelledby="settings-schedules" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="settings-schedules" className="text-ui-body-lg font-medium">
          {t('schedules.settings')}
        </h2>
        <p className="text-ui-small text-muted-foreground">{t('schedules.settingsDescription')}</p>
      </div>
      {body}
      <DeleteScheduleDialog key={deleting?.id} schedule={deleting} onClose={() => setDeleting(null)} />
    </section>
  )
}

function SettingsScheduleItem({ schedule, onDelete }: { schedule: Schedule; onDelete: () => void }) {
  const { t } = useI18n()
  const store = useSchedulesStoreApi()
  const { openSession } = useChatActions()
  const { back } = useSettingsPage()
  return (
    <li
      data-schedule-id={schedule.id}
      data-status={schedule.status}
      className="flex flex-wrap items-start gap-2 px-4 py-3 not-last:border-b-hairline not-last:border-border"
    >
      <ScheduleSummary schedule={schedule} />
      <div className="flex shrink-0 items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          data-action="open-schedule-session"
          aria-label={t('schedules.openSessionOf', { title: schedule.title })}
          onClick={() => {
            store.getState().requestOpen(schedule.sessionId)
            openSession(schedule.sessionId)
            back()
          }}
        >
          <ExternalLinkIcon />
          {t('schedules.openSession')}
        </Button>
        <ScheduleRowActions schedule={schedule} onDelete={onDelete} />
      </div>
    </li>
  )
}
