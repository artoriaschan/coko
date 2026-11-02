// 审批的 store 行为：待审批请求由条目派生，回答只发送一次，Session.activity 随条目更新。
import type { ClientMessage, ServerMessage, Session, SessionEntryRecord } from '@coko/protocol'
import { describe, expect, it, vi } from 'vitest'
import { ApiError, type ApiClient } from '../client/api.ts'
import type { StreamClient } from '../client/connection.ts'
import { buildTimeline } from '../features/conversation/timeline.ts'
import { sortSessions } from '../features/sidebar/sidebar-lists.tsx'
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
  projectId: null,
  pinnedAt: null,
  archivedAt: null,
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
const entry = (kind: string, payload: unknown, runId = 'r1'): SessionEntryRecord => ({
  sessionId: 's1',
  seq: ++seq,
  kind,
  payloadVersion: 1,
  payload,
  runId,
  createdAt: seq,
})
const toolCall = (id: string) => ({
  role: 'assistant',
  content: [{ type: 'toolCall', id, name: 'bash', arguments: { command: 'ls' } }],
  stopReason: 'toolUse',
  timestamp: 0,
})
const request = (requestId: string, toolCallId: string) => ({ requestId, toolCallId, toolName: 'bash', kind: 'tool', subject: 'ls', suggestions: [] })

async function setup(answerApproval: ApiClient['answerApproval'] = vi.fn<ApiClient['answerApproval']>(async () => undefined)) {
  seq = 0
  const { stream, deliver } = fakeStream()
  const failures: ChatFailure[] = []
  const api = {
    listProjects: async () => [],
    listWorkspaces: async () => [{ id: 'w1', path: '/w1', name: 'w1', createdAt: 1 }],
    listSessions: async () => [
      session('s1', { running: true, activity: 'running', updatedAt: 1 }),
      session('s2', { running: true, activity: 'running', updatedAt: 5 }),
    ],
    answerApproval,
  } as unknown as ApiClient
  const store = createChatStore({ api, stream, onFailure: (f) => failures.push(f) })
  await store.getState().load()
  const send = (kind: string, payload: unknown, runId?: string) => deliver({ type: 'entry', sessionId: 's1', entry: entry(kind, payload, runId) })
  send('run_start', { trigger: 'submit' })
  send('message', toolCall('b1'))
  deliver({ type: 'subscribed', sessionId: 's1', lastSeq: seq, running: true })
  const activity = () => store.lists.getState().sessions.find((s) => s.id === 's1')!.activity
  const tool = () => buildTimeline(store.getState().conversations.s1!).find((i) => i.kind === 'tool')
  return { store, send, failures, activity, tool, answerApproval }
}

describe('chat store：审批', () => {
  it('approval_request 让会话进入 awaiting-approval、工具卡为 awaiting；决定后恢复 running，工具卡记录决定', async () => {
    const h = await setup()
    expect(h.activity()).toBe('running')
    h.send('approval_request', request('q1', 'b1'))
    expect(h.activity()).toBe('awaiting-approval')
    expect(h.tool()).toMatchObject({ status: 'awaiting', approval: { request: { requestId: 'q1' }, decision: null } })
    // 侧栏按最后记录时间排序，审批状态不再使会话上浮。
    expect(sortSessions(h.store.lists.getState().sessions).map((s) => s.id)).toEqual(['s2', 's1'])

    h.send('approval_decision', { requestId: 'q1', outcome: 'allowed', scope: 'once' })
    expect(h.activity()).toBe('running')
    expect(h.tool()).toMatchObject({ status: 'running', approval: { decision: { outcome: 'allowed', scope: 'once' } } })
    h.send('run_end', { status: 'completed' })
    expect(h.activity()).toBe('idle')
  })

  it('Run 结束后没有决定的请求不再待审批，工具卡为未完成', async () => {
    const h = await setup()
    h.send('approval_request', request('q1', 'b1'))
    h.send('run_end', { status: 'interrupted' })
    // activity 按上一 Run 的结束状态派生（interrupted / paused 不是 idle）。
    expect(h.activity()).toBe('interrupted')
    expect(h.tool()).toMatchObject({ status: 'pending' })
  })

  it('同一请求只发送一次回答；失败后可再次回答；approval-not-pending 后不再重答', async () => {
    let fail: ApiError | undefined = new ApiError('network', 'down', 0)
    const answer = vi.fn<ApiClient['answerApproval']>(async () => {
      if (fail) throw fail
    })
    const h = await setup(answer)
    h.send('approval_request', request('q1', 'b1'))
    expect(await h.store.getState().answerApproval('q1', { decision: 'allow', scope: 'once' })).toBe(false)
    expect(h.failures.map((f) => [f.kind, f.error.code])).toEqual([['approval', 'network']])

    fail = undefined
    const first = h.store.getState().answerApproval('q1', { decision: 'allow', scope: 'once' })
    const second = h.store.getState().answerApproval('q1', { decision: 'allow', scope: 'once' })
    expect(await Promise.all([first, second])).toEqual([true, true])
    expect(answer).toHaveBeenCalledTimes(2)
    expect(answer).toHaveBeenLastCalledWith('s1', 'q1', { decision: 'allow', scope: 'once' })

    h.send('approval_request', request('q2', 'b1'))
    fail = new ApiError('approval-not-pending', 'gone', 409)
    expect(await h.store.getState().answerApproval('q2', { decision: 'deny' })).toBe(false)
    expect(await h.store.getState().answerApproval('q2', { decision: 'deny' })).toBe(true)
    expect(answer).toHaveBeenCalledTimes(3)
  })
})
