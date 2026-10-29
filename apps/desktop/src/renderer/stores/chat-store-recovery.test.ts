// 恢复后的 store 行为：重启后补发的条目派生出待确认与中断，回答只发一次，确认后 activity 回到 interrupted。
import type { ClientMessage, ServerMessage, Session, SessionEntryRecord } from '@coko/protocol'
import { describe, expect, it, vi } from 'vitest'
import { ApiError, type ApiClient } from '../client/api.ts'
import type { StreamClient } from '../client/connection.ts'
import { canContinue, continueMode, conversationActivity, createChatStore, pendingConfirmations, type ChatFailure } from './chat-store.ts'

function fakeStream() {
  const listeners = new Set<(message: ServerMessage) => void>()
  const stream: StreamClient = {
    send: (_message: ClientMessage) => true,
    onOpen: () => () => {},
    onMessage(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  return { stream, deliver: (message: ServerMessage) => listeners.forEach((l) => l(message)) }
}

const session = (id: string, patch: Partial<Session> = {}): Session => ({
  id,
  workspaceId: 'w1',
  title: id,
  model: null,
  thinkingLevel: 'off',
  modelCleared: false,
  running: false,
  activity: 'idle',
  createdAt: 1,
  updatedAt: 1,
  ...patch,
})
let seq = 0
const entry = (kind: string, payload: unknown, runId: string | null = 'r1'): SessionEntryRecord => ({
  sessionId: 's1',
  seq: ++seq,
  kind,
  payloadVersion: 1,
  payload,
  runId,
  createdAt: seq,
})
const toolCall = {
  role: 'assistant',
  content: [{ type: 'toolCall', id: 'b1', name: 'bash', arguments: { command: 'sleep 30; touch done' } }],
  stopReason: 'toolUse',
  timestamp: 0,
}
const toolResult = (text: string) => ({
  role: 'toolResult',
  toolCallId: 'b1',
  toolName: 'bash',
  content: [{ type: 'text', text }],
  isError: true,
  timestamp: 0,
})

/** 恢复后的会话：中断的 Run 与一条待确认。 */
const recovered = () => {
  seq = 0
  return [
    entry('run_start', { trigger: 'submit' }),
    entry('message', { role: 'user', content: [{ type: 'text', text: 'run it' }], timestamp: 0 }),
    entry('message', toolCall),
    entry('tool_exec', { toolCallId: 'b1', toolName: 'bash', idempotencyKey: 's1:b1' }),
    entry('confirmation_request', { toolCallId: 'b1' }),
    entry('run_end', { status: 'interrupted' }),
  ]
}

async function setup(overrides: Partial<ApiClient> = {}) {
  const { stream, deliver } = fakeStream()
  const failures: ChatFailure[] = []
  const api = {
    listWorkspaces: async () => [{ id: 'w1', path: '/w1', name: 'w1', createdAt: 1 }],
    listSessions: async () => [session('s1', { activity: 'awaiting-confirmation' })],
    answerConfirmation: vi.fn<ApiClient['answerConfirmation']>(async () => undefined),
    continueRun: vi.fn<ApiClient['continueRun']>(async () => ({ runId: 'r2' })),
    ...overrides,
  } as unknown as ApiClient
  const store = createChatStore({ api, stream, onFailure: (f) => failures.push(f) })
  await store.getState().load()
  for (const e of recovered()) deliver({ type: 'entry', sessionId: 's1', entry: e })
  deliver({ type: 'subscribed', sessionId: 's1', lastSeq: seq, running: false })
  const conversation = () => store.getState().conversations.s1!
  const activity = () => store.getState().sessions.find((s) => s.id === 's1')!.activity
  const send = (kind: string, payload: unknown) => deliver({ type: 'entry', sessionId: 's1', entry: entry(kind, payload) })
  return { store, api, failures, conversation, activity, send }
}

describe('chat store：恢复与结果确认', () => {
  it('补发的条目派生待确认：pendingConfirmations 带调用信息，activity awaiting-confirmation，不能继续', async () => {
    const h = await setup()
    expect(pendingConfirmations(h.conversation().entries)).toMatchObject([
      { toolCallId: 'b1', toolName: 'bash', arguments: { command: 'sleep 30; touch done' } },
    ])
    expect(conversationActivity(h.conversation())).toBe('awaiting-confirmation')
    expect(h.activity()).toBe('awaiting-confirmation')
    expect(canContinue(h.conversation())).toBe(false)
  })

  it('回答确认：同一调用只发送一次；条目到达后 activity 为 interrupted，可以继续', async () => {
    const h = await setup()
    const [first, second] = await Promise.all([
      h.store.getState().answerConfirmation('b1', 'not-applied'),
      h.store.getState().answerConfirmation('b1', 'applied'),
    ])
    expect([first, second]).toEqual([true, true])
    expect(h.api.answerConfirmation).toHaveBeenCalledTimes(1)
    expect(h.api.answerConfirmation).toHaveBeenCalledWith('s1', 'b1', 'not-applied')
    h.send('confirmation_answer', { toolCallId: 'b1', answer: 'not-applied' })
    h.send('message', toolResult('Not applied (confirmed by the user): …'))
    expect(pendingConfirmations(h.conversation().entries)).toEqual([])
    expect(h.activity()).toBe('interrupted')
    expect(canContinue(h.conversation())).toBe(true)
  })

  it('回答失败：报告 confirmation 失败并允许重答；已不在等待（404）时不再重发', async () => {
    const answerConfirmation = vi
      .fn<ApiClient['answerConfirmation']>()
      .mockRejectedValueOnce(new ApiError('network', 'down', 0))
      .mockRejectedValueOnce(new ApiError('not-found', 'gone', 404))
    const h = await setup({ answerConfirmation })
    expect(await h.store.getState().answerConfirmation('b1', 'applied')).toBe(false)
    expect(await h.store.getState().answerConfirmation('b1', 'applied')).toBe(false)
    expect(await h.store.getState().answerConfirmation('b1', 'applied')).toBe(true)
    expect(answerConfirmation).toHaveBeenCalledTimes(2)
    expect(h.failures.map((f) => [f.kind, f.error.code])).toEqual([
      ['confirmation', 'network'],
      ['confirmation', 'not-found'],
    ])
  })

  it('中断但最后一条是 assistant 文本（没有可继续的调用或用户消息）时不能继续；paused 同样适用', () => {
    seq = 0
    const base = [entry('run_start', { trigger: 'submit' }), entry('message', { role: 'user', content: 'hi', timestamp: 0 })]
    const ended = (status: string, extra: SessionEntryRecord[] = []) =>
      ({ entries: [...base, ...extra, entry('run_end', { status })], running: false }) as never
    expect(canContinue(ended('interrupted'))).toBe(true)
    expect(canContinue(ended('paused'))).toBe(true)
    expect(
      canContinue(ended('interrupted', [entry('message', { role: 'assistant', content: [{ type: 'text', text: 'done' }], stopReason: 'stop', timestamp: 0 })])),
    ).toBe(false)
    expect(canContinue(ended('completed'))).toBe(false)
  })

  it('最后一条是 assistant 文本时横幅仍可继续：以一条新的用户消息继续（prompt），否则沿用 continue（resume）', () => {
    seq = 0
    const base = [entry('run_start', { trigger: 'submit' }), entry('message', { role: 'user', content: 'hi', timestamp: 0 })]
    const ended = (status: string, extra: SessionEntryRecord[] = []) =>
      ({ entries: [...base, ...extra, entry('run_end', { status })], running: false }) as never
    const text = entry('message', { role: 'assistant', content: [{ type: 'text', text: 'half way' }], stopReason: 'stop', timestamp: 0 })
    expect(continueMode(ended('interrupted'))).toBe('resume')
    expect(continueMode(ended('interrupted', [text]))).toBe('prompt')
    expect(continueMode(ended('paused', [text]))).toBe('prompt')
    expect(continueMode(ended('completed', [text]))).toBeUndefined()
  })

  it('prompt 方式的继续提交给定的文本（界面传入本地化的"继续"），不调用 continue', async () => {
    seq = 0
    const submitMessage = vi.fn<ApiClient['submitMessage']>(async () => ({ runId: 'r2' }))
    const h = await setup({ submitMessage })
    h.send('confirmation_answer', { toolCallId: 'b1', answer: 'applied' })
    h.send('message', toolResult('Applied (confirmed by the user): …'))
    h.send('message', { role: 'assistant', content: [{ type: 'text', text: 'half way' }], stopReason: 'stop', timestamp: 0 })
    expect(continueMode(h.conversation())).toBe('prompt')
    expect(await h.store.getState().continueRun('Continue')).toBe(true)
    expect(submitMessage).toHaveBeenCalledWith('s1', 'Continue')
    expect(h.api.continueRun).not.toHaveBeenCalled()
  })
})
