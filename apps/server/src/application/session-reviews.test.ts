// SessionReviews（ADR 0029）：被取消或超时的审查请求，已报告的用量照样记入其 model_request（Goal 预算与用量汇总从它派生）；
// 没有可用模型时不读条目、不发请求、不记 model_request，直接以 no-model 转交。其余失败（超时、报错、输出无效）另经真实 Sidecar 覆盖，
// 见 tests/integration/sidecar-auto-review.test.ts。
import { describe, expect, it, vi } from 'vitest'
import { createAssistantMessageEventStream, type AssistantMessage, type Model } from '@earendil-works/pi-ai'
import type { ModelRegistry } from '@coko/agent'
import type { SessionStore, Session as StoredSession } from '@coko/session'
import { createTestClock } from '../adapters/clock.ts'
import { SessionReviews, type SessionReviewsOptions } from './session-reviews.ts'

const model = { id: 'm', provider: 'p', api: 'faux', contextWindow: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } } as Model<any>
const partial: AssistantMessage = {
  role: 'assistant',
  content: [],
  api: 'faux',
  provider: 'p',
  model: 'm',
  usage: { input: 300, output: 7, cacheRead: 0, cacheWrite: 0, totalTokens: 307, cost: { input: 0.3, output: 0.07, cacheRead: 0, cacheWrite: 0, total: 0.37 } },
  stopReason: 'stop',
  timestamp: 0,
}

function setup() {
  const clock = createTestClock(1_000)
  const commits: { kind: string; payload: Record<string, unknown> }[] = []
  let started!: () => void
  const streaming = new Promise<void>((resolve) => (started = resolve))
  const registry = {
    models: {
      // 报告了用量的部分响应之后不再结束（Provider 没有响应中止）。
      streamSimple: () => {
        const stream = createAssistantMessageEventStream()
        stream.push({ type: 'start', partial })
        queueMicrotask(started)
        return stream
      },
    },
  } as unknown as ModelRegistry
  const session = { id: 's1', model: { providerId: 'p', modelId: 'm' } } as unknown as StoredSession
  const reviews = new SessionReviews({
    store: { sessions: { getSession: async () => session, listEntries: async () => [] } } as unknown as SessionStore,
    models: { contextModel: async () => model },
    registry,
    clock,
    runtimes: { commit: async (_id: string, entry: { kind: string; payload: Record<string, unknown> }) => void commits.push(entry) } as never,
    rootSessionId: (id) => id,
  })
  const review = (signal?: AbortSignal) =>
    reviews.review({
      sessionId: session.id,
      request: { runId: 'r1', toolCallId: 't1', toolName: 'bash', input: { command: 'ls' }, priorCalls: [] },
      ...(signal ? { signal } : {}),
    })
  return { clock, commits, streaming, review }
}

describe('SessionReviews 的用量', () => {
  it('被取消的审查请求：已报告的用量记入 model_request', async () => {
    const { commits, streaming, review } = setup()
    const controller = new AbortController()
    const outcome = review(controller.signal)
    await streaming
    controller.abort()
    expect(await outcome).toEqual({ verdict: 'failed', code: 'request-failed' })
    expect(commits).toHaveLength(1)
    expect(commits[0]!.payload).toMatchObject({ runId: 'r1', purpose: 'review', stopReason: 'aborted', usage: { input: 300, output: 7 }, cost: 0.37 })
  })

  it('超时的审查请求：已报告的用量记入 model_request，errorCode 为 timeout', async () => {
    const { clock, commits, streaming, review } = setup()
    const outcome = review()
    await streaming
    clock.advance(15_000)
    expect(await outcome).toEqual({ verdict: 'failed', code: 'timeout' })
    expect(commits[0]!.payload).toMatchObject({ purpose: 'review', errorCode: 'timeout', usage: { input: 300, output: 7 }, cost: 0.37 })
  })
})

const request = { runId: 'run1', toolCallId: 'b1', toolName: 'bash', input: { command: 'ls' }, priorCalls: [] }

