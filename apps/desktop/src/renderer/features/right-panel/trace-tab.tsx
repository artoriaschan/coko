import type { Translator } from '@coko/i18n'
import type { HookTrace, ModelRequestPayload, RunTrace, ToolTrace, TraceTotals, UsageCurrency } from '@coko/protocol'
import { Button, cn } from '@coko/ui'
import { ChevronRightIcon, DownloadIcon, LoaderCircleIcon } from 'lucide-react'
import * as React from 'react'
import { useI18n } from '../../app/i18n.tsx'
import { formatCost, formatCount, useCurrency } from '../conversation/session-cost.tsx'
import { useReloadOnEntryCount } from '../conversation/use-reload-on-entry-count.ts'
import { useTrace, useTraceStoreApi, useSessionDownload } from '../conversation/session-download.tsx'
export { TraceStoreProvider } from '../conversation/session-download.tsx'
import type { RightPanelTabProps } from './tabs.ts'

// 右栏 Trace tab（docs/subsystems/tracing.md#界面）：顶部为 Session 合计与"导出"（下载 .ndjson，含子 Session）；每个 Run 一行（触发、状态、时长、
// Token、费用），展开为模型请求（模型、用途、首字、时长、Token、费用、重试）与工具（名字、时长、审批等待、Hook 结果）。数据来自 GET …/trace，
// model_request、run_start 与 run_end 到达时重读（同一帧合并）。最近的 Run 在最上面。

/** 毫秒：1 秒以内按毫秒，否则保留一位小数的秒。 */
export function formatMs(t: Translator, locale: string, ms: number): string {
  if (ms < 1000) return t('trace.ms', { value: formatCount(locale, Math.round(ms)) })
  const seconds = new Intl.NumberFormat(locale === 'zh' ? 'zh-CN' : 'en-US', { maximumFractionDigits: 1 }).format(ms / 1000)
  return t('trace.seconds', { value: seconds })
}

const TRIGGERS = new Set(['submit', 'retry', 'continue', 'compact', 'goal', 'schedule', 'subagent', 'handoff'])
const STATUSES = new Set(['completed', 'aborted', 'error', 'paused', 'interrupted'])
const triggerText = (t: Translator, trigger: string) => (TRIGGERS.has(trigger) ? t(`trace.trigger.${trigger as 'submit'}`) : trigger)
const statusText = (t: Translator, status: string | undefined) =>
  status === undefined ? t('trace.status.running') : STATUSES.has(status) ? t(`trace.status.${status as 'completed'}`) : status

const tokensText = (t: Translator, locale: string, tokens: number) => t('usage.tokens', { count: formatCount(locale, tokens) })
const join = (parts: (string | undefined | false)[]) => parts.filter(Boolean).join(' · ')

function TraceHook({ hook }: { hook: HookTrace }) {
  const { t, locale } = useI18n()
  return (
    <li data-slot="trace-hook" data-event={hook.event} data-outcome={hook.outcome} className="text-ui-small text-muted-foreground">
      {join([hook.event, hook.outcome, hook.plugin, formatMs(t, locale, hook.durationMs)])}
    </li>
  )
}

function RequestRow({ request, currency }: { request: ModelRequestPayload; currency: UsageCurrency }) {
  const { t, locale } = useI18n()
  const tokens = request.usage.input + request.usage.output + request.usage.cacheRead + request.usage.cacheWrite
  return (
    <li data-slot="trace-request" data-purpose={request.purpose} className="flex min-w-0 flex-col">
      <span className="flex min-w-0 items-baseline gap-1.5 text-ui-body">
        <span data-user-content className="min-w-0 truncate font-mono" title={`${request.provider}/${request.model}`}>
          {request.model}
        </span>
        <span className="shrink-0 text-ui-small text-muted-foreground">{t(`trace.purpose.${request.purpose}`)}</span>
      </span>
      <span className="text-ui-small text-muted-foreground tabular-nums">
        {join([
          formatMs(t, locale, request.durationMs),
          request.ttftMs !== undefined && t('trace.ttft', { value: formatMs(t, locale, request.ttftMs) }),
          tokensText(t, locale, tokens),
          request.cost !== undefined && formatCost(locale, currency, request.cost),
          request.retries > 0 && t('trace.retries', { count: request.retries }),
          request.errorCode,
        ])}
      </span>
    </li>
  )
}

