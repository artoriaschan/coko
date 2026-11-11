import type { TimelineRootAttributes } from './timeline-projection.ts'
import type { SessionEntry } from '@coko/protocol'
import * as React from 'react'
import { IconBell, IconTerminal2 } from '@tabler/icons-react'
import { useOptionalChatStoreApi } from '../../app/chat.tsx'
import { JobOutputView } from '../right-panel/jobs-tab.tsx'
import { useI18n } from '../../app/i18n.tsx'
import { jobExitText, JobStatusDot, useJobs, useJobsStoreApi } from './jobs-button.tsx'
import type { TimelineItem } from './timeline.ts'

import { useTimelineSession } from './timeline-session.tsx'

/** Existing output reader, without execution controls, for child Sessions and historical snapshots. */
function InlineJobOutput({ jobId, label }: { jobId: string; label: string }) {
  const { t } = useI18n()
  const store = useJobsStoreApi()
  const output = useJobs((s) => s.outputs[jobId])
  React.useEffect(() => {
    void store.getState().watchOutput(jobId)
  }, [store, jobId])
  return (
    <div data-slot="job-inline-output" className="conversation-business-card conversation-job-output">
      {!output || output.status === 'loading' ? (
        <p role="status">{t('jobs.output.loading')}</p>
      ) : output.status === 'error' ? (
        <>
          <p>{t('jobs.output.failed')}</p>
          <button type="button" className="focus-ring" onClick={() => void store.getState().watchOutput(jobId)}>
            {t('jobs.retry')}
          </button>
        </>
      ) : (
        <JobOutputView
          label={label}
          text={output.text}
          earlier={output.start > 0 ? { loading: output.loadingEarlier, onLoad: () => void store.getState().loadEarlier(jobId) } : undefined}
        />
      )}
    </div>
  )
}

function useInlineJobInspection() {
  const { sessionId, historical, readOnly } = useTimelineSession()
  const chat = useOptionalChatStoreApi()?.getState()
  return historical || readOnly || sessionId !== chat?.activeSessionId
}

/** Job 的标签与结束状态：先看 jobs store 的快照，没有时从会话条目（job_start、job_end）得出。 */
function useJobInfo(jobId: string, sessionId: string | null, entries: readonly SessionEntry[]) {
  const snapshot = useJobs((s) => (sessionId === null ? undefined : s.sessions[sessionId]?.jobs.find((job) => job.jobId === jobId)))
  if (snapshot) return snapshot
  const start = entries.find((e): e is Extract<SessionEntry, { kind: 'job_start' }> => e.kind === 'job_start' && e.payload.jobId === jobId)
  const end = entries.find((e): e is Extract<SessionEntry, { kind: 'job_end' }> => e.kind === 'job_end' && e.payload.jobId === jobId)
  return {
    label: start?.payload.label ?? jobId,
    status: end?.payload.status ?? (start ? ('running' as const) : undefined),
    ...(end?.payload.exitCode === undefined ? {} : { exitCode: end.payload.exitCode }),
    ...(end?.payload.signal === undefined ? {} : { signal: end.payload.signal }),
  }
}

/** 后台 bash 工具卡上的 Job chip：状态点与标签；点击在右栏的 Jobs tab 打开该 Job。 */
export function JobChip({ jobId }: { jobId: string }) {
  const { t } = useI18n()
  const jobs = useJobsStoreApi()
  const { sessionId, entries } = useTimelineSession()
  const job = useJobInfo(jobId, sessionId, entries)
  const inline = useInlineJobInspection()
  const [expanded, setExpanded] = React.useState(false)
  return (
    <>
      <button
        type="button"
        data-slot="job-chip"
        data-job-id={jobId}
        aria-label={t('jobs.chip', { label: job.label })}
        disabled={sessionId === null}
        className="flex h-6 max-w-full min-w-0 items-center gap-1.5 rounded-sm border-hairline border-border px-2 text-ui-small focus-ring [@media(hover:hover)]:hover:bg-accent"
        aria-expanded={inline ? expanded : undefined}
        onClick={() => {
          if (sessionId !== null) {
            if (inline) {
              jobs.getState().select(sessionId, jobId)
              setExpanded((open) => !open)
            } else jobs.getState().open(sessionId, jobId)
          }
        }}
      >
        <IconTerminal2 aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        {job.status && <JobStatusDot status={job.status} />}
        <span data-user-content className="truncate font-mono">
          {job.label}
        </span>
      </button>
      {inline && expanded && <InlineJobOutput jobId={jobId} label={job.label} />}
    </>
  )
}

function NotifiedJob({ jobId, sessionId, entries }: { jobId: string; sessionId: string | null; entries: readonly SessionEntry[] }) {
  const { t } = useI18n()
  const jobs = useJobsStoreApi()
  const job = useJobInfo(jobId, sessionId, entries)
  const exit = jobExitText(t, job)
  const inline = useInlineJobInspection()
  const [expanded, setExpanded] = React.useState(false)
  return (
    <li className="flex min-w-0 flex-wrap items-center gap-1.5">
      {job.status && <JobStatusDot status={job.status} />}
      <button
        type="button"
        data-action="open-job"
        data-job-id={jobId}
        aria-label={t('jobs.chip', { label: job.label })}
        disabled={sessionId === null}
        className="min-w-0 truncate rounded-sm font-mono text-ui-small text-foreground focus-ring [@media(hover:hover)]:hover:underline"
        aria-expanded={inline ? expanded : undefined}
        onClick={() => {
          if (sessionId !== null) {
            if (inline) {
              jobs.getState().select(sessionId, jobId)
              setExpanded((open) => !open)
            } else jobs.getState().open(sessionId, jobId)
          }
        }}
      >
        <span data-user-content>{job.label}</span>
      </button>
      <span className="text-ui-small">{[job.status ? t(`jobs.status.${job.status}`) : undefined, exit].filter(Boolean).join(' · ')}</span>
      {inline && expanded && <InlineJobOutput jobId={jobId} label={job.label} />}
    </li>
  )
}

/**
 * 时间线的后台任务行：job_notification 为紧凑行（"后台任务已结束"与每个 Job 的状态，点击打开）；job_start 由工具卡的 Job chip 表示，
 * job_end 反映在通知行与 chip 的状态上，不单独成行。
 */
export function JobRow({ item, rootAttributes }: { item: Extract<TimelineItem, { kind: 'job' }>; rootAttributes?: TimelineRootAttributes }) {
  const { t } = useI18n()
  const { sessionId, entries } = useTimelineSession()
  if (item.job.kind !== 'notification') return null
  return (
    <div {...rootAttributes} data-slot="job-notification" className="flex min-w-0 items-start gap-1.5 conversation-business-row text-muted-foreground">
      <IconBell aria-hidden className="mt-0.5 size-4 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-0.5">
        <span className="shrink-0">{t('jobs.notification')}</span>
        <ul className="flex min-w-0 flex-col">
          {item.job.payload.jobIds.map((jobId) => (
            <NotifiedJob key={jobId} jobId={jobId} sessionId={sessionId} entries={entries} />
          ))}
        </ul>
      </div>
    </div>
  )
}
