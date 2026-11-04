import { aggregateUsage, aggregateUsageByRun, type UsageSummary } from '@coko/agent/entries'
import { USAGE_CURRENCY_SETTING, usageCurrencyOf, type Provider, type SessionEntry, type UsageCurrency } from '@coko/protocol'
import type { Translator } from '@coko/i18n'
import { Button, HoverCard, HoverCardContent, HoverCardTrigger } from '@coko/ui'
import { CoinsIcon } from 'lucide-react'
import * as React from 'react'
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

export const totalTokens = (u: Pick<UsageTotals, 'input' | 'output' | 'cacheRead' | 'cacheWrite'>) => u.input + u.output + u.cacheRead + u.cacheWrite

/** 模型是否已定价：目录中有该模型时看是否写了 price；不在目录中（测试用 faux、已删除的 Provider）时看这条回复是否计了费用。 */
export type PricedLookup = (providerId: string | undefined, modelId: string | undefined, cost: number) => boolean

export function pricedLookup(providers: readonly Provider[]): PricedLookup {
  return (providerId, modelId, cost) => {
    const model = providers.find((p) => p.id === providerId)?.models.find((m) => m.id === modelId)
    return model ? model.price !== undefined : cost > 0
  }
}

const totalsOf = (summary: UsageSummary, priced: PricedLookup): UsageTotals => {
  let pricedRequests = 0
  let unpricedRequests = 0
  for (const attribution of summary.attributions) {
    if (priced(attribution.provider, attribution.model, attribution.cost)) pricedRequests++
    else unpricedRequests++
  }
  return {
    input: summary.totals.input,
    output: summary.totals.output,
    cacheRead: summary.totals.cacheRead,
    cacheWrite: summary.totals.cacheWrite,
    cost: { ...summary.cost },
    complete: summary.complete,
    hasUsage: summary.hasUsage,
    known: [...summary.known],
    reported: { ...summary.reported },
    requests: summary.requests,
    models: [...summary.models],
    ...(summary.reasoning === undefined ? {} : { reasoning: summary.reasoning }),
    priced: pricedRequests,
    unpriced: unpricedRequests,
  }
}

/** 汇总带 runId 的条目的 usage；runId 给出时只汇总该 Run。 */
export function sumUsage(entries: readonly SessionEntry[], priced: PricedLookup, runId?: string): UsageTotals {
  return totalsOf(aggregateUsage(entries, runId), priced)
}

/** 一次遍历得到整个 Session 与每个 Run 的汇总，供消息底栏共用。 */
export function sumUsageByRun(entries: readonly SessionEntry[], priced: PricedLookup): { session: UsageTotals; byRun: Map<string, UsageTotals> } {
  const { session, byRun } = aggregateUsageByRun(entries)
  return {
    session: totalsOf(session, priced),
    byRun: new Map([...byRun].map(([runId, summary]) => [runId, totalsOf(summary, priced)])),
  }
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
