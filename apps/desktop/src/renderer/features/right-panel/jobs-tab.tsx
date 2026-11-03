import type { JobSnapshot } from '@coko/protocol'
import { Button, cn, toast } from '@coko/ui'
import Anser from 'anser'
import { ArrowDownToLineIcon, LoaderCircleIcon, SquareIcon } from 'lucide-react'
import * as React from 'react'
import { useI18n } from '../../app/i18n.tsx'
import {
  formatJobDuration,
  isJobActive,
  jobDuration,
  jobExitText,
  JobStatusDot,
  useJobs,
  useJobsStoreApi,
  useNow,
  useSessionJobs,
} from '../conversation/jobs-button.tsx'
import type { RightPanelTabProps } from './tabs.ts'

// 右栏 Jobs tab：会话的后台任务列表（状态点、标签、时长、退出码）与选中项的输出（anser 解析 SGR，映射到语义色；局部横向滚动；跟随尾部；停止）。

/** anser 的颜色类 → 终端语义色（两套主题下对比度 ≥ 4.5:1）。256 色与 truecolor 没有对应 token，按默认前景显示。 */
const FG: Record<string, string> = {
  'ansi-black': 'text-terminal-muted',
  'ansi-bright-black': 'text-terminal-muted',
  'ansi-red': 'text-terminal-red',
  'ansi-bright-red': 'text-terminal-red',
  'ansi-green': 'text-terminal-green',
  'ansi-bright-green': 'text-terminal-green',
  'ansi-yellow': 'text-terminal-yellow',
  'ansi-bright-yellow': 'text-terminal-yellow',
  'ansi-blue': 'text-terminal-blue',
  'ansi-bright-blue': 'text-terminal-blue',
  'ansi-magenta': 'text-terminal-magenta',
  'ansi-bright-magenta': 'text-terminal-magenta',
  'ansi-cyan': 'text-terminal-cyan',
  'ansi-bright-cyan': 'text-terminal-cyan',
}
const BG: Record<string, string> = {
  'ansi-red': 'bg-diff-deleted',
  'ansi-bright-red': 'bg-diff-deleted',
  'ansi-green': 'bg-diff-added',
  'ansi-bright-green': 'bg-diff-added',
}
const DECORATIONS: Record<string, string> = {
  bold: 'font-medium',
  dim: 'opacity-70',
  italic: 'italic',
  underline: 'underline',
  strikethrough: 'line-through',
  hidden: 'invisible',
  reverse: 'bg-foreground text-background',
}

// OSC（标题、超链接）与 SGR 之外不显示的 C0 控制字符；anser 不处理 OSC。
// eslint-disable-next-line no-control-regex
const OSC = /\u001B\][^\u0007\u001B]*(?:\u0007|\u001B\\)?/g
// eslint-disable-next-line no-control-regex
const C0 = /[\u0000-\u0008\u000B\u000C\u000E-\u001A\u001C-\u001F\u007F]/g

/** 显示用的文本：CRLF 为换行；行内的 \r（进度条）只保留最后一次覆盖之后的内容。 */
function displayText(text: string): string {
  return text
    .replace(OSC, '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => {
      const at = line.lastIndexOf('\r')
      return at < 0 ? line : line.slice(at + 1)
    })
    .join('\n')
    .replace(C0, '')
}

const BLOCK_LINES = 200

/** 输出按 200 行一块解析与渲染：追加时只有最后一块重新解析。SGR 状态不跨块延续（块首按默认样式）。 */
function splitBlocks(text: string): string[] {
  const lines = text.split('\n')
  const blocks: string[] = []
  for (let i = 0; i < lines.length; i += BLOCK_LINES) blocks.push(lines.slice(i, i + BLOCK_LINES).join('\n') + (i + BLOCK_LINES < lines.length ? '\n' : ''))
  return blocks
}

const AnsiBlock = React.memo(function AnsiBlock({ text }: { text: string }) {
  const parts = React.useMemo(() => Anser.ansiToJson(displayText(text), { use_classes: true, remove_empty: true }), [text])
  return (
    <>
      {parts.map((part, i) => {
        const className = cn(part.fg && FG[part.fg], part.bg && BG[part.bg], ...part.decorations.map((d) => DECORATIONS[d]))
        return className === '' ? (
          <React.Fragment key={i}>{part.content}</React.Fragment>
        ) : (
          <span key={i} className={className}>
            {part.content}
          </span>
        )
      })}
    </>
  )
})

