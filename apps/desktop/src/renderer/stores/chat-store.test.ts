import type { ClientMessage, ServerMessage, Session, SessionEntryRecord, Workspace } from '@coko/protocol'
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
  projectId: null,
  pinnedAt: null,
  archivedAt: null,
  title: id,
  model: { providerId: 'faux', modelId: 'faux-1' },
  thinkingLevel: 'off',
  modelCleared: false,
  running: false,
  activity: 'idle',
  createdAt: 1,
  updatedAt: 1,
  ...patch,
})
const entry = (sessionId: string, seq: number, payload: unknown, kind = 'message', runId = 'r1'): SessionEntryRecord => ({
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
    listProjects: async () => [],
    listModels: async () => ({ models: [], defaultModel: null }),
    listWorkspaces: vi.fn<Api['listWorkspaces']>(async () => [workspace]),
    listSessions: vi.fn<Api['listSessions']>(async () => [session('s1')]),
    registerWorkspace: vi.fn<Api['registerWorkspace']>(async () => workspace),
    createSession: vi.fn<Api['createSession']>(async (input) => session('s-new', { title: input.title ?? '' })),
    firstSend: vi.fn<Api['firstSend']>(async (input) => ({
      session: session('s-new', { title: input.text.split('\n')[0]!, model: input.model ?? null, thinkingLevel: input.thinkingLevel ?? 'off' }),
      runId: 'r2',
    })),
    sessionDetail: vi.fn<Api['sessionDetail']>(),
    submitMessage: vi.fn<Api['submitMessage']>(async () => ({ runId: 'r2' })),
    abortRun: vi.fn<Api['abortRun']>(async () => ({ aborted: true })),
    ...overrides,
  } as ApiClient
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

it('首次发送等待中不重复提交，失败保留同一草稿身份和配置，重试成功才清空', async () => {
  let reject!: (error: Error) => void
  const blocked = new Promise<never>((_resolve, fail) => {
    reject = fail
  })
  const firstSend = vi
    .fn<ApiClient['firstSend']>()
    .mockReturnValueOnce(blocked)
    .mockResolvedValue({ session: session('accepted'), runId: 'r1' })
  const failures: ChatFailure[] = []
  const store = createChatStore({ api: fakeApi({ firstSend }), stream: new FakeStream(), onFailure: (failure) => failures.push(failure) })
  store.getState().startDraft()
  await store.getState().selectModel({ providerId: 'p', modelId: 'm' }, 'high')
  await store.getState().setPermissionMode('accept-edits')
  const draft = store.newChat.getState()
  const sending = store.getState().send('preserve this')
  expect(await store.getState().send('duplicate')).toBe(false)
  expect(firstSend).toHaveBeenCalledTimes(1)
  reject(new ApiError('hook-blocked', 'blocked', 400))
  expect(await sending).toBe(false)
  expect(store.newChat.getState()).toMatchObject({
    draftId: draft.draftId,
    model: draft.model,
    thinkingLevel: 'high',
    permissionMode: 'accept-edits',
    sending: false,
  })
  expect(failures[0]?.error.code).toBe('hook-blocked')
  expect(await store.getState().send('preserve this')).toBe(true)
  expect(firstSend.mock.calls.map(([request]) => request.draftId)).toEqual([draft.draftId, draft.draftId])
  expect(store.newChat.getState()).toMatchObject({ model: null, thinkingLevel: 'off', permissionMode: null })
  expect(store.newChat.getState().draftId).not.toBe(draft.draftId)
})

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

  it('不合 schema 的条目在信任边界被跳过，其余条目照常渲染，lastSeq 越过被跳过的条目', async () => {
    const stream = new FakeStream()
    const store = createChatStore({ api: fakeApi(), stream })
    await store.getState().load()
    stream.deliver({ type: 'entry', sessionId: 's1', entry: entry('s1', 1, { trigger: 'submit' }, 'run_start') })
    stream.deliver({ type: 'entry', sessionId: 's1', entry: entry('s1', 2, user('hi')) })
    stream.deliver({ type: 'entry', sessionId: 's1', entry: entry('s1', 3, null) })
    stream.deliver({ type: 'entry', sessionId: 's1', entry: entry('s1', 4, { role: 'assistant', content: 'not blocks', stopReason: 'stop' }) })
    stream.deliver({ type: 'entry', sessionId: 's1', entry: entry('s1', 5, { future: true }, 'kind_from_the_future') })
    stream.deliver({ type: 'entry', sessionId: 's1', entry: entry('s1', 6, assistant([{ type: 'text', text: 'hello' }])) })
    stream.deliver({ type: 'entry', sessionId: 's1', entry: entry('s1', 7, { status: 'finished' }, 'run_end') })
    stream.deliver({ type: 'subscribed', sessionId: 's1', lastSeq: 7, running: true })
    const conversation = store.getState().conversations.s1!
    expect(conversation.entries.map((e) => e.seq)).toEqual([1, 2, 6])
    expect(conversation.lastSeq).toBe(7)
    expect(buildTimeline(conversation).map((i) => [i.kind, 'text' in i ? i.text : null])).toEqual([
      ['user', 'hi'],
      ['text', 'hello'],
      ['generating', null],
    ])
    // 重连时从越过的位置补齐，不再请求被跳过的条目。
    stream.reopen()
    expect(stream.sent.at(-1)).toEqual({ type: 'subscribe', sessionId: 's1', afterSeq: 7 })
  })

  it('订阅补发旧条目不倒退最后记录时间，新条目仍刷新列表', async () => {
    const stream = new FakeStream()
    const api = fakeApi({ listSessions: async () => [session('s1', { updatedAt: 100 })] })
    const store = createChatStore({ api, stream })
    await store.getState().load()
    stream.deliver({ type: 'entry', sessionId: 's1', entry: entry('s1', 1, user('older')) })
    expect(store.lists.getState().sessions[0]?.updatedAt).toBe(100)
    stream.deliver({ type: 'entry', sessionId: 's1', entry: { ...entry('s1', 2, user('newer')), createdAt: 101 } })
    expect(store.lists.getState().sessions[0]?.updatedAt).toBe(101)
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
    expect(store.lists.getState().sessions[0]?.running).toBe(false)
  })

  it('草稿首条消息：创建会话（标题取首行）→ 订阅确认后再提交', async () => {
    const stream = new FakeStream()
    const api = fakeApi({ listSessions: vi.fn<Api['listSessions']>(async () => []) })
    const store = createChatStore({ api, stream })
    await store.getState().load()
    expect(store.getState().activeSessionId).toBeNull()

    const sent = store.getState().send('write a file\nwith details')
    await flush()
    expect(api.firstSend).toHaveBeenCalledWith(expect.objectContaining({ text: 'write a file\nwith details' }))
    expect(stream.sent).toEqual([{ type: 'subscribe', sessionId: 's-new', afterSeq: 0 }])
    expect(api.submitMessage).not.toHaveBeenCalled()
    stream.deliver({ type: 'subscribed', sessionId: 's-new', lastSeq: 0, running: false })
    expect(await sent).toBe(true)
    expect(api.submitMessage).not.toHaveBeenCalled()
    expect(store.getState().activeSessionId).toBe('s-new')
    expect(store.getState().conversations['s-new']?.running).toBe(false)
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

  it('不开始 Run 的动作（204，例如 /goal pause）：返回 true、不报告失败，撤销运行中', async () => {
    const stream = new FakeStream()
    const failures: ChatFailure[] = []
    const api = fakeApi({ submitMessage: vi.fn<Api['submitMessage']>(async () => ({ done: true as const })) })
    const store = createChatStore({ api, stream, onFailure: (f) => failures.push(f) })
    await store.getState().load()
    stream.deliver({ type: 'subscribed', sessionId: 's1', lastSeq: 0, running: false })
    expect(await store.getState().send('/goal pause')).toBe(true)
    expect(failures).toEqual([])
    expect(store.getState().conversations.s1).toMatchObject({ running: false, live: null })
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
    expect(store.lists.getState().sessions[0]?.running).toBe(false)
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
    expect(store.getState().activeSessionId).toBeNull()
    await store.getState().selectModel(deepseek)
    expect(store.newChat.getState().model).toEqual(deepseek)
    expect(api.setSessionModel).not.toHaveBeenCalled()

    const sending = store.getState().send('hello')
    await flush()
    expect(api.firstSend).toHaveBeenCalledWith(expect.objectContaining({ text: 'hello', model: deepseek }))
    stream.deliver({ type: 'subscribed', sessionId: 's-new', lastSeq: 0, running: false })
    await sending

    const other = { providerId: 'p1', modelId: 'deepseek-v4-pro' }
    await store.getState().selectModel(other)
    expect(api.setSessionModel).toHaveBeenCalledWith('s-new', other)
    expect(store.lists.getState().sessions.find((s) => s.id === 's-new')?.model).toEqual(other)
  })

  it('Thinking Level 与模型一起选择：草稿默认 off，选择的档位用于创建会话；打开的会话切换档位经协议写入并按回复更新', async () => {
    const stream = new FakeStream()
    const thinker = { providerId: 'p1', modelId: 'thinker' }
    const api = fakeApi({
      listSessions: vi.fn<Api['listSessions']>(async () => []),
      setSessionModel: vi.fn<Api['setSessionModel']>(async (id, model, thinkingLevel) => session(id, { model, thinkingLevel: thinkingLevel ?? 'off' })),
    })
    const store = createChatStore({ api, stream })
    await store.getState().load()
    expect(store.newChat.getState().thinkingLevel).toBe('off')
    await store.getState().selectModel(thinker, 'high')
    expect(store.newChat.getState()).toMatchObject({ model: thinker, thinkingLevel: 'high' })
    expect(api.setSessionModel).not.toHaveBeenCalled()

    const sending = store.getState().send('hello')
    await flush()
    expect(api.firstSend).toHaveBeenCalledWith(expect.objectContaining({ text: 'hello', model: thinker, thinkingLevel: 'high' }))
    stream.deliver({ type: 'subscribed', sessionId: 's-new', lastSeq: 0, running: false })
    await sending

    await store.getState().selectModel(thinker, 'medium')
    expect(api.setSessionModel).toHaveBeenLastCalledWith('s-new', thinker, 'medium')
    expect(store.lists.getState().sessions.find((s) => s.id === 's-new')).toMatchObject({ model: thinker, thinkingLevel: 'medium' })
  })

  it('切换模型失败时报告 model 失败，会话模型不变', async () => {
    const failures: ChatFailure[] = []
    const api = fakeApi({ setSessionModel: vi.fn<Api['setSessionModel']>(async () => Promise.reject(new ApiError('run-in-progress', 'busy', 409))) })
    const store = createChatStore({ api, stream: new FakeStream(), onFailure: (f) => failures.push(f) })
    await store.getState().load()
    await store.getState().selectModel({ providerId: 'p1', modelId: 'm' })
    expect(failures.map((f) => [f.kind, f.error.code])).toEqual([['model', 'run-in-progress']])
    expect(store.lists.getState().sessions[0]?.model).toEqual({ providerId: 'faux', modelId: 'faux-1' })
  })
})

describe('chat store：M5 的条目与进度', () => {
  it('新 kind 的条目通过信任边界校验、不报错；时间线只给出空组件的分发项，agent_start / agent_end / subagent_origin 不成行', async () => {
    const stream = new FakeStream()
    const store = createChatStore({ api: fakeApi(), stream })
    await store.getState().load()
    const m5: [string, unknown][] = [
      ['hook_run', { event: 'PreToolUse', hookId: 'h', source: 'global', command: 'c', outcome: 'blocked', durationMs: 1 }],
      ['agent_start', { agentId: 's2', agentType: 'explore', description: 'd', background: false, toolCallId: 't' }],
      ['agent_end', { agentId: 's2', status: 'completed', usage: { turns: 1, toolCalls: 0, tokens: 1, cost: 0, durationMs: 1 }, resultChars: 0 }],
      ['agent_notification', { agentIds: ['s2'] }],
      [
        'subagent_origin',
        { parentSessionId: 's0', parentRunId: 'r0', toolCallId: 't', definition: { name: 'general', source: 'builtin', tools: [], maxTurns: 50 } },
      ],
      ['schedule_fire', { scheduleId: 'sc', occurrence: 1, status: 'started', runId: 'r9' }],
      ['handoff', { targetSessionId: 's3', instructions: 'i', summary: 's', target: 'current' }],
      ['handoff_failed', { instructions: 'i', summary: 's', error: { code: 'worktree-exists', message: 'taken' } }],
      ['handoff_origin', { sessionId: 's0', seq: 4 }],
    ]
    m5.forEach(([kind, payload], i) => stream.deliver({ type: 'entry', sessionId: 's1', entry: entry('s1', i + 1, payload, kind) }))
    stream.deliver({
      type: 'entry',
      sessionId: 's1',
      entry: entry('s1', m5.length + 1, { trigger: 'schedule', schedule: { scheduleId: 'sc', occurrence: 1 } }, 'run_start'),
    })
    stream.deliver({ type: 'subscribed', sessionId: 's1', lastSeq: m5.length + 1, running: false })
    const conversation = store.getState().conversations.s1!
    expect(conversation.entries.map((e) => e.kind)).toEqual([...m5.map(([kind]) => kind), 'run_start'])
    expect(buildTimeline(conversation).map((i) => i.kind)).toEqual(['hook', 'agent-notification', 'schedule-fire', 'handoff', 'handoff', 'handoff'])
  })

  it('agent_update 与 schedule_update 进度不使会话进入运行中，照常交给订阅者', async () => {
    const stream = new FakeStream()
    const store = createChatStore({ api: fakeApi(), stream })
    await store.getState().load()
    stream.deliver({ type: 'subscribed', sessionId: 's1', lastSeq: 0, running: false })
    const seen: string[] = []
    store.getState().onProgress((p) => void seen.push(p.event.type))
    stream.deliver({ type: 'progress', sessionId: 's1', runId: 'r1', event: { type: 'agent_update', agentId: 's2', status: 'running' } })
    stream.deliver({
      type: 'progress',
      sessionId: 's1',
      runId: '',
      event: {
        type: 'schedule_update',
        schedule: { id: 'sc', sessionId: 's1', title: 't', prompt: 'p', rule: { kind: 'every', seconds: 60 }, status: 'active', revision: 1 },
      },
    })
    expect(seen).toEqual(['agent_update', 'schedule_update'])
    expect(store.getState().conversations.s1!.running).toBe(false)
    expect(store.lists.getState().sessions.find((s) => s.id === 's1')?.running).toBe(false)
  })

  it('subscribeSession 订阅子 Session 而不切换当前会话；已订阅的不重复订阅', async () => {
    const stream = new FakeStream()
    const store = createChatStore({ api: fakeApi(), stream, subscribeTimeoutMs: 50 })
    await store.getState().load()
    const release = store.getState().subscribeSession('child')
    expect(store.getState().activeSessionId).toBe('s1')
    expect(stream.sent.at(-1)).toEqual({ type: 'subscribe', sessionId: 'child', afterSeq: 0 })
    stream.deliver({ type: 'entry', sessionId: 'child', entry: entry('child', 1, user('task')) })
    stream.deliver({ type: 'subscribed', sessionId: 'child', lastSeq: 1, running: true })
    expect(store.getState().conversations.child).toMatchObject({ status: 'ready', running: true, lastSeq: 1 })
    const sent = stream.sent.length
    const again = store.getState().subscribeSession('child')
    expect(stream.sent.length).toBe(sent)
    again()
    release()
  })

  it('subscribeSession 按引用计数：两次订阅一次释放后仍收到条目；最后一个释放发出 unsubscribe，之后的条目不再进入', async () => {
    const stream = new FakeStream()
    const store = createChatStore({ api: fakeApi(), stream, subscribeTimeoutMs: 50 })
    await store.getState().load()
    const first = store.getState().subscribeSession('child')
    const second = store.getState().subscribeSession('child')
    expect(stream.sent.filter((m) => m.sessionId === 'child')).toEqual([{ type: 'subscribe', sessionId: 'child', afterSeq: 0 }])
    stream.deliver({ type: 'subscribed', sessionId: 'child', lastSeq: 0, running: true })
    first()
    first()
    stream.deliver({ type: 'entry', sessionId: 'child', entry: entry('child', 1, user('still here')) })
    expect(store.getState().conversations.child?.entries.map((e) => e.seq)).toEqual([1])
    expect(stream.sent.some((m) => m.type === 'unsubscribe')).toBe(false)
    second()
    expect(stream.sent.at(-1)).toEqual({ type: 'unsubscribe', sessionId: 'child' })
    stream.deliver({ type: 'entry', sessionId: 'child', entry: entry('child', 2, user('late')) })
    expect(store.getState().conversations.child).toBeUndefined()
    // 重连只重新订阅仍持有的会话。
    stream.reopen()
    expect(stream.sent.filter((m) => m.type === 'subscribe' && m.sessionId === 'child')).toHaveLength(1)
    // 释放后再订阅：重新建立订阅，从头补发。
    const third = store.getState().subscribeSession('child')
    expect(stream.sent.at(-1)).toEqual({ type: 'subscribe', sessionId: 'child', afterSeq: 0 })
    third()
  })

  it('打开过的会话保持订阅：subscribeSession 的释放不退订它', async () => {
    const stream = new FakeStream()
    const store = createChatStore({ api: fakeApi(), stream, subscribeTimeoutMs: 50 })
    await store.getState().load()
    const release = store.getState().subscribeSession('s1')
    release()
    expect(stream.sent.some((m) => m.type === 'unsubscribe')).toBe(false)
    expect(store.getState().conversations.s1).toBeDefined()
    // 先作为子 Session 订阅、再打开：打开后同样保持。
    const child = store.getState().subscribeSession('child')
    store.getState().openSession('child')
    child()
    expect(stream.sent.some((m) => m.type === 'unsubscribe')).toBe(false)
    expect(store.getState().conversations.child).toBeDefined()
  })
})
