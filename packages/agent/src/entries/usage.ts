// 按 Run 汇总请求用量：canonical 请求优先并按 requestId 去重，旧消息 / 压缩 / 交接只作回退；
// 被跳过的旧来源与请求按四桶签名配对，配对失败说明可能有未记录的请求，本轮不再声称完整。
// 数值必须是安全非负整数，且声明的总量不能小于四桶之和，否则该来源不可信。
import type { EntryLike } from './types.ts'

export type UsageBucket = 'input' | 'cacheRead' | 'cacheWrite' | 'output'

const BUCKETS: readonly UsageBucket[] = ['input', 'cacheRead', 'cacheWrite', 'output']

export interface UsageCounts {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

/** 一次带归属的用量来源，用于计算已定价 / 未定价数量。 */
export interface UsageAttribution {
  provider?: string
  model?: string
  cost: number
}

export interface UsageSummary {
  /** 每个计入来源都完整报告，且本轮有可信结束记录、没有配对失败的旧来源。 */
  complete: boolean
  hasUsage: boolean
  known: UsageBucket[]
  /** 只累计已知分桶。 */
  reported: UsageCounts
  /** 兼容总量：包含依赖回退值，仅供旧消费者使用。 */
  totals: UsageCounts
  cost: UsageCounts & { total: number }
  requests: number
  models: { provider: string; model: string }[]
  attributions: UsageAttribution[]
  reasoning?: number
}

export interface UsageAggregate {
  session: UsageSummary
  byRun: ReadonlyMap<string, UsageSummary>
}

export interface UsageAggregateOptions {
  /** 整个 Session 的汇总是否包含标题请求；按 Run 查询不受影响。默认包含。 */
  includeTitle?: boolean
}

const zero = (): UsageCounts => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })
const emptySummary = (): UsageSummary => ({
  complete: true,
  hasUsage: false,
  known: [...BUCKETS],
  reported: zero(),
  totals: zero(),
  cost: { ...zero(), total: 0 },
  requests: 0,
  models: [],
  attributions: [],
})

const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const num = (value: unknown): number => (isCount(value) ? value : 0)
/** 费用是允许小数的非负有限数。 */
const isAmount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0
const amount = (value: unknown): number => (isAmount(value) ? value : 0)
const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
const isBucket = (value: unknown): value is UsageBucket => typeof value === 'string' && (BUCKETS as readonly string[]).includes(value)

interface CostParts extends Partial<UsageCounts> {
  total?: number
}

interface UsageSource {
  usage: Record<string, unknown>
  report?: { complete: boolean; known: readonly UsageBucket[] }
  provider?: string
  model?: string
  cost?: number
  costBreakdown?: CostParts
}

interface MutableRun {
  summary: UsageSummary
  /** canonical 请求的四桶签名计数。 */
  signatures: Map<string, number>
  /** 因 canonical 请求存在而被跳过的旧来源签名计数。 */
  skipped: Map<string, number>
  invalid: boolean
}

const reportOf = (value: unknown): UsageSource['report'] => {
  const report = record(value)
  if (!report) return undefined
  return {
    complete: report.complete === true,
    known: Array.isArray(report.known) ? report.known.filter(isBucket) : [],
  }
}

const costParts = (value: unknown): CostParts => {
  const cost = record(value)
  if (!cost) return {}
  return {
    input: amount(cost.input),
    output: amount(cost.output),
    cacheRead: amount(cost.cacheRead),
    cacheWrite: amount(cost.cacheWrite),
    total: amount(cost.total),
  }
}

const countsOf = (usage: Record<string, unknown>): { counts: UsageCounts; valid: boolean } => {
  let valid = true
  for (const key of BUCKETS) {
    const value = usage[key]
    if (value !== undefined && !isCount(value)) valid = false
  }
  const counts = { input: num(usage.input), output: num(usage.output), cacheRead: num(usage.cacheRead), cacheWrite: num(usage.cacheWrite) }
  const declared = usage.total ?? usage.totalTokens
  if (declared !== undefined) {
    if (!isCount(declared) || declared < counts.input + counts.output + counts.cacheRead + counts.cacheWrite) valid = false
  }
  return { counts, valid }
}

const signatureOf = (counts: UsageCounts): string => `${counts.input}/${counts.cacheRead}/${counts.cacheWrite}/${counts.output}`

