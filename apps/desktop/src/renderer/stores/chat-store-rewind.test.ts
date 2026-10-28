// 回退与分叉的 store 行为：rewind 条目折叠有效条目并影响运行状态；回退与分叉经协议发送，目标文本回到输入区，分叉后打开新会话。
import type { ClientMessage, RewindResponse, ServerMessage, Session, SessionEntryRecord } from '@coko/protocol'
import { describe, expect, it, vi } from 'vitest'
import { ApiError, type ApiClient } from '../client/api.ts'
import type { StreamClient } from '../client/connection.ts'
import { canContinue, conversationActivity, createChatStore, visibleEntries, type ChatFailure } from './chat-store.ts'

function fakeStream() {
  const listeners = new Set<(message: ServerMessage) => void>()
  const sent: ClientMessage[] = []
  const stream: StreamClient = {
    send: (message: ClientMessage) => {
      sent.push(message)
      return true
    },
    onOpen: () => () => {},
    onMessage(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  return { stream, sent, deliver: (message: ServerMessage) => listeners.forEach((l) => l(message)) }
}

const session = (id: string, patch: Partial<Session> = {}): Session => ({
  id,
  workspaceId: 'w1',
  title: id,
  model: null,
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
const user = (text: string, runId: string) => entry('message', { role: 'user', content: [{ type: 'text', text }], timestamp: 0 }, runId)

/** 两个 Run：第一个完成，第二个暂停。 */
const history = () => {
  seq = 0
  return [
    entry('run_start', { trigger: 'submit' }, 'r1'),
    user('one', 'r1'), // 2
    entry('message', { role: 'assistant', content: [{ type: 'text', text: 'a1' }], stopReason: 'stop', timestamp: 0 }, 'r1'),
    entry('run_end', { status: 'completed' }, 'r1'),
    entry('run_start', { trigger: 'submit' }, 'r2'),
    user('two', 'r2'), // 6
    entry('run_end', { status: 'paused' }, 'r2'),
  ]
}

const response = (patch: Partial<RewindResponse> = {}): RewindResponse => ({
  targetSeq: 6,
  mode: 'both',
  dryRun: false,
  text: 'two',
  restored: [],
  deleted: [],
  diverged: [],
  untracked: [],
  outside: [],
  skipped: [],
  ...patch,
})

async function setup(overrides: Partial<ApiClient> = {}) {
  const { stream, sent, deliver } = fakeStream()
  const failures: ChatFailure[] = []
  let sessions = [session('s1', { activity: 'paused' })]
  const api = {
    listWorkspaces: async () => [{ id: 'w1', path: '/w1', name: 'w1', createdAt: 1 }],
    listSessions: async () => sessions,
    rewind: vi.fn<ApiClient['rewind']>(async (_id, request) => response({ mode: request.mode, dryRun: request.dryRun ?? false })),
    fork: vi.fn<ApiClient['fork']>(async () => {
      sessions = [session('s2', { title: 's1 (fork)', updatedAt: 2 }), ...sessions]
      return { sessionId: 's2', text: 'two' }
    }),
    ...overrides,
  } as unknown as ApiClient
  const store = createChatStore({ api, stream, onFailure: (f) => failures.push(f) })
  await store.getState().load()
  for (const e of history()) deliver({ type: 'entry', sessionId: 's1', entry: e })
  deliver({ type: 'subscribed', sessionId: 's1', lastSeq: seq, running: false })
  const conversation = (id = 's1') => store.getState().conversations[id]!
  const send = (kind: string, payload: unknown) => deliver({ type: 'entry', sessionId: 's1', entry: entry(kind, payload, null) })
  return { store, api, sent, failures, conversation, send }
}

describe('chat store：回退与分叉', () => {
  it('rewind 条目把 [targetSeq, rewind) 移出有效条目：被回退的暂停 Run 不再显示暂停、不能继续', async () => {
    const h = await setup()
    expect(conversationActivity(h.conversation())).toBe('paused')
    expect(canContinue(h.conversation())).toBe(true)
    h.send('rewind', { targetSeq: 6 })
    // seq 5 是第二个 Run 的 run_start，在目标消息之前，不被回退。
    expect(visibleEntries(h.conversation().entries).map((e) => e.seq)).toEqual([1, 2, 3, 4, 5])
    expect(conversationActivity(h.conversation())).toBe('idle')
    expect(canContinue(h.conversation())).toBe(false)
    expect(h.store.getState().sessions[0]!.activity).toBe('idle')
  })

  it('回退对话或两者：经协议发送，目标文本作为退回的草稿；只回退代码时不退回文本', async () => {
    const h = await setup()
    expect(await h.store.getState().rewind(6, 'both')).toMatchObject({ text: 'two', dryRun: false })
    expect(h.api.rewind).toHaveBeenCalledWith('s1', { targetSeq: 6, mode: 'both' })
    expect(h.conversation().returnedDraft).toBe('two')
    h.store.getState().takeReturnedDraft('s1')
    await h.store.getState().rewind(6, 'code')
    expect(h.conversation().returnedDraft).toBeUndefined()
  })

  it('预览回退：dryRun，不退回文本；失败报告 rewind 并返回 undefined', async () => {
    const rewind = vi.fn<ApiClient['rewind']>().mockRejectedValueOnce(new ApiError('session-busy', 'busy', 409))
    const h = await setup({ rewind })
    expect(await h.store.getState().previewRewind(6, 'code')).toBeUndefined()
    expect(h.failures.map((f) => [f.kind, f.error.code])).toEqual([['rewind', 'session-busy']])
    rewind.mockResolvedValueOnce(response({ dryRun: true, restored: ['/w1/a.txt'] }))
    expect(await h.store.getState().previewRewind(6, 'code')).toMatchObject({ restored: ['/w1/a.txt'] })
    expect(rewind).toHaveBeenLastCalledWith('s1', { targetSeq: 6, mode: 'code', dryRun: true })
    expect(h.conversation().returnedDraft).toBeUndefined()
  })

  it('分叉：新会话进入列表并打开、订阅，目标文本放入其输入区；原会话不变', async () => {
    const h = await setup()
    const before = h.conversation().entries.length
    expect(await h.store.getState().fork(6)).toBe(true)
    expect(h.api.fork).toHaveBeenCalledWith('s1', 6)
    expect(h.store.getState().activeSessionId).toBe('s2')
    expect(h.store.getState().sessions.map((s) => s.id)).toEqual(['s2', 's1'])
    expect(h.conversation('s2').returnedDraft).toBe('two')
    expect(h.sent).toContainEqual({ type: 'subscribe', sessionId: 's2', afterSeq: 0 })
    expect(h.conversation('s1').entries).toHaveLength(before)
  })

  it('分叉失败：报告 fork，当前会话不变', async () => {
    const h = await setup({ fork: vi.fn<ApiClient['fork']>(async () => Promise.reject(new ApiError('confirmation-pending', 'wait', 409))) })
    expect(await h.store.getState().fork(6)).toBe(false)
    expect(h.store.getState().activeSessionId).toBe('s1')
    expect(h.failures.map((f) => [f.kind, f.error.code])).toEqual([['fork', 'confirmation-pending']])
  })
})
