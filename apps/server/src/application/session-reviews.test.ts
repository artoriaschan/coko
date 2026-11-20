// SessionReviews 的“没有可用模型”：不读条目、不发请求、不记 model_request，直接以 no-model 转交（ADR 0029）。
// 其余失败（超时、报错、输出无效）经真实 Sidecar 覆盖，见 tests/integration/sidecar-auto-review.test.ts。
import type { ModelRegistry } from '@coko/agent'
import type { Session, SessionStore } from '@coko/session'
import { expect, it, vi } from 'vitest'
import { SessionReviews, type SessionReviewsOptions } from './session-reviews.ts'

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
    store: { sessions: { getSession: async () => root, listEntries } } as unknown as SessionStore,
    models: { contextModel },
    registry: { models: { streamSimple } } as unknown as ModelRegistry,
    clock: { now: () => 0, setTimer: () => () => {} },
    runtimes: { commit },
    rootSessionId: () => root?.id ?? session.id,
  })
  expect(await reviews.review({ session: session as unknown as Session, request })).toEqual({ verdict: 'failed', code: 'no-model' })
  expect([streamSimple.mock.calls, commit.mock.calls, listEntries.mock.calls]).toEqual([[], [], []])
  // 根 Session 清空了模型时不再解析它的模型引用。
  expect(contextModel.mock.calls.length).toBe(root ? 0 : 1)
})