export interface JobOutputViewProps {
  /** Job 的标签（无障碍名称用）。 */
  label: string
  text: string
  /** 窗口之前还有输出：顶部显示"加载更早的输出"。 */
  earlier?: { loading: boolean; onLoad: () => void } | undefined
  /** 日志被截断（64 MiB）。 */
  truncated?: boolean
}

/**
 * Job 的输出：等宽、不换行、在本区域内横向与纵向滚动（不撑开面板）。贴底时跟随新输出；用户上滚后暂停，并显示"跟随最新输出"按钮。
 */
export function JobOutputView({ label, text, earlier, truncated }: JobOutputViewProps) {
  const { t } = useI18n()
  const ref = React.useRef<HTMLPreElement>(null)
  const [following, setFollowing] = React.useState(true)
  const followingRef = React.useRef(true)
  const blocks = React.useMemo(() => splitBlocks(text), [text])
  React.useLayoutEffect(() => {
    const el = ref.current
    if (el && followingRef.current) el.scrollTop = el.scrollHeight
  }, [text])
  const follow = () => {
    followingRef.current = true
    setFollowing(true)
    const el = ref.current
    if (el) el.scrollTop = el.scrollHeight
  }
  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      <pre
        ref={ref}
        role="log"
        aria-live="off"
        aria-label={t('jobs.output.label', { label })}
        tabIndex={0}
        data-slot="job-output"
        data-user-content
        className="min-h-0 min-w-0 flex-1 overflow-auto px-3 py-2 font-mono text-ui-small whitespace-pre focus-ring"
        onScroll={(event) => {
          const el = event.currentTarget
          const pinned = el.scrollHeight - el.scrollTop - el.clientHeight < 8
          if (pinned !== followingRef.current) {
            followingRef.current = pinned
            setFollowing(pinned)
          }
        }}
      >
        {earlier && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-action="load-earlier"
            disabled={earlier.loading}
            className="mb-1 font-sans"
            onClick={earlier.onLoad}
          >
            {earlier.loading && <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" />}
            {t('jobs.output.earlier')}
          </Button>
        )}
        {text === '' ? (
          <span className="font-sans text-muted-foreground">{t('jobs.output.empty')}</span>
        ) : (
          blocks.map((block, i) => <AnsiBlock key={i} text={block} />)
        )}
        {truncated && <span className="block font-sans text-warning-text">{t('jobs.output.truncated')}</span>}
      </pre>
      {!following && (
        <Button type="button" variant="outline" size="sm" data-action="follow-tail" className="absolute end-3 bottom-2 shadow-soft" onClick={follow}>
          <ArrowDownToLineIcon />
          {t('jobs.output.followTail')}
        </Button>
      )}
    </div>
  )
}

function JobListItem({ job, selected, now, onSelect }: { job: JobSnapshot; selected: boolean; now: number; onSelect: () => void }) {
  const { t } = useI18n()
  const exit = jobExitText(t, job)
  return (
    <li>
      <button
        type="button"
        data-job-id={job.jobId}
        data-status={job.status}
        aria-current={selected || undefined}
        className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-start focus-ring aria-current:bg-accent [@media(hover:hover)]:hover:bg-accent"
        onClick={onSelect}
      >
        <JobStatusDot status={job.status} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span data-user-content className="truncate font-mono text-ui-small" title={job.label}>
            {job.label}
          </span>
          <span className="truncate text-ui-small text-muted-foreground">
            {[t(`jobs.status.${job.status}`), formatJobDuration(t, jobDuration(job, now)), exit].filter(Boolean).join(' · ')}
          </span>
        </span>
      </button>
    </li>
  )
}

