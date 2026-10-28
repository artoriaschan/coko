import type { ClientMessage, ServerMessage, Session, SessionEntry, Workspace } from '@coko/protocol'
import { describe, expect, it, vi } from 'vitest'
import { ApiError, type ApiClient } from '../client/api.ts'
import type { StreamClient } from '../client/connection.ts'
import { buildTimeline } from '../features/conversation/timeline.ts'
import { createChatStore, type ChatFailure } from './chat-store.ts'

class FakeStream implements StreamClient {
  sent: ClientMessage[] = []
  open = true
  readonly #open = new Set<(reconnected: boolean) => void>()
  readonly #message = new Set<(message: ServerMessage) => void>()
  send(message: ClientMessage) {
    if (!this.open) return false
    this.sent.push(message)
    return true
  }
  onOpen(listener: (reconnected: boolean) => void) {
    this.#open.add(listener)
    return () => this.#open.delete(listener)
  }
  onMessage(listener: (message: ServerMessage) => void) {
    this.#message.add(listener)
    return () => this.#message.delete(listener)
  }
  deliver(message: ServerMessage) {
    for (const listener of this.#message) listener(message)
  }
  reopen() {
    this.open = true
    for (const listener of this.#open) listener(true)
  }
}

const workspace: Workspace = { id: 'w1', path: '/tmp/w1', name: 'w1', createdAt: 1 }
const session = (id: string, patch: Partial<Session> = {}): Session => ({
  id,
  workspaceId: 'w1',
  title: id,
  model: { providerId: 'faux', modelId: 'faux-1' },
  running: false,
  createdAt: 1,
  updatedAt: 1,
  ...patch,
})
const entry = (sessionId: string, seq: number, payload: unknown, kind = 'message', runId = 'r1'): SessionEntry => ({
  sessionId,
  seq,
  kind,
  payloadVersion: 1,
  payload,
  runId,
  createdAt: seq,
})
const user = (text: string) => ({ role: 'user', content: text, timestamp: 0 })
const assistant = (content: unknown[]) => ({ role: 'assistant', content, stopReason: 'stop', timestamp: 0 })

type Api = ApiClient

function fakeApi(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    listWorkspaces: vi.fn<Api['listWorkspaces']>(async () => [workspace]),
    listSessions: vi.fn<Api['listSessions']>(async () => [session('s1')]),
    registerWorkspace: vi.fn<Api['registerWorkspace']>(async () => workspace),
    createSession: vi.fn<Api['createSession']>(async (input) => session('s-new', { title: input.title ?? '' })),
    sessionDetail: vi.fn<Api['sessionDetail']>(),
    submitMessage: vi.fn<Api['submitMessage']>(async () => ({ runId: 'r2' })),
    abortRun: vi.fn<Api['abortRun']>(async () => ({ aborted: true })),
    ...overrides,
  } as ApiClient
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('chat store', () => {
  it('加载后打开最近的会话并以 afterSeq 0 订阅；补发与实时条目按 seq 去重', async () => {
    const stream = new FakeStream()
    const store = createChatStore({ api: fakeApi(), stream })
    await store.getState().load()
    expect(store.getState().activeSessionId).toBe('s1')
    expect(stream.sent).toEqual([{ type: 'subscribe', sessionId: 's1', afterSeq: 0 }])

    stream.deliver({ type: 'entry', sessionId: 's1', entry: entry('s1', 1, user('hi')) })
    stream.deliver({ type: 'entry', sessionId: 's1', entry: entry('s1', 2, assistant([{ type: 'text', text: 'hello' }])) })
    stream.deliver({ type: 'entry', sessionId: 's1', entry: entry('s1', 2, assistant([{ type: 'text', text: 'hello' }])) })
    stream.deliver({ type: 'subscribed', sessionId: 's1', lastSeq: 2, running: false })
    const conversation = store.getState().conversations.s1!
    expect(conversation.status).toBe('ready')
    expect(conversation.entries.map((e) => e.seq)).toEqual([1, 2])
    expect(buildTimeline(conversation).map((i) => [i.kind, 'text' in i ? i.text : null])).toEqual([
      ['user', 'hi'],
      ['text', 'hello'],
    ])
  })

  it('重连后按 lastSeq 重新订阅；中断期间缺头的文本增量不显示，下一条 assistant 条目后恢复接收', async () => {
    const stream = new FakeStream()
    const store = createChatStore({ api: fakeApi({ listSessions: vi.fn<Api['listSessions']>(async () => [session('s1', { running: true })]) }), stream })
    await store.getState().load()
    stream.deliver({ type: 'entry', sessionId: 's1', entry: entry('s1', 1, user('go')) })
    stream.deliver({ type: 'subscribed', sessionId: 's1', lastSeq: 1, running: true })
    // 订阅时 Run 已在进行：前面的增量已错过，不显示半截文本。
    stream.deliver({ type: 'progress', sessionId: 's1', runId: 'r1', event: { type: 'assistant_delta', kind: 'text', contentIndex: 0, delta: 'lf way' } })
    expect(buildTimeline(store.getState().conversations.s1!).map((i) => i.kind)).toEqual(['user', 'generating'])

    stream.deliver({
      type: 'entry',
      sessionId: 's1',
      entry: entry(
        's1',
        2,
        assistant([
          { type: 'text', text: 'half way' },
          { type: 'toolCall', id: 't1', name: 'bash', arguments: { command: 'ls' } },
        ]),
      ),
    })
    stream.deliver({
      type: 'progress',
      sessionId: 's1',
      runId: 'r1',
      event: { type: 'tool_start', toolCallId: 't1', toolName: 'bash', args: { command: 'ls' } },
    })

    stream.open = false
    stream.reopen()
    expect(stream.sent.at(-1)).toEqual({ type: 'subscribe', sessionId: 's1', afterSeq: 2 })
    stream.deliver({
      type: 'entry',
      sessionId: 's1',
      entry: entry('s1', 3, { role: 'toolResult', toolCallId: 't1', toolName: 'bash', content: [{ type: 'text', text: 'a.txt' }], isError: false }),
    })
    stream.deliver({ type: 'subscribed', sessionId: 's1', lastSeq: 3, running: true })
    stream.deliver({ type: 'progress', sessionId: 's1', runId: 'r1', event: { type: 'assistant_delta', kind: 'text', contentIndex: 0, delta: 'Do' } })
    expect(buildTimeline(store.getState().conversations.s1!).at(-1)?.kind).toBe('generating')

    stream.deliver({ type: 'entry', sessionId: 's1', entry: entry('s1', 4, assistant([{ type: 'text', text: 'Done' }])) })
    stream.deliver({ type: 'progress', sessionId: 's1', runId: 'r1', event: { type: 'assistant_delta', kind: 'text', contentIndex: 0, delta: 'More' } })
    const items = buildTimeline(store.getState().conversations.s1!)
    expect(items.at(-1)).toMatchObject({ kind: 'text', text: 'More', streaming: true })
    expect(items.find((i) => i.kind === 'tool')).toMatchObject({ status: 'done', result: { text: 'a.txt' } })

    stream.deliver({ type: 'entry', sessionId: 's1', entry: entry('s1', 5, { status: 'completed' }, 'run_end') })
    expect(store.getState().conversations.s1).toMatchObject({ running: false, live: null })
    expect(store.getState().sessions[0]?.running).toBe(false)
  })

  it('草稿首条消息：创建会话（标题取首行）→ 订阅确认后再提交', async () => {
    const stream = new FakeStream()
    const api = fakeApi({ listSessions: vi.fn<Api['listSessions']>(async () => []) })
    const store = createChatStore({ api, stream })
    await store.getState().load()
    expect(store.getState().draftWorkspaceId).toBe('w1')

    const sent = store.getState().send('write a file\nwith details')
    await flush()
    expect(api.createSession).toHaveBeenCalledWith({ workspaceId: 'w1', title: 'write a file' })
    expect(stream.sent).toEqual([{ type: 'subscribe', sessionId: 's-new', afterSeq: 0 }])
    expect(api.submitMessage).not.toHaveBeenCalled()
    stream.deliver({ type: 'subscribed', sessionId: 's-new', lastSeq: 0, running: false })
    expect(await sent).toBe(true)
    expect(api.submitMessage).toHaveBeenCalledWith('s-new', 'write a file\nwith details')
    expect(store.getState().activeSessionId).toBe('s-new')
    expect(store.getState().conversations['s-new']?.running).toBe(true)
  })

  it('Run 在 202 返回前已结束（run_end 先到）时不再显示运行中', async () => {
    const stream = new FakeStream()
    let respond!: () => void
    const api = fakeApi({
      submitMessage: vi.fn<Api['submitMessage']>(() => new Promise<{ runId: string }>((resolve) => (respond = () => resolve({ runId: 'r9' })))),
    })
    const store = createChatStore({ api, stream })
    await store.getState().load()
    stream.deliver({ type: 'subscribed', sessionId: 's1', lastSeq: 0, running: false })
    const sent = store.getState().send('fast')
    await flush()
    stream.deliver({ type: 'entry', sessionId: 's1', entry: entry('s1', 1, user('fast'), 'message', 'r9') })
    stream.deliver({
      type: 'entry',
      sessionId: 's1',
      entry: entry('s1', 2, { status: 'error', error: { code: 'model_error', message: 'x' } }, 'run_end', 'r9'),
    })
    respond()
    expect(await sent).toBe(true)
    expect(store.getState().conversations.s1).toMatchObject({ running: false, live: null })
    expect(buildTimeline(store.getState().conversations.s1!).at(-1)).toMatchObject({ kind: 'error', retryable: true })
  })

  it('提交失败返回 false 并报告协议错误码；出错的 Run 可重试', async () => {
    const stream = new FakeStream()
    const failures: ChatFailure[] = []
    const api = fakeApi({
      submitMessage: vi.fn<Api['submitMessage']>(async () => {
        throw new ApiError('model-not-configured', 'No model', 409)
      }),
    })
    const store = createChatStore({ api, stream, onFailure: (f) => failures.push(f) })
    await store.getState().load()
    expect(await store.getState().send('hi')).toBe(false)
    expect(failures).toMatchObject([{ kind: 'send', error: { code: 'model-not-configured' } }])

    stream.deliver({ type: 'entry', sessionId: 's1', entry: entry('s1', 1, user('try this')) })
    stream.deliver({ type: 'entry', sessionId: 's1', entry: entry('s1', 2, { status: 'error', error: { code: 'model_error', message: 'boom' } }, 'run_end') })
    expect(buildTimeline(store.getState().conversations.s1!).at(-1)).toEqual({ kind: 'error', key: '2', message: 'boom', retryable: true })
  })

  it('重试调用 retry 接口重新执行上一轮，不再提交用户文本', async () => {
    const stream = new FakeStream()
    const api = fakeApi({ retryRun: vi.fn<Api['retryRun']>(async () => ({ runId: 'r2' })) })
    const store = createChatStore({ api, stream })
    await store.getState().load()
    stream.deliver({ type: 'subscribed', sessionId: 's1', lastSeq: 0, running: false })
    stream.deliver({ type: 'entry', sessionId: 's1', entry: entry('s1', 1, user('try this')) })
    stream.deliver({ type: 'entry', sessionId: 's1', entry: entry('s1', 2, { status: 'error', error: { code: 'model_error', message: 'boom' } }, 'run_end') })
    expect(await store.getState().retry()).toBe(true)
    expect(api.retryRun).toHaveBeenCalledWith('s1')
    expect(api.submitMessage).not.toHaveBeenCalled()
    expect(store.getState().conversations.s1?.running).toBe(true)
  })

  it('run_end 条目提交失败时，run_end progress 结束运行中状态并显示错误', async () => {
    const stream = new FakeStream()
    const store = createChatStore({ api: fakeApi(), stream })
    await store.getState().load()
    stream.deliver({ type: 'subscribed', sessionId: 's1', lastSeq: 0, running: false })
    await store.getState().send('go')
    stream.deliver({ type: 'progress', sessionId: 's1', runId: 'r2', event: { type: 'run_start' } })
    stream.deliver({ type: 'entry', sessionId: 's1', entry: entry('s1', 1, user('go'), 'message', 'r2') })
    stream.deliver({
      type: 'progress',
      sessionId: 's1',
      runId: 'r2',
      event: { type: 'run_end', status: 'error', error: { code: 'commit_failed', message: 'host lease was taken over' } },
    })
    expect(store.getState().conversations.s1).toMatchObject({ running: false, live: null })
    expect(store.getState().sessions[0]?.running).toBe(false)
    expect(buildTimeline(store.getState().conversations.s1!).at(-1)).toMatchObject({ kind: 'error', message: 'host lease was taken over', retryable: false })
  })

  it('run_end 条目已到达时，随后的 run_end progress 不重复显示结束状态', async () => {
    const stream = new FakeStream()
    const store = createChatStore({ api: fakeApi(), stream })
    await store.getState().load()
    stream.deliver({ type: 'subscribed', sessionId: 's1', lastSeq: 0, running: false })
    stream.deliver({ type: 'entry', sessionId: 's1', entry: entry('s1', 1, user('go')) })
    stream.deliver({ type: 'entry', sessionId: 's1', entry: entry('s1', 2, { status: 'aborted' }, 'run_end') })
    stream.deliver({ type: 'progress', sessionId: 's1', runId: 'r1', event: { type: 'run_end', status: 'aborted' } })
    expect(store.getState().conversations.s1).toMatchObject({ running: false, live: null })
    expect(buildTimeline(store.getState().conversations.s1!).map((i) => i.kind)).toEqual(['user', 'stopped'])
  })

  it('草稿中选择的模型用于创建会话；打开的会话切换模型经协议写入并更新列表', async () => {
    const stream = new FakeStream()
    const deepseek = { providerId: 'p1', modelId: 'deepseek-flash' }
    const api = fakeApi({
      listSessions: vi.fn<Api['listSessions']>(async () => []),
      setSessionModel: vi.fn<Api['setSessionModel']>(async (id, model) => session(id, { model })),
    })
    const store = createChatStore({ api, stream })
    await store.getState().load()
    expect(store.getState().draftWorkspaceId).toBe('w1')
    await store.getState().selectModel(deepseek)
    expect(store.getState().draftModel).toEqual(deepseek)
    expect(api.setSessionModel).not.toHaveBeenCalled()

    const sending = store.getState().send('hello')
    await flush()
    expect(api.createSession).toHaveBeenCalledWith({ workspaceId: 'w1', title: 'hello', model: deepseek })
    stream.deliver({ type: 'subscribed', sessionId: 's-new', lastSeq: 0, running: false })
    await sending

    const other = { providerId: 'p1', modelId: 'deepseek-v4-pro' }
    await store.getState().selectModel(other)
    expect(api.setSessionModel).toHaveBeenCalledWith('s-new', other)
    expect(store.getState().sessions.find((s) => s.id === 's-new')?.model).toEqual(other)
  })

  it('切换模型失败时报告 model 失败，会话模型不变', async () => {
    const failures: ChatFailure[] = []
    const api = fakeApi({ setSessionModel: vi.fn<Api['setSessionModel']>(async () => Promise.reject(new ApiError('run-in-progress', 'busy', 409))) })
    const store = createChatStore({ api, stream: new FakeStream(), onFailure: (f) => failures.push(f) })
    await store.getState().load()
    await store.getState().selectModel({ providerId: 'p1', modelId: 'm' })
    expect(failures.map((f) => [f.kind, f.error.code])).toEqual([['model', 'run-in-progress']])
    expect(store.getState().sessions[0]?.model).toEqual({ providerId: 'faux', modelId: 'faux-1' })
  })
})
