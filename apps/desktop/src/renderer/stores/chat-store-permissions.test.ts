// Permission Mode 与 Session 规则的 store 行为：模式由条目派生并乐观显示，失败时撤回；草稿中选的模式在创建 Session 后生效。
import type { ClientMessage, ServerMessage, Session, SessionEntryRecord } from '@coko/protocol'
import { describe, expect, it, vi } from 'vitest'
import { ApiError, type ApiClient } from '../client/api.ts'
import type { StreamClient } from '../client/connection.ts'
import { createChatStore, sessionPermissionMode, sessionRules, type ChatFailure } from './chat-store.ts'

function fakeStream() {
  const listeners = new Set<(message: ServerMessage) => void>()
  const sent: ClientMessage[] = []
  const stream: StreamClient = {
    send: (message) => {
      sent.push(message)
      if (message.type === 'subscribe') queueMicrotask(() => deliver({ type: 'subscribed', sessionId: message.sessionId, lastSeq: 0, running: false }))
      return true
    },
    onOpen: () => () => {},
    onMessage(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  const deliver = (message: ServerMessage) => listeners.forEach((l) => l(message))
  return { stream, deliver, sent }
}

const session = (id: string): Session => ({
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
})
let seq = 0
const entry = (sessionId: string, kind: string, payload: unknown): SessionEntryRecord => ({
  sessionId,
  seq: ++seq,
  kind,
  payloadVersion: 1,
  payload,
  runId: null,
  createdAt: seq,
})

async function setup(overrides: Partial<ApiClient> = {}) {
  seq = 0
  const { stream, deliver } = fakeStream()
  const failures: ChatFailure[] = []
  const calls: string[] = []
  const api = {
    listProjects: async () => [],
    listModels: async () => ({ models: [], defaultModel: null }),
    listWorkspaces: async () => [{ id: 'w1', path: '/w1', name: 'w1', createdAt: 1 }],
    listSessions: async () => [session('s1')],
    setPermissionMode: vi.fn<ApiClient['setPermissionMode']>(async (id, mode) => {
      calls.push(`mode:${id}:${mode}`)
      return { mode, rules: [] }
    }),
    createSession: vi.fn<ApiClient['createSession']>(async () => session('s-new')),
    firstSend: async (input: Parameters<ApiClient['firstSend']>[0]) => {
      calls.push(`first:${input.permissionMode}`)
      return { session: session('s-new'), runId: 'r1' }
    },
    submitMessage: vi.fn<ApiClient['submitMessage']>(async (id) => {
      calls.push(`submit:${id}`)
      return { runId: 'r1' }
    }),
    ...overrides,
  } as unknown as ApiClient
  const store = createChatStore({ api, stream, onFailure: (f) => failures.push(f) })
  await store.getState().load()
  const send = (sessionId: string, kind: string, payload: unknown) => deliver({ type: 'entry', sessionId, entry: entry(sessionId, kind, payload) })
  const mode = (id = 's1') => {
    const c = store.getState().conversations[id]!
    return c.pendingMode ?? sessionPermissionMode(c.entries)
  }
  return { store, api, send, failures, calls, mode }
}

describe('Permission Mode（store）', () => {
  it('退出计划在服务端接受前保持 plan，拒绝后也不移除计划状态', async () => {
    let reject!: (error: Error) => void
    const { store, send, mode, failures } = await setup({
      setPermissionMode: () =>
        new Promise((_resolve, no) => {
          reject = no
        }),
    })
    send('s1', 'permission_mode', { mode: 'plan', prior: 'accept-edits' })
    const changing = store.getState().setPermissionMode('accept-edits')
    expect(mode()).toBe('plan')
    await vi.waitFor(() => expect(reject).toBeTypeOf('function'))
    reject(new Error('offline'))
    await changing
    expect(mode()).toBe('plan')
    expect(failures[0]?.kind).toBe('permissions')
  })
  it('模式取最后一条 permission_mode 条目，没有时为 default', async () => {
    const { send, mode } = await setup()
    expect(mode()).toBe('default')
    send('s1', 'permission_mode', { mode: 'accept-edits' })
    expect(mode()).toBe('accept-edits')
  })

  it('切换立即显示；条目到达后以条目为准；请求失败时撤回并报告', async () => {
    let fail = false
    const { store, send, mode, failures } = await setup({
      setPermissionMode: vi.fn<ApiClient['setPermissionMode']>(async (_id, next) => {
        if (fail) throw new ApiError('network', 'down', 0)
        return { mode: next, rules: [] }
      }),
    })
    const pending = store.getState().setPermissionMode('read-only')
    expect(mode()).toBe('read-only')
    send('s1', 'permission_mode', { mode: 'read-only' })
    await pending
    expect(store.getState().conversations.s1!.pendingMode).toBeUndefined()
    expect(mode()).toBe('read-only')

    fail = true
    await store.getState().setPermissionMode('full-access')
    expect(mode()).toBe('read-only')
    expect(failures.map((f) => f.kind)).toEqual(['permissions'])
  })

  it('连续切换按调用顺序发送，最后一次为准', async () => {
    const { store, calls, mode } = await setup()
    void store.getState().setPermissionMode('read-only')
    void store.getState().setPermissionMode('accept-edits')
    await store.getState().setPermissionMode('default')
    expect(calls).toEqual(['mode:s1:read-only', 'mode:s1:accept-edits', 'mode:s1:default'])
    expect(mode()).toBe('default')
  })

  it('草稿中选的模式随首次发送原子提交', async () => {
    const { store, calls } = await setup()
    store.getState().startDraft('w1')
    await store.getState().setPermissionMode('accept-edits')
    expect(store.newChat.getState().permissionMode).toBe('accept-edits')
    expect(calls).toEqual([])
    expect(await store.getState().send('hello')).toBe(true)
    expect(calls).toEqual(['first:accept-edits'])
    expect(store.newChat.getState().permissionMode).toBeNull()
  })

  it('Session 规则按 permission_rule 条目回放', () => {
    const records = [
      entry('s1', 'permission_rule', { op: 'add', rule: { behavior: 'allow', tool: 'Bash', content: 'npm test' } }),
      entry('s1', 'permission_rule', { op: 'add', rule: { behavior: 'deny', tool: 'Read', content: '.env' } }),
      entry('s1', 'permission_rule', { op: 'remove', rule: { behavior: 'allow', tool: 'Bash', content: 'npm test' } }),
    ]
    expect(sessionRules(records as never)).toEqual([{ behavior: 'deny', tool: 'Read', content: '.env' }])
  })
})
