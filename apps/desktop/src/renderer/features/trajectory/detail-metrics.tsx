import * as React from 'react'
import type { ModelRequestPayload } from '@coko/protocol'
import { useTrajectoryLocale } from './locales.ts'
import { useI18n } from '../../app/i18n.tsx'
import type { TrajectoryCellProps } from './trajectory-record.ts'
import css from './trajectory-panel.module.css'

export type DetailUsage = ModelRequestPayload['usage'] & { reasoning?: number }

export function cumulativeUsage(requests: readonly ModelRequestPayload[], target: ModelRequestPayload): DetailUsage | undefined {
  const ordered = [...requests].filter((request) => request.purpose !== 'title').sort((a, b) => a.startedAt - b.startedAt)
  const at = ordered.indexOf(target)
  if (at < 0) return undefined
  return ordered.slice(0, at + 1).reduce<DetailUsage>(
    (sum, request) => ({
      input: sum.input + request.usage.input,
      cacheRead: sum.cacheRead + request.usage.cacheRead,
      cacheWrite: sum.cacheWrite + request.usage.cacheWrite,
      output: sum.output + request.usage.output,
      total: sum.total + request.usage.total,
      ...(request.reasoning === undefined && sum.reasoning === undefined ? {} : { reasoning: (sum.reasoning ?? 0) + (request.reasoning ?? 0) }),
    }),
    { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  )
}

export function StartedAtValue({ timestamp }: { timestamp: number | null }) {
  const t = useTrajectoryLocale()
  const [unix, setUnix] = React.useState(false)
  if (timestamp === null) return <dd>{t('timing.notRecorded')}</dd>
  const date = new Date(timestamp)
  const calendar = [date.getFullYear(), date.getMonth() + 1, date.getDate()].map((value) => String(value).padStart(2, '0')).join('-')
  const clock =
    [date.getHours(), date.getMinutes(), date.getSeconds()].map((value) => String(value).padStart(2, '0')).join(':') +
    '.' +
    String(date.getMilliseconds()).padStart(3, '0')
  return (
    <dd>
      <button
        type="button"
        className={css.timestampToggle}
        title={t(unix ? 'timing.showLocalTime' : 'timing.showUnixTimestamp')}
        onClick={(event) => {
          const selection = event.currentTarget.ownerDocument.getSelection()
          if (selection && !selection.isCollapsed && selection.containsNode(event.currentTarget, true)) return
          setUnix(!unix)
        }}
      >
        {unix ? (timestamp / 1000).toFixed(3) : `${calendar} ${clock}`}
      </button>
    </dd>
  )
}

export function RecordTiming({ cell, preview = false }: { cell: TrajectoryCellProps; preview?: boolean }) {
  const t = useTrajectoryLocale()
  const { t: appT } = useI18n()
  const request = cell.request
  const duration = request?.durationMs ?? (cell.timeSeconds === null ? undefined : cell.timeSeconds * 1000)
  const format = (value: number | undefined) =>
    value === undefined
      ? t('timing.notRecorded')
      : value < 1000
        ? t('unit.milliseconds', { value: Math.round(value) })
        : t('unit.seconds', { value: (value / 1000).toFixed(value < 10_000 ? 2 : 1) })
  const generation = request?.ttftMs === undefined || duration === undefined ? undefined : Math.max(0, duration - request.ttftMs)
  return (
    <dl className={css.overview}>
      <div>
        <dt>{t('timing.started')}</dt>
        <StartedAtValue key={cell.id} timestamp={cell.startedAt} />
      </div>
      <div>
        <dt>{t(cell.kind === 'message' ? 'timing.totalDuration' : 'timing.duration')}</dt>
        <dd>{format(duration)}</dd>
      </div>
      {cell.kind === 'message' && (
        <>
          <div>
            <dt>{t('timing.ttft')}</dt>
            <dd>{format(request?.ttftMs)}</dd>
          </div>
          <div>
            <dt>{t('timing.generation')}</dt>
            <dd>{format(generation)}</dd>
          </div>
          <div>
            <dt>{t('timing.throughput')}</dt>
            <dd>
              {generation === undefined
                ? t('timing.notRecorded')
                : generation === 0
                  ? t('timing.durationTooShort')
                  : t('unit.tokensPerSecond', { value: ((request?.usage.output ?? 0) / (generation / 1000)).toFixed(1) })}
            </dd>
          </div>
        </>
      )}
      {!preview && (cell.kind === 'tool' || cell.kind === 'subtool') && (
        <div>
          <dt>{t('timing.source')}</dt>
          <dd>{t(cell.output === undefined ? 'timing.sessionTimestampsRunning' : 'timing.sessionTimestamps')}</dd>
        </div>
      )}
      {!preview && cell.tool?.approvalWaitMs !== undefined && (
        <div>
          <dt>{appT('trace.approvalWait', { value: '' })}</dt>
          <dd>{format(cell.tool.approvalWaitMs)}</dd>
        </div>
      )}
      {!preview && cell.tool?.approval && (
        <div>
          <dt>{t('details.status')}</dt>
          <dd>{appT(`trace.approval.${cell.tool.approval}`)}</dd>
        </div>
      )}
    </dl>
  )
}

export function UsageRows({ usage }: { usage: DetailUsage | undefined }) {
  const t = useTrajectoryLocale()
  if (!usage) return <p className={css.noPayload}>{t('usage.notReported')}</p>
  const rows = [
    ['usage.input', usage.input + usage.cacheRead + usage.cacheWrite, false],
    ['usage.cached', usage.cacheRead, true],
    ['usage.cacheCreated', usage.cacheWrite, true],
    ['usage.other', usage.input, true],
    ['usage.output', usage.output, false],
    ...(usage.reasoning === undefined
      ? []
      : [
          ['usage.reasoning', usage.reasoning, true],
          ['usage.content', Math.max(0, usage.output - usage.reasoning), true],
        ]),
  ] as const
  return (
    <dl className={css.overview}>
      {rows.map(([label, value, detail]) => (
        <div key={String(label)} className={detail ? css.requestTokenDetail : undefined}>
          <dt>{t(label as 'usage.input')}</dt>
          <dd>{t('unit.tokens', { value: Number(value).toLocaleString() })}</dd>
        </div>
      ))}
    </dl>
  )
}

export function RequestUsage({ usage, cumulative }: { usage: DetailUsage | undefined; cumulative: DetailUsage | undefined }) {
  const t = useTrajectoryLocale()
  return (
    <div className={css.usagePanel}>
      {(
        [
          ['usage.thisRequest', usage],
          ['usage.sessionCumulative', cumulative],
        ] as const
      ).map(([key, value]) => (
        <section className={css.usageGroup} key={key} aria-label={t(key)}>
          <h4 className={css.usageHeading}>{t(key)}</h4>
          <UsageRows usage={value} />
        </section>
      ))}
    </div>
  )
}