const pushAttribution = (summary: UsageSummary, source: UsageSource, cost: number): void => {
  summary.attributions.push({ ...(source.provider ? { provider: source.provider } : {}), ...(source.model ? { model: source.model } : {}), cost })
  if (source.provider && source.model && !summary.models.some((item) => item.provider === source.provider && item.model === source.model)) {
    summary.models.push({ provider: source.provider, model: source.model })
  }
}

/**
 * 合并一条来源。
 * @param fallback - 旧消息 / 压缩 / 交接来源。它们没有 report 时仍视为数值可信，只是无法证明完整；
 * canonical 请求没有 report 时则连哪些分桶已知都无法证明。
 */
function mergeSource(summary: UsageSummary, source: UsageSource, fallback: boolean): boolean {
  const { counts, valid } = countsOf(source.usage)
  // 矛盾或越界的计数不进入汇总：保留费用或缺口都会让界面显示无法解释的数字。
  if (!valid) return false
  const reportKnown = source.report?.known
  const known = reportKnown ?? (fallback ? BUCKETS : [])
  // canonical 请求没有 report 时无法证明哪些分桶已知，但已存数值仍按“至少这么多”展示。
  const accumulable: readonly UsageBucket[] = reportKnown ?? BUCKETS
  summary.complete &&= source.report?.complete === true
  if (fallback) summary.hasUsage ||= known.length > 0
  else summary.hasUsage ||= reportKnown ? reportKnown.length > 0 : true
  summary.known = summary.known.filter((bucket) => known.includes(bucket))
  for (const key of BUCKETS) {
    summary.totals[key] += counts[key]
    if (accumulable.includes(key)) summary.reported[key] += counts[key]
  }
  const breakdown = source.costBreakdown ?? costParts(source.usage.cost)
  for (const key of BUCKETS) summary.cost[key] += amount(breakdown[key])
  const cost = source.cost ?? amount(breakdown.total)
  summary.cost.total += cost
  summary.requests++
  const reasoning = source.usage.reasoning
  if (isCount(reasoning) && reasoning <= counts.output && (source.report ? source.report.known.includes('output') : reasoning !== 0)) {
    summary.reasoning = (summary.reasoning ?? 0) + reasoning
  }
  pushAttribution(summary, source, cost)
  return true
}

const mergeSummary = (target: UsageSummary, source: UsageSummary): void => {
  target.complete &&= source.complete
  target.hasUsage ||= source.hasUsage
  target.known = target.known.filter((bucket) => source.known.includes(bucket))
  for (const key of BUCKETS) {
    target.totals[key] += source.totals[key]
    target.reported[key] += source.reported[key]
    target.cost[key] += source.cost[key]
  }
  target.cost.total += source.cost.total
  target.requests += source.requests
  if (source.reasoning !== undefined) target.reasoning = (target.reasoning ?? 0) + source.reasoning
  for (const model of source.models) {
    if (!target.models.some((item) => item.provider === model.provider && item.model === model.model)) target.models.push(model)
  }
  target.attributions.push(...source.attributions)
}

/**
 * 一次遍历构建每个 Run 与整个 Session 的用量汇总。
 * @param entries - 当前 Session 的条目。
 * @param options - `includeTitle` 控制 Session 汇总是否包含标题请求。
 */
