// M4 的条目与进度在功能交付前：新 kind 通过信任边界、不报错、不渲染（时间线组件返回 null）；后台任务进度不进入运行中状态，
// 全部 progress 经 onProgress 交给功能 store。
import type { ClientMessage, ProgressEvent, ServerMessage, Session, SessionEntryRecord, Workspace } from '@coko/protocol'
import { describe, expect, it, vi } from 'vitest'
import type { ApiClient } from '../client/api.ts'
import type { StreamClient } from '../client/connection.ts'
import { buildTimeline } from '../features/conversation/timeline.ts'
import { createChatStore } from './chat-store.ts'

class FakeStream implements StreamClient {
  sent: ClientMessage[] = []
  readonly #message = new Set<(message: ServerMessage) => void>()
  send(message: ClientMessage) {
    this.sent.push(message)
    return true
  }
  onOpen() {
    return () => {}
  }
  onMessage(listener: (message: ServerMessage) => void) {
    this.#message.add(listener)
    return () => this.#message.delete(listener)
  }
  deliver(message: ServerMessage) {
    for (const listener of this.#message) listener(message)
  }
}

const workspace: Workspace = { id: 'w1', path: '/tmp/w1', name: 'w1', createdAt: 1 }
const session: Session = {
  id: 's1',
  workspaceId: 'w1',
  projectId: null,
  pinnedAt: null,
  archivedAt: null,
  title: 's1',
  model: { providerId: 'faux', modelId: 'faux-1' },
  thinkingLevel: 'off',
  modelCleared: false,
  running: false,
  activity: 'idle',
  createdAt: 1,
  updatedAt: 1,
}
const record = (seq: number, kind: string, payload: unknown, runId: string | null = 'r1'): SessionEntryRecord => ({
  sessionId: 's1',
  seq,
  kind,
  payloadVersion: 1,
  payload,
  runId,
  createdAt: seq,
})

async function openStore() {
  const stream = new FakeStream()
  const api = {
    listProjects: async () => [],
    listWorkspaces: vi.fn<ApiClient['listWorkspaces']>(async () => [workspace]),
    listSessions: vi.fn<ApiClient['listSessions']>(async () => [session]),
  } as unknown as ApiClient
  const store = createChatStore({ api, stream })
  await store.getState().load()
  stream.deliver({ type: 'subscribed', sessionId: 's1', lastSeq: 0, running: false })
  return { stream, store }
}

const M4_ENTRIES: [string, unknown][] = [
  ['goal', { id: 'g1', revision: 1, objective: 'o', criteria: [{ id: 'c1', text: 'c' }], budget: {}, phase: 'running', resumedAtRound: 0, source: 'user' }],
  ['todo_list', { items: [{ id: 't1', content: 'x', status: 'pending' }] }],
  ['plan', { planId: 'p1', revision: 1, markdown: '# P', status: 'proposed' }],
  ['job_start', { jobId: 'j1', kind: 'bash', label: 'l', command: 'c', toolCallId: 't', logPath: '/l' }],
  ['job_end', { jobId: 'j1', status: 'completed', exitCode: 0, outputBytes: 0, truncated: false }],
  ['job_notification', { jobIds: ['j1'] }],
]

describe('chat store：M4 条目', () => {
  it.each(M4_ENTRIES)('%s 条目通过信任边界进入记录；时间线只有对应的空组件项（todo_list 不进入时间线）', async (kind, payload) => {
    const { stream, store } = await openStore()
    stream.deliver({ type: 'entry', sessionId: 's1', entry: record(1, 'run_start', { trigger: 'goal', goal: { goalId: 'g1', round: 1 } }) })
    stream.deliver({ type: 'entry', sessionId: 's1', entry: record(2, kind, payload) })
    const conversation = store.getState().conversations.s1!
    expect(conversation.entries.map((e) => e.kind)).toEqual(['run_start', kind])
    const expected = kind === 'todo_list' ? [] : [kind.startsWith('job_') ? 'job' : kind]
    expect(buildTimeline(conversation).map((i) => i.kind)).toEqual(expected)
  })

  it('assistant 消息带 usage 的 Run 结束后有 run-usage 项；没有 usage 时没有', async () => {
    const { stream, store } = await openStore()
    const usage = { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 3, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }
    const assistant = (withUsage: boolean) => ({
      role: 'assistant',
      content: [{ type: 'text', text: 'hi' }],
      stopReason: 'stop',
      timestamp: 0,
      ...(withUsage ? { api: 'faux', provider: 'faux', model: 'faux-1', usage } : {}),
    })
    stream.deliver({ type: 'entry', sessionId: 's1', entry: record(1, 'message', assistant(true)) })
    stream.deliver({ type: 'entry', sessionId: 's1', entry: record(2, 'run_end', { status: 'completed' }) })
    stream.deliver({ type: 'entry', sessionId: 's1', entry: record(3, 'message', assistant(false), 'r2') })
    stream.deliver({ type: 'entry', sessionId: 's1', entry: record(4, 'run_end', { status: 'completed' }, 'r2') })
    const items = buildTimeline(store.getState().conversations.s1!)
    expect(items.map((i) => i.kind)).toEqual(['text', 'run-usage', 'text'])
    expect(items[1]).toMatchObject({ kind: 'run-usage', runId: 'r1' })
  })
})

describe('chat store：onProgress', () => {
  it('后台任务进度不进入运行中状态；全部 progress 按到达顺序交给订阅者，取消订阅后不再收到', async () => {
    const { stream, store } = await openStore()
    const seen: [string, string, ProgressEvent['type']][] = []
    const off = store.getState().onProgress(({ sessionId, runId, event }) => seen.push([sessionId, runId, event.type]))
    const job = { type: 'job_output', jobId: 'j1', offset: 0, chunk: 'ok\n' } as const
    stream.deliver({ type: 'progress', sessionId: 's1', runId: 'r0', event: job })
    expect(store.getState().conversations.s1!.running).toBe(false)
    expect(store.lists.getState().sessions[0]!.running).toBe(false)

    stream.deliver({ type: 'progress', sessionId: 's1', runId: 'r1', event: { type: 'run_start' } })
    expect(store.getState().conversations.s1!.running).toBe(true)
    stream.deliver({ type: 'progress', sessionId: 's1', runId: 'r1', event: { type: 'run_end', status: 'completed' } })
    expect(store.getState().conversations.s1!.running).toBe(false)
    // 未打开的会话的进度不交给订阅者（与本 store 一致）。
    stream.deliver({ type: 'progress', sessionId: 's-other', runId: 'r9', event: job })
    expect(seen).toEqual([
      ['s1', 'r0', 'job_output'],
      ['s1', 'r1', 'run_start'],
      ['s1', 'r1', 'run_end'],
    ])
    off()
    stream.deliver({ type: 'progress', sessionId: 's1', runId: 'r0', event: job })
    expect(seen).toHaveLength(3)
  })
})
