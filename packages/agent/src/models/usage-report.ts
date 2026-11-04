import { calculateCost, createAssistantMessageEventStream, type AssistantMessage, type ProviderStreams, type Usage } from '@earendil-works/pi-ai'
import type { UsageReport } from '../session-entries/context.ts'

const buckets = ['input', 'output', 'cacheRead', 'cacheWrite'] as const
type Bucket = (typeof buckets)[number]
const object = (v: unknown): Record<string, unknown> => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
const count = (v: unknown): number | undefined => (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : undefined)

/** Observe only metering fields, before pi-ai fills absent fields with zero. No body is retained. */
function observer(api: string) {
  const values: Partial<Record<Bucket, number>> = {}
  let reasoning: number | undefined
  let cacheWrite1h: number | undefined
  let saw = false
  let finished = false
  let invalid = false
  let inputTotal: number | undefined
  const put = (key: Bucket, value: unknown) => {
    const n = count(value)
    if (n === undefined) {
      if (value !== undefined) invalid = true
    } else values[key] = n
  }
  const ingest = (raw: unknown) => {
    const event = object(raw)
    if (api === 'anthropic-messages') {
      const usage = object(event.type === 'message_start' ? object(event.message).usage : event.usage)
      if (event.type !== 'message_start' && event.type !== 'message_delta') return
      if (event.type === 'message_start') {
        if (
          ![usage.input_tokens, usage.output_tokens, usage.cache_read_input_tokens, usage.cache_creation_input_tokens].some(
            (value) => count(value) !== undefined,
          )
        )
          return
        saw = true
        put('input', usage.input_tokens)
        if (usage.cache_read_input_tokens !== undefined) put('cacheRead', usage.cache_read_input_tokens)
        if (usage.cache_creation_input_tokens !== undefined) put('cacheWrite', usage.cache_creation_input_tokens)
      }
      if (event.type === 'message_delta') {
        for (const [key, field] of [
          ['input', 'input_tokens'],
          ['cacheRead', 'cache_read_input_tokens'],
          ['cacheWrite', 'cache_creation_input_tokens'],
        ] as const) {
          if (usage[field] !== undefined) put(key, usage[field])
        }
        finished = object(event.delta).stop_reason != null && count(usage.output_tokens) !== undefined
      }
      if (usage.output_tokens !== undefined) put('output', usage.output_tokens)
      const thinking = object(usage.output_tokens_details).thinking_tokens
      if (thinking !== undefined) reasoning = count(thinking)
      const ttl = object(usage.cache_creation).ephemeral_1h_input_tokens
      if (ttl !== undefined) cacheWrite1h = count(ttl)
    } else {
      const response = object(event.response)
      const choice = object(Array.isArray(event.choices) ? event.choices[0] : undefined)
      const rawUsage = api === 'openai-responses' ? response.usage : (event.usage ?? choice.usage)
      if (rawUsage === undefined || rawUsage === null) return
      const usage = object(rawUsage)
      const responses = api === 'openai-responses'
      const details = object(responses ? usage.input_tokens_details : usage.prompt_tokens_details)
      if (
        ![
          responses ? usage.input_tokens : usage.prompt_tokens,
          responses ? usage.output_tokens : usage.completion_tokens,
          details.cached_tokens,
          details.cache_write_tokens,
          usage.prompt_cache_hit_tokens,
          usage.cached_tokens,
        ].some((value) => count(value) !== undefined)
      ) {
        invalid = true
        finished = false
        return
      }
      saw = true
      const rawRead = details.cached_tokens ?? usage.prompt_cache_hit_tokens ?? usage.cached_tokens
      const rawWrite = details.cache_write_tokens
      const read = rawRead === undefined ? values.cacheRead : count(rawRead)
      const write = rawWrite === undefined ? values.cacheWrite : count(rawWrite)
      const rawInput = responses ? usage.input_tokens : usage.prompt_tokens
      const rawOutput = responses ? usage.output_tokens : usage.completion_tokens
      const input = count(rawInput)
      if (input !== undefined) inputTotal = input
      if ((rawRead !== undefined && read === undefined) || (rawWrite !== undefined && write === undefined)) invalid = true
      // 未报告的缓存桶保持未知，不写成实测零；拆分输入时把缺失的缓存按 0 处理。
      if (read !== undefined) put('cacheRead', read)
      if (write !== undefined) put('cacheWrite', write)
      if (rawInput !== undefined && input === undefined) invalid = true
      if (inputTotal !== undefined) {
        const cached = (read ?? 0) + (write ?? 0)
        if (inputTotal >= cached) put('input', inputTotal - cached)
        else invalid = true
      }
      if (rawOutput !== undefined) put('output', rawOutput)
      const reportedReasoning = object(responses ? usage.output_tokens_details : usage.completion_tokens_details).reasoning_tokens
      if (reportedReasoning !== undefined) reasoning = count(reportedReasoning)
      finished = (!responses || event.type === 'response.completed') && input !== undefined && count(rawOutput) !== undefined
    }
  }
  return {
    ingest,
    apply(message: AssistantMessage, model: Parameters<ProviderStreams['stream']>[0]) {
      const known = buckets.filter((key) => values[key] !== undefined)
      // 缓存桶是可选项：未报告不影响本轮是否完整，只是不展示该行。
      const report: UsageReport = {
        complete:
          saw &&
          finished &&
          !invalid &&
          known.includes('input') &&
          known.includes('output') &&
          message.stopReason !== 'error' &&
          message.stopReason !== 'aborted',
        known,
      }
      const usage: Usage & { report: UsageReport } = {
        ...message.usage,
        ...Object.fromEntries(buckets.map((key) => [key, values[key] ?? 0])),
        totalTokens: buckets.reduce((sum, key) => sum + (values[key] ?? 0), 0),
        ...(reasoning === undefined ? {} : { reasoning }),
        report,
      }
      // Do not retain a dependency's synthesized optional zero as a reported field.
      if (reasoning === undefined || values.output === undefined || reasoning > values.output) delete usage.reasoning
      if (cacheWrite1h === undefined || values.cacheWrite === undefined || cacheWrite1h > values.cacheWrite) delete usage.cacheWrite1h
      else usage.cacheWrite1h = cacheWrite1h
      // Preserve adapter pricing (service tier or a permitted fallback) when its normalized counters agree.
      if (
        buckets.some((key) => usage[key] !== message.usage[key]) ||
        usage.cacheWrite1h !== message.usage.cacheWrite1h ||
        Object.values(usage.cost).some((value) => !Number.isFinite(value) || value < 0)
      )
        calculateCost(model, usage)
      message.usage = usage
    },
  }
}

