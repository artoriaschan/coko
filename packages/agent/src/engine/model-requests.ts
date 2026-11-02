// 逐请求记录：每次模型请求（含重试后的最终一次）的耗时、首个增量的时间与重试次数，提交为 model_request 条目。
import type { StreamFn } from '@earendil-works/pi-agent-core'
import { createAssistantMessageEventStream, isContextOverflow, type AssistantMessage, type Model } from '@earendil-works/pi-ai'
import type { ModelRequestPayload, ModelRequestPurpose } from '../session-entries/index.ts'

/** 一次已结束的请求的测量（尚不知用途与 runId）。 */
export interface RequestMeasurement {
  model: Model<any>
  startedAt: number
  durationMs: number
  ttftMs?: number
  retries: number
  final: AssistantMessage
}

export interface RequestMeter {
  /** 包装请求流（在重试之外：耗时含重试的等待）。 */
  wrap(inner: StreamFn): StreamFn
  /** 重试之前调用（withRetry 的 onRetry）：计入当前请求的 retries。 */
  retried(): void
  /** 取走最近结束的请求的测量；请求串行，取走后清空。 */
  take(): RequestMeasurement | undefined
}

const elapsedMs = (from: number) => Math.ceil(performance.now() - from)

export function createRequestMeter(now: () => number = Date.now): RequestMeter {
  let retries = 0
  let last: RequestMeasurement | undefined
  return {
    wrap: (inner) => (model, context, options) => {
      const out = createAssistantMessageEventStream()
      const startedAt = now()
      const started = performance.now()
      retries = 0
      last = undefined
      let ttftMs: number | undefined
      const measure = (final: AssistantMessage): RequestMeasurement => ({
        model,
        startedAt,
        durationMs: elapsedMs(started),
        ...(ttftMs === undefined ? {} : { ttftMs }),
        retries,
        final,
      })
      void (async () => {
        const stream = await inner(model, context, options)
        // 测量在终止事件转发之前记下：消费方（pi）在收到它之后才结束这一轮，取走时测量已经存在。
        for await (const event of stream) {
          if (ttftMs === undefined && (event.type === 'text_delta' || event.type === 'toolcall_delta')) ttftMs = elapsedMs(started)
          if (event.type === 'done') last = measure(event.message)
          if (event.type === 'error') last = measure(event.error)
          out.push(event)
        }
        const final = await stream.result()
        last ??= measure(final)
        out.end(final)
      })()
      return out
    },
    retried: () => {
      retries++
    },
    take: () => {
      const taken = last
      last = undefined
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
  const cost = usage?.cost?.total
  const errorCode = errorCodeOf(m.final, m.model)
  return {
    runId,
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
    ...(typeof cost === 'number' && Number.isFinite(cost) && cost >= 0 ? { cost } : {}),
    stopReason: m.final.stopReason,
    retries: m.retries,
    ...(errorCode ? { errorCode } : {}),
    purpose,
  }
}
