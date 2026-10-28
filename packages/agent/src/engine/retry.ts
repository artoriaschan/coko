import type { StreamFn } from '@earendil-works/pi-agent-core'
import {
  createAssistantMessageEventStream,
  isContextOverflow,
  isRetryableAssistantError,
  retryDelayMs,
  type AssistantMessage,
  type AssistantMessageEvent,
} from '@earendil-works/pi-ai'

export interface RetryPolicy {
  /** Retries after the first attempt; 0 disables retrying. */
  maxRetries: number
  baseDelayMs: number
  maxDelayMs?: number
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = { maxRetries: 3, baseDelayMs: 2_000, maxDelayMs: 60_000 }

export interface RetryNotice {
  attempt: number
  maxRetries: number
  delayMs: number
  errorMessage: string
}

function sleep(ms: number, signal: AbortSignal | undefined): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve(false)
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve(true)
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      resolve(false)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

const isContentEvent = (event: AssistantMessageEvent) => event.type !== 'start' && event.type !== 'done' && event.type !== 'error'

/**
 * Retry transient provider errors (pi-ai's classifier, context overflow excluded) with bounded
 * exponential backoff. Only attempts that failed before streaming any content are retried, so the
 * transcript and the client never see a discarded partial reply. The returned stream emits a single
 * `start` and the final attempt's events.
 */
export function withRetry(inner: StreamFn, policy: RetryPolicy, onRetry?: (notice: RetryNotice) => void): StreamFn {
  return (model, context, options) => {
    const out = createAssistantMessageEventStream()
    const signal = options?.signal
    void (async () => {
      let final: AssistantMessage | undefined
      try {
        for (let attempt = 0; ; attempt++) {
          const stream = await inner(model, context, options)
          const pending: AssistantMessageEvent[] = []
          let forwarding = false
          let terminal: AssistantMessageEvent | undefined
          for await (const event of stream) {
            if (forwarding) {
              out.push(event)
              continue
            }
            if (event.type === 'error' || event.type === 'done') {
              terminal = event
              break
            }
            pending.push(event)
            if (isContentEvent(event)) {
              forwarding = true
              for (const buffered of pending) out.push(buffered)
            }
          }
          final = await stream.result()
          if (forwarding) return
          const retryable =
            terminal?.type === 'error' &&
            terminal.reason === 'error' &&
            attempt < policy.maxRetries &&
            !signal?.aborted &&
            !isContextOverflow(final, model.contextWindow) &&
            isRetryableAssistantError(final)
          if (!retryable) {
            for (const buffered of pending) out.push(buffered)
            if (terminal) out.push(terminal)
            return
          }
          const delayMs = retryDelayMs(
            { baseDelayMs: policy.baseDelayMs, ...(policy.maxDelayMs === undefined ? {} : { maxAgentDelayMs: policy.maxDelayMs }) },
            attempt + 1,
          )
          onRetry?.({ attempt: attempt + 1, maxRetries: policy.maxRetries, delayMs, errorMessage: final.errorMessage ?? '' })
          if (!(await sleep(delayMs, signal))) {
            final = { ...final, stopReason: 'aborted', errorMessage: 'Request was aborted' }
            out.push({ type: 'error', reason: 'aborted', error: final })
            return
          }
        }
      } catch (error) {
        final = {
          role: 'assistant',
          content: [],
          api: model.api,
          provider: model.provider,
          model: model.id,
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
          stopReason: 'error',
          errorMessage: error instanceof Error ? error.message : String(error),
          timestamp: Date.now(),
        }
        out.push({ type: 'error', reason: 'error', error: final })
      } finally {
        out.end(final)
      }
    })()
    return out
  }
}