export function aggregateUsageByRun(entries: readonly EntryLike[], options: UsageAggregateOptions = {}): UsageAggregate {
  const canonicalRuns = new Set<string>()
  const endedRuns = new Set<string>()
  for (const entry of entries) {
    const runId = entry.runId ?? null
    if (entry.kind === 'model_request' && runId !== null) {
      const payload = record(entry.payload)
      if (typeof payload?.requestId === 'string' && payload.requestId !== '') canonicalRuns.add(runId)
    } else if (entry.kind === 'run_end' && runId !== null) {
      if (record(entry.payload)?.status !== 'interrupted') endedRuns.add(runId)
    }
  }

  const session = emptySummary()
  const runs = new Map<string, MutableRun>()
  const seenEntries = new Set<number>()
  const seenRequests = new Set<string>()
  const includeTitle = options.includeTitle ?? true

  const runFor = (runId: string): MutableRun => {
    let run = runs.get(runId)
    if (!run) {
      run = { summary: emptySummary(), signatures: new Map(), skipped: new Map(), invalid: false }
      runs.set(runId, run)
    }
    return run
  }

  const skipLegacy = (run: MutableRun, source: UsageSource): void => {
    const { counts } = countsOf(source.usage)
    const signature = signatureOf(counts)
    run.skipped.set(signature, (run.skipped.get(signature) ?? 0) + 1)
  }

  for (const entry of entries) {
    if (seenEntries.has(entry.seq)) continue
    seenEntries.add(entry.seq)
    const runId = entry.runId ?? null
    const payload = record(entry.payload)
    if (!payload) continue

    if (entry.kind === 'model_request') {
      const purpose = payload.purpose
      const title = purpose === 'title'
      if (!title && (runId === null || !canonicalRuns.has(runId))) continue
      if (title && !includeTitle) continue
      const requestId = typeof payload.requestId === 'string' ? payload.requestId : ''
      if (requestId !== '') {
        if (seenRequests.has(requestId)) continue
        seenRequests.add(requestId)
      }
      const usage = record(payload.usage)
      if (!usage) continue
      const source: UsageSource = {
        usage: { ...usage, ...(payload.reasoning === undefined ? {} : { reasoning: payload.reasoning }) },
        ...(payload.usageReport === undefined ? {} : { report: reportOf(payload.usageReport) }),
        ...(typeof payload.provider === 'string' ? { provider: payload.provider } : {}),
        ...(typeof payload.model === 'string' ? { model: payload.model } : {}),
        ...(isAmount(payload.cost) ? { cost: payload.cost } : {}),
        ...(payload.costBreakdown === undefined ? {} : { costBreakdown: costParts(payload.costBreakdown) }),
      }
      if (title) {
        mergeSource(session, source, false)
        continue
      }
      const run = runFor(runId!)
      if (!mergeSource(run.summary, source, false)) run.invalid = true
      const signature = signatureOf(countsOf(usage).counts)
      run.signatures.set(signature, (run.signatures.get(signature) ?? 0) + 1)
      continue
    }

    if (runId === null) continue

    if (entry.kind === 'message') {
      if (payload.role !== 'assistant') continue
      const usage = record(payload.usage)
      if (!usage) continue
      const source: UsageSource = {
        usage,
        ...(usage.report === undefined ? {} : { report: reportOf(usage.report) }),
        ...(typeof payload.provider === 'string' ? { provider: payload.provider } : {}),
        ...(typeof payload.model === 'string' ? { model: payload.model } : {}),
      }
      const run = runFor(runId)
      if (canonicalRuns.has(runId)) {
        skipLegacy(run, source)
        continue
      }
      if (!mergeSource(run.summary, source, true)) run.invalid = true
      continue
    }

    if (entry.kind !== 'compaction' && entry.kind !== 'handoff' && entry.kind !== 'handoff_failed') continue
    const usage = record(payload.usage)
    if (!usage) continue
    const source: UsageSource = {
      usage,
      ...(usage.report === undefined ? {} : { report: reportOf(usage.report) }),
    }
    const run = runFor(runId)
    if (canonicalRuns.has(runId)) {
      skipLegacy(run, source)
      continue
    }
    if (!mergeSource(run.summary, source, true)) run.invalid = true
  }

  const byRun = new Map<string, UsageSummary>()
  for (const [runId, run] of runs) {
    // 旧来源与 canonical 请求必须能按数值配对；配不上的可能来自未记录的请求。
    for (const [signature, count] of run.skipped) {
      const available = run.signatures.get(signature) ?? 0
      if (available < count) run.invalid = true
      else run.signatures.set(signature, available - count)
    }
    if (run.summary.requests === 0 || !endedRuns.has(runId) || run.invalid) {
      run.summary.complete = false
      run.summary.known = []
    }
    byRun.set(runId, run.summary)
    mergeSummary(session, run.summary)
  }
  if (session.requests === 0) {
    session.complete = false
    session.known = []
  }
  return { session, byRun }
}

/** 汇总指定 Run（省略时汇总整个 Session）。 */
export function aggregateUsage(entries: readonly EntryLike[], runId?: string): UsageSummary {
  const { session, byRun } = aggregateUsageByRun(entries, { includeTitle: runId === undefined })
  if (runId === undefined) return session
  return byRun.get(runId) ?? { ...emptySummary(), complete: false, known: [] }
}