it.each([
  ['Session 的模型不可用', { id: 's1', model: { providerId: 'gone', modelId: 'm' } }, undefined],
  ['子 Session 的根 Session 已清空模型', { id: 'child', parentSessionId: 'root' }, { id: 'root', modelCleared: true }],
])('%s：返回 no-model，不发审查请求也不记 model_request', async (_name, session, root) => {
  const streamSimple = vi.fn<() => never>()
  const commit = vi.fn<SessionReviewsOptions['runtimes']['commit']>()
  const listEntries = vi.fn<() => Promise<never[]>>(async () => [])
  const contextModel = vi.fn<() => Promise<undefined>>(async () => undefined)
  const reviews = new SessionReviews({
    store: { sessions: { getSession: async (id: string) => (id === session.id ? session : root), listEntries } } as unknown as SessionStore,
    models: { contextModel },
    registry: { models: { streamSimple } } as unknown as ModelRegistry,
    clock: { now: () => 0, setTimer: () => () => {} },
    runtimes: { commit },
    rootSessionId: () => root?.id ?? session.id,
  })
  expect(await reviews.review({ sessionId: session.id, request })).toEqual({ verdict: 'failed', code: 'no-model' })
  expect([streamSimple.mock.calls, commit.mock.calls, listEntries.mock.calls]).toEqual([[], [], []])
  // 根 Session 清空了模型时不再解析它的模型引用。
  expect(contextModel.mock.calls.length).toBe(root ? 0 : 1)
})

it('子 Session 的审查使用根 Session 的模型，不用子 Session（子代理定义）的模型；model_request 记在子 Session', async () => {
  const rootModel = { ...model, id: 'root-model' } as Model<any>
  const contextModel = vi.fn<SessionReviewsOptions['models']['contextModel']>(async (ref) => (ref?.modelId === 'root-model' ? rootModel : model))
  const streamSimple = vi.fn<(used: Model<any>) => ReturnType<typeof createAssistantMessageEventStream>>((used) => {
    const stream = createAssistantMessageEventStream()
    const final: AssistantMessage = { ...partial, model: used.id, content: [{ type: 'text', text: '{"decision":"allow","reason":"ok"}' }] }
    queueMicrotask(() => stream.push({ type: 'done', reason: 'stop', message: final }))
    return stream
  })
  const commit = vi.fn<SessionReviewsOptions['runtimes']['commit']>(async () => ({}) as never)
  const root = { id: 'root', model: { providerId: 'p', modelId: 'root-model' } }
  const reviews = new SessionReviews({
    store: { sessions: { getSession: async () => root, listEntries: async () => [] } } as unknown as SessionStore,
    models: { contextModel },
    registry: { models: { streamSimple } } as unknown as ModelRegistry,
    clock: { now: () => 0, setTimer: () => () => {} },
    runtimes: { commit },
    rootSessionId: () => 'root',
  })
  expect(await reviews.review({ sessionId: 'child', request })).toEqual({ verdict: 'allow', reason: 'ok' })
  expect(contextModel.mock.calls).toEqual([[root.model]])
  expect(streamSimple.mock.calls[0]![0]).toBe(rootModel)
  expect(commit.mock.calls.map(([id, entry]) => [id, (entry.payload as { model: string }).model])).toEqual([['child', 'root-model']])
})

it('切换模型后再审查：使用 Session 当前（已存储）的模型，不用 Run 创建时的模型', async () => {
  const contextModel = vi.fn<SessionReviewsOptions['models']['contextModel']>(async (ref) => ({ ...model, id: ref!.modelId }) as Model<any>)
  const streamSimple = vi.fn<(used: Model<any>) => ReturnType<typeof createAssistantMessageEventStream>>((used) => {
    const stream = createAssistantMessageEventStream()
    const final: AssistantMessage = { ...partial, model: used.id, content: [{ type: 'text', text: '{"decision":"allow","reason":"ok"}' }] }
    queueMicrotask(() => stream.push({ type: 'done', reason: 'stop', message: final }))
    return stream
  })
  const stored = { id: 's1', model: { providerId: 'p', modelId: 'switched' } }
  const reviews = new SessionReviews({
    store: { sessions: { getSession: async (id: string) => (id === 's1' ? stored : undefined), listEntries: async () => [] } } as unknown as SessionStore,
    models: { contextModel },
    registry: { models: { streamSimple } } as unknown as ModelRegistry,
    clock: { now: () => 0, setTimer: () => () => {} },
    runtimes: { commit: async () => ({}) as never },
    rootSessionId: (id) => id,
  })
  expect(await reviews.review({ sessionId: 's1', request })).toEqual({ verdict: 'allow', reason: 'ok' })
  expect(contextModel.mock.calls).toEqual([[stored.model]])
  expect(streamSimple.mock.calls[0]![0].id).toBe('switched')
})
