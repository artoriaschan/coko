import { RequestUsage, USAGE_CURRENCY_SETTING, usageCurrencyOf, type Provider, type SessionEntry, type UsageCurrency } from '@coko/protocol'
import type { Translator } from '@coko/i18n'
import { Button, HoverCard, HoverCardContent, HoverCardTrigger } from '@coko/ui'
import { CoinsIcon } from 'lucide-react'
import * as React from 'react'
import { Value } from 'typebox/value'
import { useChat } from '../../app/chat.tsx'
import { useI18n } from '../../app/i18n.tsx'
import { useSettings } from '../../app/settings.tsx'
import type { HeaderActionProps } from './header-actions.ts'

// 用量与费用（docs/subsystems/goal.md#界面）：优先累计请求事实，兼容旧 assistant / compaction usage。只计本 Session 的请求：
// 分叉复制来的消息去掉了 runId，其费用属于原 Session。费用不换算货币，符号取设置 usage.currency。

export interface UsageTotals {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number }
  /** 所有请求的必要分桶都完整报告。旧记录无法证明。 */
  complete: boolean
  hasUsage: boolean
  known: ('input' | 'output' | 'cacheRead' | 'cacheWrite')[]
  /** Counts actually reported; compatibility totals above may include dependency fallback values. */
  reported: { input: number; output: number; cacheRead: number; cacheWrite: number }
  requests: number
  models: { provider: string; model: string }[]
  reasoning?: number
  /** 带归属的已定价 / 未定价请求或旧回复数量。 */
  priced: number
  unpriced: number
}

const EMPTY_TOTALS: UsageTotals = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  complete: true,
  hasUsage: false,
  known: ['input', 'output', 'cacheRead', 'cacheWrite'],
  reported: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  requests: 0,
  models: [],
  priced: 0,
  unpriced: 0,
}

export const totalTokens = (u: Pick<UsageTotals, 'input' | 'output' | 'cacheRead' | 'cacheWrite'>) => u.input + u.output + u.cacheRead + u.cacheWrite

/** 模型是否已定价：目录中有该模型时看是否写了 price；不在目录中（测试用 faux、已删除的 Provider）时看这条回复是否计了费用。 */
export type PricedLookup = (providerId: string | undefined, modelId: string | undefined, cost: number) => boolean

export function pricedLookup(providers: readonly Provider[]): PricedLookup {
  return (providerId, modelId, cost) => {
    const model = providers.find((p) => p.id === providerId)?.models.find((m) => m.id === modelId)
    return model ? model.price !== undefined : cost > 0
  }
}

const usageOf = (value: unknown): RequestUsage | undefined => (Value.Check(RequestUsage, value) ? value : undefined)

