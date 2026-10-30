import type { SessionEntry } from '@coko/protocol'
import { BellIcon, SquareTerminalIcon } from 'lucide-react'
import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'
import { useOptionalChatStoreApi } from '../../app/chat.tsx'
import { useI18n } from '../../app/i18n.tsx'
import type { ChatState } from '../../stores/chat-store.ts'
import { jobExitText, JobStatusDot, useJobs, useJobsStoreApi } from './jobs-button.tsx'
import type { TimelineItem } from './timeline.ts'

const EMPTY: SessionEntry[] = []
/** 不在对话 store 之内（组件测试）时使用的空 store。 */
const noChat = createStore<Pick<ChatState, 'activeSessionId' | 'conversations'>>()(() => ({ activeSessionId: null, conversations: {} }))

function useActiveSession() {
  const chat = useOptionalChatStoreApi() ?? noChat
  const sessionId = useStore(chat, (s) => s.activeSessionId)
  const entries = useStore(chat, (s) => (s.activeSessionId === null ? EMPTY : (s.conversations[s.activeSessionId]?.entries ?? EMPTY)))
  return { sessionId, entries }
}

/** Job 的标签与结束状态：先看 jobs store 的快照，没有时从会话条目（job_start、job_end）得出。 */
function useJobInfo(jobId: string, entries: readonly SessionEntry[]) {
  const snapshot = useJobs((s) => {
    for (const session of Object.values(s.sessions)) {
      const job = session.jobs.find((j) => j.jobId === jobId)
      if (job) return job
    }
    return undefined
  })
  if (snapshot) return snapshot
  const start = entries.find((e): e is Extract<SessionEntry, { kind: 'job_start' }> => e.kind === 'job_start' && e.payload.jobId === jobId)
  const end = entries.find((e): e is Extract<SessionEntry, { kind: 'job_end' }> => e.kind === 'job_end' && e.payload.jobId === jobId)
  return {
    label: start?.payload.label ?? jobId,
    status: end?.payload.status ?? ('running' as const),
    ...(end?.payload.exitCode === undefined ? {} : { exitCode: end.payload.exitCode }),
    ...(end?.payload.signal === undefined ? {} : { signal: end.payload.signal }),
  }
}

/** 后台 bash 工具卡上的 Job chip：状态点与标签；点击在右栏的 Jobs tab 打开该 Job。 */
export function JobChip({ jobId }: { jobId: string }) {
  const { t } = useI18n()
  const jobs = useJobsStoreApi()
  const { sessionId, entries } = useActiveSession()
  const job = useJobInfo(jobId, entries)
  return (
    <button
      type="button"
      data-slot="job-chip"
      data-job-id={jobId}
      aria-label={t('jobs.chip', { label: job.label })}
      disabled={sessionId === null}
      className="flex h-6 max-w-full min-w-0 items-center gap-1.5 rounded-sm border-hairline border-border px-2 text-ui-small focus-ring [@media(hover:hover)]:hover:bg-accent"
      onClick={() => sessionId !== null && jobs.getState().open(sessionId, jobId)}
    >
      <SquareTerminalIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      <JobStatusDot status={job.status} />
      <span data-user-content className="truncate font-mono">
        {job.label}
      </span>
    </button>
  )
}

function NotifiedJob({ jobId, sessionId, entries }: { jobId: string; sessionId: string | null; entries: readonly SessionEntry[] }) {
  const { t } = useI18n()
  const jobs = useJobsStoreApi()
  const job = useJobInfo(jobId, entries)
  const exit = jobExitText(t, job)
  return (
    <li className="flex min-w-0 items-center gap-1.5">
      <JobStatusDot status={job.status} />
      <button
        type="button"
        data-action="open-job"
        data-job-id={jobId}
        aria-label={t('jobs.chip', { label: job.label })}
        disabled={sessionId === null}
        className="min-w-0 truncate rounded-sm font-mono text-ui-small text-foreground focus-ring [@media(hover:hover)]:hover:underline"
        onClick={() => sessionId !== null && jobs.getState().open(sessionId, jobId)}
      >
        <span data-user-content>{job.label}</span>
      </button>
      <span className="shrink-0 text-ui-small">{[t(`jobs.status.${job.status}`), exit].filter(Boolean).join(' · ')}</span>
    </li>
  )
}

/**
 * 时间线的后台任务行：job_notification 为紧凑行（"后台任务已结束"与每个 Job 的状态，点击打开）；job_start 由工具卡的 Job chip 表示，
 * job_end 反映在通知行与 chip 的状态上，不单独成行。
 */
export function JobRow({ item }: { item: Extract<TimelineItem, { kind: 'job' }> }) {
  const { t } = useI18n()
  const { sessionId, entries } = useActiveSession()
  if (item.job.kind !== 'notification') return null
  return (
    <div data-slot="job-notification" className="flex min-w-0 items-start gap-2 text-ui-body text-muted-foreground">
      <BellIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
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
