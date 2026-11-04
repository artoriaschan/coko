// 逐请求记录：每次实际模型请求尝试的耗时、首个增量的时间与此前失败的次数，提交为 model_request 条目。
import { randomUUID } from 'node:crypto'
import { Value } from 'typebox/value'
import { USAGE_REPORT_SCHEMA } from '../session-entries/context.ts'
import type { StreamFn } from '@earendil-works/pi-agent-core'
import { createAssistantMessageEventStream, isContextOverflow, type AssistantMessage, type Model } from '@earendil-works/pi-ai'
import type { ModelRequestPayload, ModelRequestPurpose } from '../session-entries/index.ts'

/** 一次已结束的请求的测量（尚不知用途与 runId）。 */
export interface RequestMeasurement {
  requestId: string
  model: Model<any>
  startedAt: number
  durationMs: number
  ttftMs?: number
  retries: number
  final: AssistantMessage
}

export interface RequestMeter {
  /** 包装一次真实请求尝试（位于重试之内，不含退避等待）。 */
  wrap(inner: StreamFn): StreamFn
  /** 重试之前调用（withRetry 的 onRetry）：计入当前请求的 retries。 */
  retried(attempt: number): void
  /** 按结束顺序取走一次尝试；最后一次取走后为下一次逻辑调用重置重试序号。 */
  take(): RequestMeasurement | undefined
}

const elapsedMs = (from: number) => Math.ceil(performance.now() - from)

export function createRequestMeter(now: () => number = Date.now): RequestMeter {
  let retries = 0
  const pending: RequestMeasurement[] = []
  return {
    wrap: (inner) => (model, context, options) => {
      const out = createAssistantMessageEventStream()
      const requestId = randomUUID()
      const startedAt = now()
      const started = performance.now()
      let measured = false
      let ttftMs: number | undefined
      const measure = (final: AssistantMessage): RequestMeasurement => ({
        requestId,
        model,
        startedAt,
        durationMs: elapsedMs(started),
        ...(ttftMs === undefined ? {} : { ttftMs }),
        retries,
        final,
      })
      void (async () => {
        let partial: AssistantMessage | undefined
        let final: AssistantMessage | undefined
        try {
          const stream = await inner(model, context, options)
          // Queue before forwarding the terminal event: consumers can persist all attempts at message_end.
          for await (const event of stream) {
            if ('partial' in event) partial = event.partial
            if (ttftMs === undefined && (event.type === 'text_delta' || event.type === 'toolcall_delta')) ttftMs = elapsedMs(started)
            if (event.type === 'done' || event.type === 'error') {
              final = event.type === 'done' ? event.message : event.error
              pending.push(measure(final))
              measured = true
            }
            out.push(event)
          }
          final = await stream.result()
          if (!measured) pending.push(measure(final))
        } catch {
          if (!measured) {
            final = {
              ...(partial ?? {
                role: 'assistant',
                content: [],
                api: model.api,
                provider: model.provider,
                model: model.id,
                timestamp: now(),
                usage: {
                  input: 0,
                  output: 0,
                  cacheRead: 0,
                  cacheWrite: 0,
                  totalTokens: 0,
                  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
                },
              }),
              stopReason: options?.signal?.aborted ? 'aborted' : 'error',
              errorMessage: 'Provider stream failed',
            }
            pending.push(measure(final))
            out.push({ type: 'error', reason: final.stopReason as 'error' | 'aborted', error: final })
          }
        } finally {
          out.end(final)
        }
      })()
      return out
    },
    retried: (attempt) => {
      retries = attempt
    },
    take: () => {
      const taken = pending.shift()
      if (pending.length === 0) retries = 0
      return taken
    },
  }
}

const count = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0)

/** 请求错误的机器可读代码：上下文溢出、停止或其他模型错误；正常结束没有。 */
function errorCodeOf(final: AssistantMessage, model: Model<any>): string | undefined {
  if (final.stopReason === 'aborted') return 'aborted'
  if (final.stopReason !== 'error') return undefined
  return isContextOverflow(final, model.contextWindow) ? 'context_overflow' : 'model_error'
}

/** model_request 的 payload：usage 与该请求的 assistant 消息一致。 */
export function modelRequestPayload(runId: string | null, purpose: ModelRequestPurpose, m: RequestMeasurement): ModelRequestPayload {
  const usage = m.final.usage
  const report = (usage as typeof usage & { report?: unknown })?.report
  const usageReport = Value.Check(USAGE_REPORT_SCHEMA, report)
    ? { ...report, complete: report.complete && m.final.stopReason !== 'error' && m.final.stopReason !== 'aborted' }
    : { complete: false, known: [] }
  const cost = usage?.cost?.total
  const errorCode = errorCodeOf(m.final, m.model)
  return {
    runId,
    requestId: m.requestId,
    usageReport,
    ...(typeof usage?.reasoning === 'number' ? { reasoning: count(usage.reasoning) } : {}),
    provider: m.final.provider ?? m.model.provider,
    model: m.final.model ?? m.model.id,
    startedAt: m.startedAt,
    durationMs: m.durationMs,
    ...(m.ttftMs === undefined ? {} : { ttftMs: m.ttftMs }),
    usage: {
      input: count(usage?.input),
      output: count(usage?.output),
      cacheRead: count(usage?.cacheRead),
      cacheWrite: count(usage?.cacheWrite),
      total: count(usage?.totalTokens),
    },
    ...(typeof cost === 'number' && Number.isFinite(cost) && cost >= 0 ? { cost, costBreakdown: usage.cost } : {}),
    stopReason: m.final.stopReason,
    retries: m.retries,
    ...(errorCode ? { errorCode } : {}),
    purpose,
  }
}