/** 汇总带 runId 的条目的 usage；runId 给出时只汇总该 Run。 */
export function sumUsage(entries: readonly SessionEntry[], priced: PricedLookup, runId?: string): UsageTotals {
  const totals: UsageTotals = {
    ...EMPTY_TOTALS,
    cost: { ...EMPTY_TOTALS.cost },
    known: [...EMPTY_TOTALS.known],
    reported: { ...EMPTY_TOTALS.reported },
    models: [],
  }
  const canonicalRuns = new Set(
    entries.filter((entry) => entry.kind === 'model_request' && entry.payload.requestId && entry.runId !== null).map((entry) => entry.runId),
  )
  const seenEntries = new Set<string>()
  const seenRequests = new Set<string>()
  const provenance = (provider: string | undefined, model: string | undefined, cost: number) => {
    if (priced(provider, model, cost)) totals.priced++
    else totals.unpriced++
    if (provider && model && !totals.models.some((item) => item.provider === provider && item.model === model)) totals.models.push({ provider, model })
  }
  const add = (usage: RequestUsage) => {
    totals.requests++
    totals.complete = false // Legacy fields cannot prove provider reporting completeness.
    totals.hasUsage = true
    totals.input += usage.input
    totals.output += usage.output
    totals.cacheRead += usage.cacheRead
    totals.cacheWrite += usage.cacheWrite
    for (const key of ['input', 'output', 'cacheRead', 'cacheWrite'] as const) totals.reported[key] += usage[key]
    for (const key of ['input', 'output', 'cacheRead', 'cacheWrite', 'total'] as const) totals.cost[key] += usage.cost[key]
    if (usage.reasoning !== undefined) totals.reasoning = (totals.reasoning ?? 0) + usage.reasoning
  }
  for (const entry of entries) {
    const identity = `${entry.sessionId}:${entry.seq}`
    if (seenEntries.has(identity)) continue
    seenEntries.add(identity)
    if (entry.kind === 'model_request' && (entry.payload.purpose === 'title' || (entry.runId !== null && canonicalRuns.has(entry.runId)))) {
      if (entry.payload.purpose === 'title' ? runId !== undefined : runId !== undefined && entry.runId !== runId) continue
      const request = entry.payload
      if (request.requestId && seenRequests.has(request.requestId)) continue
      if (request.requestId) seenRequests.add(request.requestId)
      totals.requests++
      const report = request.usageReport
      totals.complete &&= report?.complete === true
      totals.hasUsage ||= report ? report.known.length > 0 : true
      totals.known = totals.known.filter((key) => report?.known.includes(key))
      totals.input += request.usage.input
      totals.output += request.usage.output
      totals.cacheRead += request.usage.cacheRead
      totals.cacheWrite += request.usage.cacheWrite
      for (const key of ['input', 'output', 'cacheRead', 'cacheWrite'] as const)
        if (!report || report.known.includes(key)) totals.reported[key] += request.usage[key]
      totals.cost.total += request.cost ?? 0
      if (request.costBreakdown) for (const key of ['input', 'output', 'cacheRead', 'cacheWrite'] as const) totals.cost[key] += request.costBreakdown[key]
      if (request.reasoning !== undefined) totals.reasoning = (totals.reasoning ?? 0) + request.reasoning
      provenance(request.provider, request.model, request.cost ?? 0)
      continue
    }
    if (entry.runId === null || canonicalRuns.has(entry.runId) || (runId !== undefined && entry.runId !== runId)) continue
    if (entry.kind === 'compaction') {
      if (entry.payload.usage) add(entry.payload.usage)
      continue
    }
    if (entry.kind !== 'message' || entry.payload.role !== 'assistant') continue
    const message = entry.payload as { usage?: unknown; provider?: unknown; model?: unknown }
    const usage = usageOf(message.usage)
    if (!usage) continue
    add(usage)
    provenance(
      typeof message.provider === 'string' ? message.provider : undefined,
      typeof message.model === 'string' ? message.model : undefined,
      usage.cost.total,
    )
  }
  if (totals.requests === 0) {
    totals.complete = false
    totals.known = []
  }

  return totals
}

const CURRENCY_SYMBOLS: Record<UsageCurrency, string> = { USD: '$', CNY: '¥' }

const numberLocale = (locale: string) => (locale === 'zh' ? 'zh-CN' : 'en-US')

/** 费用：小于 1 时保留 4 位小数，否则 2 位；非零但小于 0.0001 时显示 <0.0001。 */
export function formatCost(locale: string, currency: UsageCurrency, amount: number): string {
  const symbol = CURRENCY_SYMBOLS[currency]
  if (amount > 0 && amount < 0.0001) return `<${symbol}0.0001`
  const digits = amount < 1 ? 4 : 2
  return symbol + new Intl.NumberFormat(numberLocale(locale), { minimumFractionDigits: 2, maximumFractionDigits: digits }).format(amount)
}

export const formatCount = (locale: string, value: number) => new Intl.NumberFormat(numberLocale(locale)).format(value)

/** 汇总的费用文案：全部未定价时"未定价"；部分未定价时费用后注明。 */
export function costText(t: Translator, locale: string, currency: UsageCurrency, totals: UsageTotals): string {
  if (totals.priced === 0 && totals.unpriced > 0) return t('usage.unpriced')
  const cost = formatCost(locale, currency, totals.cost.total)
  return totals.unpriced > 0 ? t('usage.partlyUnpriced', { cost }) : cost
}

