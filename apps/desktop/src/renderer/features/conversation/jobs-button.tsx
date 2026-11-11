import type { JobSnapshot, JobStatus, SessionEntry } from '@coko/protocol'
import type { Translator } from '@coko/i18n'
import { cn } from '@coko/ui'
import { IconTerminal2 } from '@tabler/icons-react'
import * as React from 'react'
import { useStore } from 'zustand'
import { useOptionalChatStoreApi } from '../../app/chat.tsx'
import { useI18n } from '../../app/i18n.tsx'
import { IconButton } from '../../app/icon-button.tsx'
import type { ChatStore } from '../../stores/chat-store.ts'
import { jobsStore, type JobsState, type JobsActions, type JobsStore, type SessionJobs } from '../../stores/jobs-store.ts'
import type { HeaderActionProps } from './header-actions.ts'

// 后台任务视图共用的接线：jobs store 的 context（测试可换成自己的 store）、按会话读取与订阅、状态点与时长格式，以及会话标题栏的按钮。

const JobsStoreContext = React.createContext<JobsStore>(jobsStore)

export function JobsStoreProvider({ store, children }: { store: JobsStore; children: React.ReactNode }) {
  return <JobsStoreContext.Provider value={store}>{children}</JobsStoreContext.Provider>
}

export const useJobsStoreApi = (): JobsStore => React.useContext(JobsStoreContext)

export function useJobs<T>(selector: (state: JobsState & JobsActions) => T): T {
  return useStore(useJobsStoreApi(), selector)
}

const EMPTY_ENTRIES: SessionEntry[] = []
const jobEntryCounts = new WeakMap<readonly SessionEntry[], number>()
/** 会话中 job_start 与 job_end 条目的数量：变化时（包括重连后补发）重新读取列表。 */
function jobEntryCount(entries: readonly SessionEntry[]): number {
  let count = jobEntryCounts.get(entries)
  if (count === undefined) {
    count = entries.reduce((n, e) => (e.kind === 'job_start' || e.kind === 'job_end' ? n + 1 : n), 0)
    jobEntryCounts.set(entries, count)
  }
  return count
}

/** chat store 不在 provider 之内（组件测试）时使用的空来源。 */
const noChat = { getState: () => undefined, subscribe: () => () => {} }

/**
 * 会话的 Job 列表：把 jobs store 接到对话 store 的 progress（job_update / job_output），打开会话与 job 条目数变化时重新读取。
 * 列表与输出都从接口恢复，不依赖已收到的 WS 帧。
 */
export function useSessionJobs(sessionId: string | null): SessionJobs | undefined {
  const jobs = useJobsStoreApi()
  const chat = useOptionalChatStoreApi()
  React.useEffect(() => (chat ? jobs.getState().attach(chat.getState()) : undefined), [chat, jobs])
  const marker = React.useSyncExternalStore((chat ?? noChat).subscribe, () =>
    jobEntryCount((sessionId === null ? undefined : (chat as ChatStore | null)?.getState().conversations[sessionId]?.entries) ?? EMPTY_ENTRIES),
  )
  React.useEffect(() => {
    if (sessionId !== null) void jobs.getState().load(sessionId)
  }, [jobs, sessionId, marker])
  return useStore(jobs, (s) => (sessionId === null ? undefined : s.sessions[sessionId]))
}

/** 每秒更新的当前时间（只在 active 时计时）：运行中的 Job 的时长。 */
export function useNow(active: boolean): number {
  const [now, setNow] = React.useState(() => Date.now())
  React.useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [active])
  return now
}

export const isJobActive = (job: Pick<JobSnapshot, 'status'>) => job.status === 'running' || job.status === 'stopping'

export function formatJobDuration(t: Translator, ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return t('jobs.duration.hours', { h, m })
  if (m > 0) return t('jobs.duration.minutes', { m, s })
  return t('jobs.duration.seconds', { s })
}

export const jobDuration = (job: Pick<JobSnapshot, 'startedAt' | 'endedAt'>, now: number) => (job.endedAt ?? now) - job.startedAt

/** 结束状态的补充：退出码或信号。 */
export function jobExitText(t: Translator, job: Pick<JobSnapshot, 'exitCode' | 'signal'>): string | undefined {
  if (job.exitCode !== undefined) return t('jobs.exitCode', { code: job.exitCode })
  if (job.signal !== undefined) return t('jobs.signal', { signal: job.signal })
  return undefined
}

/** 状态点：颜色之外另有无障碍名称（状态名）。 */
export function JobStatusDot({ status, className }: { status: JobStatus; className?: string }) {
  const { t } = useI18n()
  return (
    <span
      role="img"
      aria-label={t(`jobs.status.${status}`)}
      data-job-status={status}
      className={cn(
        'size-2 shrink-0 rounded-round',
        status === 'running' && 'bg-success',
        status === 'stopping' && 'bg-warning',
        status === 'completed' && 'bg-muted-foreground',
        (status === 'failed' || status === 'lost') && 'bg-destructive',
        status === 'killed' && 'bg-warning',
        className,
      )}
    />
  )
}

/**
 * 会话标题栏的"后台任务"按钮：会话有 Job 时显示，徽标为 running 与 stopping 的数量（没有时不显示徽标）；点击打开右栏的 Jobs tab。
 * Job chip 与通知行的打开请求（jobs store 的 openRequests）也经这里打开右栏。
 */
export function JobsButton({ sessionId, openTab }: HeaderActionProps) {
  const { t } = useI18n()
  const session = useSessionJobs(sessionId)
  const running = session?.jobs.filter(isJobActive).length ?? 0
  const request = useJobs((s) => s.openRequests[sessionId] ?? 0)
  const seen = React.useRef(request)
  React.useEffect(() => {
    if (request === seen.current) return
    seen.current = request
    openTab('jobs')
  }, [request, openTab])
  if (!session || session.jobs.length === 0) return null
  const label = running > 0 ? t('jobs.headerActionRunning', { count: running }) : t('jobs.headerAction')
  return (
    <IconButton label={label} data-action="open-jobs" data-running={running} className="relative" onClick={() => openTab('jobs')}>
      <IconTerminal2 aria-hidden />
      {running > 0 && (
        <span
          aria-hidden
          data-slot="jobs-badge"
          className="absolute -end-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-round bg-primary px-1 text-ui-caption font-medium text-primary-foreground"
        >
          {running}
        </span>
      )}
    </IconButton>
  )
}