/** Configured HTTP protocols preserve presence at their actual transport boundary. */
export function withUsageReports(streams: ProviderStreams): ProviderStreams {
  const wrap =
    (inner: ProviderStreams['stream']): ProviderStreams['stream'] =>
    (model, context, options) => {
      const meter = observer(model.api)
      const out = createAssistantMessageEventStream()
      void (async () => {
        let partial: AssistantMessage | undefined
        try {
          const stream = inner(model, context, {
            ...options,
            onProviderStreamEvent: async (event, responseModel) => {
              meter.ingest(event)
              await options?.onProviderStreamEvent?.(event, responseModel)
            },
          })
          for await (const event of stream) {
            if ('partial' in event) partial = event.partial
            if (event.type === 'done') meter.apply(event.message, model)
            if (event.type === 'error') meter.apply(event.error, model)
            out.push(event)
          }
          const final = await stream.result()
          meter.apply(final, model)
          out.end(final)
        } catch {
          // ProviderStreams normally emits errors; also settle a throwing extension without leaking its payload.
          const final: AssistantMessage = {
            ...(partial ?? {
              role: 'assistant',
              content: [],
              api: model.api,
              provider: model.provider,
              model: model.id,
              timestamp: Date.now(),
              usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
            }),
            stopReason: options?.signal?.aborted ? 'aborted' : 'error',
            errorMessage: 'Provider stream failed',
          }
          meter.apply(final, model)
          out.push({ type: 'error', reason: final.stopReason as 'error' | 'aborted', error: final })
          out.end(final)
        }
      })()
      return out
    }
  return { ...streams, stream: wrap(streams.stream), streamSimple: wrap(streams.streamSimple) }
}