export function useCurrency(): UsageCurrency {
  return useSettings((s) => usageCurrencyOf(s.values[USAGE_CURRENCY_SETTING]?.value))
}

export function usePricedLookup(): PricedLookup {
  const providers = useSettings((s) => s.providers)
  return React.useMemo(() => pricedLookup(providers), [providers])
}

const NO_ENTRIES: SessionEntry[] = []

/**
 * 会话标题栏的 Session 累计费用：费用（或"未定价"）与 HoverCard 分项（输入、输出、缓存读写的 Token 与费用）。会话还没有带 usage 的回复时
 * 不显示。触发器是按钮，键盘聚焦时同样打开 HoverCard。
 */
export function SessionCost({ sessionId }: HeaderActionProps) {
  const { t, locale } = useI18n()
  const entries = useChat((s) => s.conversations[sessionId]?.entries ?? NO_ENTRIES)
  const priced = usePricedLookup()
  const currency = useCurrency()
  const totals = React.useMemo(() => sumUsage(entries, priced), [entries, priced])
  if (totals.priced + totals.unpriced === 0 && totalTokens(totals) === 0) return null
  const cost = costText(t, locale, currency, totals)
  const allUnpriced = totals.priced === 0 && totals.unpriced > 0
  const rows = [
    ['input', totals.input, totals.cost.input],
    ['output', totals.output, totals.cost.output],
    ['cacheRead', totals.cacheRead, totals.cost.cacheRead],
    ['cacheWrite', totals.cacheWrite, totals.cost.cacheWrite],
  ] as const
  return (
    <HoverCard openDelay={200}>
      <HoverCardTrigger asChild>
        <Button
          variant="toolbar"
          size="sm"
          data-slot="session-cost"
          data-cost={totals.cost.total}
          data-tokens={totalTokens(totals)}
          data-unpriced={allUnpriced || undefined}
          aria-label={t('usage.session.label', { cost })}
          className="max-w-40 min-w-0 tabular-nums"
        >
          <CoinsIcon aria-hidden />
          <span className="truncate">{cost}</span>
        </Button>
      </HoverCardTrigger>
      <HoverCardContent align="end" data-slot="session-cost-detail" className="w-72 text-ui-body">
        <p className="mb-2 font-medium">{t('usage.session.title')}</p>
        <table className="w-full tabular-nums">
          <thead className="text-ui-small text-muted-foreground">
            <tr>
              <th scope="col" className="py-0.5 text-start font-normal">
                <span className="sr-only">{t('usage.title')}</span>
              </th>
              <th scope="col" className="py-0.5 text-end font-normal">
                {t('usage.session.tokens')}
              </th>
              <th scope="col" className="py-0.5 text-end font-normal">
                {t('usage.session.cost')}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([key, tokens, amount]) => (
              <tr key={key} data-usage-part={key}>
                <th scope="row" className="py-0.5 text-start font-normal text-muted-foreground">
                  {t(`usage.session.${key}`)}
                </th>
                <td className="py-0.5 text-end">{formatCount(locale, tokens)}</td>
                <td className="py-0.5 text-end">{allUnpriced ? '—' : formatCost(locale, currency, amount)}</td>
              </tr>
            ))}
            <tr data-usage-part="total" className="border-t-hairline border-border">
              <th scope="row" className="pt-1 text-start font-medium">
                {t('usage.session.total')}
              </th>
              <td className="pt-1 text-end font-medium">{formatCount(locale, totalTokens(totals))}</td>
              <td className="pt-1 text-end font-medium">{allUnpriced ? t('usage.unpriced') : formatCost(locale, currency, totals.cost.total)}</td>
            </tr>
          </tbody>
        </table>
        {totals.unpriced > 0 && !allUnpriced && <p className="mt-2 text-ui-small text-muted-foreground">{t('usage.session.unpricedNote')}</p>}
      </HoverCardContent>
    </HoverCard>
  )
}
