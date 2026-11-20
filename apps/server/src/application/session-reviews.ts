// 自动审查的 Reviewer 端口实现（ADR 0029）：取根 Session 的模型、读条目、构建输入、请求前检查、发一次不带工具的请求（超时中止）、
// 记 purpose review 的 model_request、解析结论。只回答“是否放行”；是否送审由权限 gate 决定。
import { randomUUID } from 'node:crypto'
import {
  buildReviewInput,
  captureRequestSnapshot,
  modelRequestPayload,
  parseReviewOutput,
  REVIEW_MAX_TOKENS,
  REVIEW_SYSTEM_PROMPT,
  REVIEW_TIMEOUT_MS,
  type BeforeRequestState,
  type ModelRegistry,
  type RequestStop,
  type ReviewFailureCode,
  type ReviewOutcome,
  type ReviewRequest,
} from '@coko/agent'
import { getLogger, redactSecretsDeep } from '@coko/logging'
import type { SessionModel } from '@coko/protocol'
import type { Session as StoredSession, SessionStore } from '@coko/session'
import type { AssistantMessage, Model } from '@earendil-works/pi-ai'
import type { ClockPort } from '../adapters/clock.ts'
import type { SessionRuntimes } from './session-runtimes.ts'

const log = getLogger(['application', 'reviews'])

export interface SessionReviewsOptions {
  store: SessionStore
  models: { contextModel(model: SessionModel | null | undefined): Promise<Model<any> | undefined> }
  registry: ModelRegistry
  clock: ClockPort
  runtimes: Pick<SessionRuntimes, 'commit'>
  /** 子 Session 的根 Session（ADR 0014）；根 Session 为自身。 */
  rootSessionId: (sessionId: string) => string
}

export class SessionReviews {
  readonly #options: SessionReviewsOptions
  constructor(options: SessionReviewsOptions) {
    this.#options = options
  }

  async review(options: {
    session: StoredSession
    request: ReviewRequest
    signal?: AbortSignal
    /** 与对话请求相同的请求前检查（Goal 预算）；返回 stop 时不发请求、转交用户，不停止 Run。 */
    beforeRequest?: (state: BeforeRequestState) => Promise<void | RequestStop>
  }): Promise<ReviewOutcome> {
    const startedAt = this.#options.clock.now()
    const outcome = await this.#review(options)
    log.info('review finished', {
      durationMs: Math.max(0, this.#options.clock.now() - startedAt),
      outcome: outcome.verdict,
      ...(outcome.verdict === 'failed' ? { code: outcome.code } : {}),
    })
    return outcome
  }

  async #review({ session, request, signal, beforeRequest }: Parameters<SessionReviews['review']>[0]): Promise<ReviewOutcome> {
    const { store, registry, clock, runtimes } = this.#options
    const failed = (code: ReviewFailureCode): ReviewOutcome => ({ verdict: 'failed', code })
    const rootId = this.#options.rootSessionId(session.id)
    const root = rootId === session.id ? session : await store.sessions.getSession(rootId)
    const model = root && !root.modelCleared ? await this.#options.models.contextModel(root.model) : undefined
    if (!model) return failed('no-model')

    let entries, rootEntries
    try {
      entries = await store.sessions.listEntries(session.id)
      rootEntries = rootId === session.id ? undefined : await store.sessions.listEntries(rootId)
    } catch {
      return failed('request-failed')
    }
    const input = buildReviewInput({
      entries,
      ...(rootEntries ? { rootEntries } : {}),
      call: { toolName: request.toolName, input: request.input, ...(request.description === undefined ? {} : { description: request.description }) },
      priorCalls: request.priorCalls,
    })
    if ('tooLong' in input) return failed('too-long')
    const messages = redactSecretsDeep([{ role: 'user' as const, content: input.text, timestamp: clock.now() }])
    const context = { systemPrompt: REVIEW_SYSTEM_PROMPT, messages }
    const snapshot = captureRequestSnapshot(context)
    if (beforeRequest && (await beforeRequest({ runId: request.runId, messages, model, ...(signal ? { signal } : {}) }))) return failed('budget')

    // 本次请求自己的中止：Run 的停止或暂停（signal）与超时。失败不重试（不经运行时的 withRetry）。
    const controller = new AbortController()
    const onAbort = () => controller.abort()
    if (signal?.aborted) controller.abort()
    else signal?.addEventListener('abort', onAbort, { once: true })
    const requestStartedAt = clock.now()
    let timedOut = false
    const cancelTimer = clock.setTimer(requestStartedAt + REVIEW_TIMEOUT_MS, () => {
      timedOut = true
      controller.abort()
    })
    const aborted = new Promise<undefined>((resolve) => {
      if (controller.signal.aborted) resolve(undefined)
      else controller.signal.addEventListener('abort', () => resolve(undefined), { once: true })
    })
    let final: AssistantMessage | undefined
    try {
      const pending = Promise.resolve().then(() =>
        registry.models.streamSimple(model, context, { signal: controller.signal, toolChoice: 'none', maxTokens: REVIEW_MAX_TOKENS }).result(),
      )
      final = await Promise.race([pending, aborted])
    } catch {
      // Provider 的错误可能回显输入或凭据：只保留可机读的结果。
    } finally {
      cancelTimer()
      signal?.removeEventListener('abort', onAbort)
    }
    const payload = modelRequestPayload(request.runId, 'review', {
      requestId: randomUUID(),
      model,
      startedAt: requestStartedAt,
      durationMs: Math.max(0, clock.now() - requestStartedAt),
      retries: 0,
      final: final ?? {
        role: 'assistant',
        content: [],
        api: model.api,
        provider: model.provider,
        model: model.id,
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: controller.signal.aborted ? 'aborted' : 'error',
        timestamp: clock.now(),
      },
      snapshot,
    })
    if (timedOut) payload.errorCode = 'timeout'
    // 提交失败时抛给 gate（按 request-failed 转交）。
    await runtimes.commit(session.id, { kind: 'model_request', runId: request.runId, payload })

    if (signal?.aborted) return failed('request-failed')
    if (timedOut) return failed('timeout')
    if (!final || final.stopReason === 'error' || final.stopReason === 'aborted') return failed('request-failed')
    if (final.stopReason !== 'stop') return failed('invalid-output')
    const raw = final.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('')
    // 先替换 Secret 再截断（parseReviewOutput 截到上限），跨截断点的 Secret 也不会留下前半段；JSON 转义过的 Secret 由解析后的再次替换处理。
    const parsed = parseReviewOutput(redactSecretsDeep(raw))
    return parsed ? { verdict: parsed.verdict, reason: redactSecretsDeep(parsed.reason) } : failed('invalid-output')
  }
}