function ToolRow({ tool }: { tool: ToolTrace }) {
  const { t, locale } = useI18n()
  return (
    <li data-slot="trace-tool" data-tool-call-id={tool.toolCallId} data-tool={tool.name} className="flex min-w-0 flex-col">
      <span className="flex min-w-0 items-baseline gap-1.5 text-ui-body">
        <span className="min-w-0 truncate font-mono">{tool.name}</span>
        {tool.isError && <span className="shrink-0 text-ui-small text-destructive">{t('trace.toolError')}</span>}
      </span>
      <span className="text-ui-small text-muted-foreground tabular-nums">
        {join([
          tool.durationMs === undefined ? t('trace.unfinished') : formatMs(t, locale, tool.durationMs),
          tool.approvalWaitMs !== undefined && t('trace.approvalWait', { value: formatMs(t, locale, tool.approvalWaitMs) }),
          tool.approval !== undefined && t(`trace.approval.${tool.approval}`),
        ])}
      </span>
      {tool.hooks.length > 0 && (
        <ul aria-label={t('trace.hooks')} className="flex flex-col">
          {tool.hooks.map((hook, i) => (
            <TraceHook key={i} hook={hook} />
          ))}
        </ul>
      )}
    </li>
  )
}

function RunRow({ run, currency }: { run: RunTrace; currency: UsageCurrency }) {
  const { t, locale } = useI18n()
  const [expanded, setExpanded] = React.useState(false)
  const detailsId = React.useId()
  const summary = join([
    statusText(t, run.status),
    run.durationMs !== undefined && formatMs(t, locale, run.durationMs),
    tokensText(t, locale, run.tokens),
    formatCost(locale, currency, run.cost),
  ])
  return (
    <li data-slot="trace-run" data-run-id={run.runId} data-status={run.status ?? 'running'} className="flex min-w-0 flex-col">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={detailsId}
        aria-label={`${t('trace.expand')}: ${triggerText(t, run.trigger)}`}
        data-action="toggle-run"
        className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-start focus-ring [@media(hover:hover)]:hover:bg-accent"
        onClick={() => setExpanded(!expanded)}
      >
        <ChevronRightIcon
          aria-hidden
          className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none', expanded && 'rotate-90')}
        />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-ui-body font-medium">{triggerText(t, run.trigger)}</span>
          <span className={cn('truncate text-ui-small tabular-nums', run.status === 'error' ? 'text-destructive' : 'text-muted-foreground')} title={summary}>
            {summary}
          </span>
        </span>
      </button>
      {expanded && (
        <div id={detailsId} data-slot="trace-run-details" className="flex min-w-0 flex-col gap-2 ps-7.5 pe-2 pb-2">
          <section aria-label={t('trace.requests')} className="flex flex-col gap-1">
            <h4 className="text-ui-small text-muted-foreground">{t('trace.requests')}</h4>
            <ul className="flex flex-col gap-1">
              {run.requests.map((request, i) => (
                <RequestRow key={i} request={request} currency={currency} />
              ))}
            </ul>
          </section>
          <section aria-label={t('trace.tools')} className="flex flex-col gap-1">
            <h4 className="text-ui-small text-muted-foreground">{t('trace.tools')}</h4>
            {run.tools.length === 0 ? (
              <p className="text-ui-small text-muted-foreground">{t('trace.noTools')}</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {run.tools.map((tool) => (
                  <ToolRow key={tool.toolCallId} tool={tool} />
                ))}
              </ul>
            )}
          </section>
          {run.hooks.length > 0 && (
            <section aria-label={t('trace.hooks')} className="flex flex-col gap-1">
              <h4 className="text-ui-small text-muted-foreground">{t('trace.hooks')}</h4>
              <ul className="flex flex-col">
                {run.hooks.map((hook, i) => (
                  <TraceHook key={i} hook={hook} />
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </li>
  )
}

function Totals({ sessionId, totals, currency }: { sessionId: string; totals: TraceTotals; currency: UsageCurrency }) {
  const { t, locale } = useI18n()
  const { exporting, download } = useSessionDownload(sessionId)
  return (
    <div data-slot="trace-totals" className="flex min-w-0 shrink-0 items-start gap-2 px-4 pb-2">
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-ui-body tabular-nums">{join([tokensText(t, locale, totals.tokens), formatCost(locale, currency, totals.cost)])}</span>
        <span className="text-ui-small text-muted-foreground tabular-nums">
          {t('trace.totals', { runs: totals.runs, requests: totals.requests, tools: totals.toolCalls })}
        </span>
      </div>
      <Button type="button" variant="outline" size="sm" data-action="export-session" disabled={exporting} onClick={() => void download()}>
        {exporting ? <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" /> : <DownloadIcon />}
        {exporting ? t('trace.exporting') : t('trace.export')}
      </Button>
    </div>
  )
}

/** 影响追踪的条目：数量变化时重读。 */
const TRACE_ENTRY_KINDS = ['model_request', 'run_start', 'run_end'] as const

/** 同一帧内的多次变化合并为一次读取。 */
function useFrameLoad(load: (sessionId: string) => Promise<void>) {
  const frame = React.useRef<number | undefined>(undefined)
  React.useEffect(() => () => (frame.current === undefined ? undefined : cancelAnimationFrame(frame.current)), [])
  return React.useCallback(
    (sessionId: string) => {
      if (frame.current !== undefined) cancelAnimationFrame(frame.current)
      frame.current = requestAnimationFrame(() => {
        frame.current = undefined
        void load(sessionId)
      })
    },
    [load],
  )
}

export function TraceTab({ sessionId }: RightPanelTabProps) {
  const { t } = useI18n()
  const store = useTraceStoreApi()
  const currency = useCurrency()
  const scheduleLoad = useFrameLoad(store.getState().load)
  useReloadOnEntryCount(sessionId, TRACE_ENTRY_KINDS, scheduleLoad)
  const trace = useTrace((s) => (sessionId === null ? undefined : s.sessions[sessionId]))
  const centered = 'flex min-h-0 flex-1 items-center justify-center p-6 text-center text-ui-body text-muted-foreground'
  if (sessionId === null) return <div className={centered}>{t('trace.noSession')}</div>
  const response = trace?.response
  if (!response) {
    if (trace?.status === 'error')
      return (
        <div className={`${centered} flex-col gap-2`}>
          <p>{t('trace.loadFailed')}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => void store.getState().load(sessionId)}>
            {t('trace.retry')}
          </Button>
        </div>
      )
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center" aria-label={t('trace.loading')}>
        <LoaderCircleIcon aria-hidden className="size-5 animate-spin text-muted-foreground motion-reduce:animate-none" />
      </div>
    )
  }
  return (
    <div data-slot="trace-tab" className="flex min-h-0 min-w-0 flex-1 flex-col">
      <Totals sessionId={sessionId} totals={response.totals} currency={currency} />
      {trace?.status === 'error' && (
        <p role="status" className="shrink-0 px-4 pb-2 text-ui-small text-destructive">
          {t('trace.loadFailed')}
        </p>
      )}
      {response.runs.length === 0 ? (
        <div className={centered}>{t('trace.empty')}</div>
      ) : (
        <ul aria-label={t('trace.runs')} data-scroll-stable className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-2">
          {response.runs.toReversed().map((run) => (
            <RunRow key={run.runId} run={run} currency={currency} />
          ))}
        </ul>
      )}
    </div>
  )
}