function JobDetail({ sessionId, job }: { sessionId: string; job: JobSnapshot }) {
  const { t } = useI18n()
  const store = useJobsStoreApi()
  const output = useJobs((s) => s.outputs[job.jobId])
  const [stopping, setStopping] = React.useState(false)
  React.useEffect(() => {
    void store.getState().watchOutput(job.jobId)
  }, [store, job.jobId])
  React.useEffect(() => {
    if (!isJobActive(job)) setStopping(false)
  }, [job])
  const stop = async () => {
    setStopping(true)
    try {
      await store.getState().kill(sessionId, job.jobId)
    } catch (error) {
      setStopping(false)
      toast.error(t('jobs.stopFailed', { message: error instanceof Error ? error.message : String(error) }))
    }
  }
  const pending = stopping || job.status === 'stopping'
  return (
    <section
      data-slot="job-detail"
      data-job-id={job.jobId}
      data-status={job.status}
      aria-label={job.label}
      className="flex min-h-0 min-w-0 flex-1 flex-col border-t-hairline border-border"
    >
      <div className="flex min-w-0 shrink-0 items-center gap-2 px-3 py-2">
        <JobStatusDot status={job.status} />
        <span data-user-content className="min-w-0 flex-1 truncate font-mono text-ui-small" title={job.command}>
          {job.command}
        </span>
        {job.status === 'running' || job.status === 'stopping' ? (
          <Button type="button" variant="outline" size="sm" data-action="stop-job" disabled={pending} onClick={() => void stop()}>
            {pending ? <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" /> : <SquareIcon />}
            {pending ? t('jobs.stopping') : t('jobs.stop')}
          </Button>
        ) : (
          <span className="shrink-0 text-ui-small text-muted-foreground">
            {[t(`jobs.status.${job.status}`), jobExitText(t, job)].filter(Boolean).join(' · ')}
          </span>
        )}
      </div>
      {!output || output.status === 'loading' ? (
        <div className="flex flex-1 items-center justify-center" aria-label={t('jobs.output.loading')}>
          <LoaderCircleIcon aria-hidden className="size-5 animate-spin text-muted-foreground motion-reduce:animate-none" />
        </div>
      ) : output.status === 'error' ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-4 text-center text-ui-body text-muted-foreground">
          <p>{t('jobs.output.failed')}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => void store.getState().watchOutput(job.jobId)}>
            {t('jobs.retry')}
          </Button>
        </div>
      ) : (
        <JobOutputView
          label={job.label}
          text={output.text}
          truncated={job.truncated && output.done}
          earlier={output.start > 0 ? { loading: output.loadingEarlier, onLoad: () => void store.getState().loadEarlier(job.jobId) } : undefined}
        />
      )}
    </section>
  )
}

/** 选中项缺省：最近启动的运行中 Job，否则最近启动的。 */
const defaultJob = (jobs: JobSnapshot[]) => jobs.findLast(isJobActive) ?? jobs.at(-1)

export function JobsTab({ sessionId }: RightPanelTabProps) {
  const { t } = useI18n()
  const session = useSessionJobs(sessionId)
  const store = useJobsStoreApi()
  const selectedId = useJobs((s) => (sessionId === null ? undefined : s.selected[sessionId]))
  const jobs = session?.jobs ?? []
  const anyActive = jobs.some(isJobActive)
  const now = useNow(anyActive)
  const fallback = selectedId === undefined || !jobs.some((j) => j.jobId === selectedId) ? defaultJob(jobs)?.jobId : undefined
  // 缺省选中项一经显示即固定为选中项：它结束（例如被停止）后详情不跳到另一个运行中的 Job。
  React.useEffect(() => {
    if (sessionId !== null && fallback !== undefined) store.getState().select(sessionId, fallback)
  }, [store, sessionId, fallback])
  if (sessionId === null || !session || (session.status !== 'ready' && jobs.length === 0)) {
    if (session?.status === 'error')
      return (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-ui-body text-muted-foreground">
          <p>{t('jobs.loadFailed')}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => sessionId !== null && void store.getState().load(sessionId)}>
            {t('jobs.retry')}
          </Button>
        </div>
      )
    if (session?.status === 'loading')
      return (
        <div className="flex min-h-0 flex-1 items-center justify-center" aria-label={t('jobs.output.loading')}>
          <LoaderCircleIcon aria-hidden className="size-5 animate-spin text-muted-foreground motion-reduce:animate-none" />
        </div>
      )
    return <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center text-ui-body text-muted-foreground">{t('jobs.empty')}</div>
  }
  if (jobs.length === 0)
    return <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center text-ui-body text-muted-foreground">{t('jobs.empty')}</div>
  const current = jobs.find((j) => j.jobId === selectedId) ?? defaultJob(jobs)!
  return (
    <div data-slot="jobs-tab" className="flex min-h-0 min-w-0 flex-1 flex-col">
      <ul aria-label={t('jobs.list')} data-scroll-stable className="flex max-h-[40%] shrink-0 flex-col gap-0.5 overflow-y-auto px-2 pb-2">
        {jobs.map((job) => (
          <JobListItem key={job.jobId} job={job} selected={job === current} now={now} onSelect={() => store.getState().select(sessionId, job.jobId)} />
        ))}
      </ul>
      <JobDetail key={current.jobId} sessionId={sessionId} job={current} />
    </div>
  )
}
