// 运行控制的 store 行为：追加指令的待送达状态、送达后转为普通消息、未送达退回输入区、暂停与继续。
import type { ClientMessage, ServerMessage, Session, SessionEntryRecord } from '@coko/protocol'
import { describe, expect, it, vi } from 'vitest'
import { ApiError, type ApiClient } from '../client/api.ts'
import type { StreamClient } from '../client/connection.ts'
import { buildTimeline } from '../features/conversation/timeline.ts'
import { createChatStore, type ChatFailure } from './chat-store.ts'

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
  running: false,
  activity: 'idle',
  createdAt: 1,
  updatedAt: 1,
  ...patch,
})
let seq = 0
const entry = (kind: string, payload: unknown, runId = 'r1'): SessionEntryRecord => ({
  sessionId: 's1',
  seq: ++seq,
  kind,
  payloadVersion: 1,
  payload,
  runId,
  createdAt: seq,
})
const user = (text: string) => ({ role: 'user', content: [{ type: 'text', text }], timestamp: 0 })
const toolCall = (id: string) => ({
  role: 'assistant',
  content: [{ type: 'toolCall', id, name: 'bash', arguments: { command: 'sleep 1' } }],
  stopReason: 'toolUse',
  timestamp: 0,
})
const toolResult = (id: string) => ({
  role: 'toolResult',
  toolCallId: id,
  toolName: 'bash',
  content: [{ type: 'text', text: 'ok' }],
  isError: false,
  timestamp: 0,
})

async function setup(overrides: Partial<ApiClient> = {}) {
  seq = 0
  const { stream, deliver } = fakeStream()
  const failures: ChatFailure[] = []
  const api = {
    listWorkspaces: async () => [{ id: 'w1', path: '/w1', name: 'w1', createdAt: 1 }],
    listSessions: async () => [session('s1', { running: true, activity: 'running' })],
    steerRun: vi.fn<ApiClient['steerRun']>(async () => undefined),
    pauseRun: vi.fn<ApiClient['pauseRun']>(async () => undefined),
    continueRun: vi.fn<ApiClient['continueRun']>(async () => ({ runId: 'r2' })),
    ...overrides,
  } as unknown as ApiClient
  const store = createChatStore({ api, stream, onFailure: (f) => failures.push(f) })
  await store.getState().load()
  const send = (kind: string, payload: unknown, runId?: string) => deliver({ type: 'entry', sessionId: 's1', entry: entry(kind, payload, runId) })
  send('run_start', { trigger: 'submit' })
  send('message', user('start'))
  send('message', toolCall('b1'))
  deliver({ type: 'subscribed', sessionId: 's1', lastSeq: seq, running: true })
  const conversation = () => store.getState().conversations.s1!
  const timeline = () => buildTimeline(conversation())
  const activity = () => store.getState().sessions.find((s) => s.id === 's1')!.activity
  return { store, send, deliver, failures, api, conversation, timeline, activity }
}

describe('chat store：运行控制', () => {
  it('Run 中 steer：先显示为待送达，送达（user 条目到达）后转为普通消息', async () => {
    const h = await setup()
    expect(await h.store.getState().steer('also README')).toBe(true)
    expect(h.api.steerRun).toHaveBeenCalledWith('s1', 'also README')
    expect(h.timeline().filter((i) => i.kind === 'user' || i.kind === 'steering')).toMatchObject([
      { kind: 'user', text: 'start' },
      { kind: 'steering', text: 'also README' },
    ])

    h.send('message', toolResult('b1'))
    h.send('message', user('also README'))
    expect(h.timeline().filter((i) => i.kind === 'user' || i.kind === 'steering')).toMatchObject([
      { kind: 'user', text: 'start' },
      { kind: 'user', text: 'also README' },
    ])
    h.send('run_end', { status: 'completed' })
    expect(h.conversation().returnedDraft).toBeUndefined()
  })

  it('停止后未送达的追加指令回到输入区（returnedDraft），待送达气泡消失', async () => {
    const h = await setup()
    await h.store.getState().steer('first')
    await h.store.getState().steer('second')
    h.send('run_end', { status: 'aborted', undeliveredSteering: ['first', 'second'] })
    expect(h.timeline().some((i) => i.kind === 'steering')).toBe(false)
    expect(h.conversation().returnedDraft).toBe('first\nsecond')
    h.store.getState().takeReturnedDraft('s1')
    expect(h.conversation().returnedDraft).toBeUndefined()
  })

  it('其他窗口的未送达文本不退回本窗口；重放历史 run_end 不退回', async () => {
    const h = await setup()
    h.send('run_end', { status: 'aborted', undeliveredSteering: ['from elsewhere'] })
    expect(h.conversation().returnedDraft).toBeUndefined()
  })

  it('steer 失败：待送达撤回、返回 false 保留输入，并报告失败', async () => {
    const h = await setup({ steerRun: vi.fn<ApiClient['steerRun']>(async () => Promise.reject(new ApiError('no-active-run', 'none', 409))) })
    expect(await h.store.getState().steer('late')).toBe(false)
    expect(h.timeline().some((i) => i.kind === 'steering')).toBe(false)
    expect(h.failures.map((f) => [f.kind, f.error.code])).toEqual([['steer', 'no-active-run']])
  })

  it('pause：请求中标记 pausing；run_end paused 后会话 activity 为 paused，时间线显示已暂停；continue 发起新 Run', async () => {
    const h = await setup()
    await h.store.getState().pause()
    expect(h.api.pauseRun).toHaveBeenCalledWith('s1')
    expect(h.conversation().pausing).toBe(true)
    h.send('message', toolResult('b1'))
    h.send('run_end', { status: 'paused' })
    expect(h.conversation()).toMatchObject({ running: false, pausing: false })
    expect(h.activity()).toBe('paused')
    expect(h.timeline().at(-1)).toMatchObject({ kind: 'paused' })

    expect(await h.store.getState().continueRun()).toBe(true)
    expect(h.api.continueRun).toHaveBeenCalledWith('s1')
    expect(h.conversation().running).toBe(true)
    h.deliver({ type: 'progress', sessionId: 's1', runId: 'r2', event: { type: 'run_start' } })
    expect(h.activity()).toBe('running')
  })

  it('continue 被拒（nothing-to-continue）：撤销乐观的运行中状态并报告', async () => {
    const h = await setup({ continueRun: vi.fn<ApiClient['continueRun']>(async () => Promise.reject(new ApiError('nothing-to-continue', 'no', 409))) })
    h.send('run_end', { status: 'paused' })
    expect(await h.store.getState().continueRun()).toBe(false)
    expect(h.conversation().running).toBe(false)
    expect(h.failures.map((f) => [f.kind, f.error.code])).toEqual([['continue', 'nothing-to-continue']])
  })
})
