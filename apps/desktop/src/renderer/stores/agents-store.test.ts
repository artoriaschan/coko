// 子代理 store：agent_update 合并进列表（新子代理与结束时读回）、较早的列表不覆盖已结束的状态、停止的 409、子 Session 审批只回答一次，
// 以及 HTTP 后端的 schema 校验。
import type { AgentSnapshot, ProgressEvent } from '@coko/protocol'
import { describe, expect, it } from 'vitest'
import { ApiError } from '../client/api.ts'
import { createAgentsStore, httpAgentsBackend, type AgentsBackend } from './agents-store.ts'

const snapshot = (agentId: string, patch: Partial<AgentSnapshot> = {}): AgentSnapshot => ({
  agentId,
  agentType: 'explore',
  description: `desc ${agentId}`,
  status: 'running',
  background: false,
  startedAt: 1,
  ...patch,
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

function source() {
  const listeners = new Set<(p: { sessionId: string; runId: string; event: ProgressEvent }) => void>()
  return {
    onProgress(listener: (p: { sessionId: string; runId: string; event: ProgressEvent }) => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    emit(sessionId: string, event: ProgressEvent) {
      for (const l of listeners) l({ sessionId, runId: 'r', event })
    },
    get size() {
      return listeners.size
    },
  }
}

function backend(lists: AgentSnapshot[][]) {
  const calls = { list: 0, cancel: [] as string[], answer: [] as string[] }
  const b: AgentsBackend = {
    list: async () => lists[Math.min(calls.list++, lists.length - 1)]!,
    cancel: async (_s, agentId) => void calls.cancel.push(agentId),
    definitions: async () => ({ definitions: [], diagnostics: [] }),
    answer: async (sessionId, requestId) => void calls.answer.push(`${sessionId}:${requestId}`),
  }
  return { b, calls }
}

describe('agents store', () => {
  it('agent_update：未知的子代理读回列表；状态变化即时合并，结束时再读回用量；activity 按子代理记下', async () => {
    const { b, calls } = backend([
      [snapshot('c1')],
      [snapshot('c1', { status: 'completed', usage: { turns: 2, toolCalls: 1, tokens: 42, cost: 0, durationMs: 900 } })],
    ])
    const store = createAgentsStore(b)
    const src = source()
    const off = store.getState().attach(src)
    src.emit('p1', { type: 'agent_update', agentId: 'c1', status: 'running' })
    await expect.poll(() => store.getState().sessions.p1?.agents.map((a) => a.status)).toEqual(['running'])
    src.emit('p1', { type: 'agent_update', agentId: 'c1', status: 'running', activity: { toolName: 'bash', summary: 'sleep 2' } })
    expect(store.getState().activity.c1).toEqual({ toolName: 'bash', summary: 'sleep 2' })
    expect(calls.list).toBe(1)
    src.emit('p1', { type: 'agent_update', agentId: 'c1', status: 'completed' })
    expect(store.getState().sessions.p1!.agents[0]!.status).toBe('completed')
    await expect.poll(() => store.getState().sessions.p1!.agents[0]!.usage?.tokens).toBe(42)
    expect(calls.list).toBe(2)
    off()
    expect(src.size).toBe(0)
  })

  it('列表请求期间到达的结束状态不被较早的"运行中"快照覆盖', async () => {
    const gate = deferred<AgentSnapshot[]>()
    let first = true
    const store = createAgentsStore({
      ...backend([]).b,
      list: () => {
        if (first) {
          first = false
          return gate.promise
        }
        return new Promise(() => {})
      },
    })
    const loading = store.getState().load('p1')
    // 读取期间已经得知子代理结束（agent_update 合并的状态），之后才到达较早的"运行中"快照。
    store.setState({ sessions: { p1: { status: 'ready', agents: [snapshot('c1', { status: 'cancelled' })] } } })
    gate.resolve([snapshot('c1')])
    await loading
    expect(store.getState().sessions.p1!.agents[0]!.status).toBe('cancelled')
  })

  it('停止：409 agent-not-running 视为成功，其他错误抛出；之后都重新读取', async () => {
    const { b, calls } = backend([[snapshot('c1')]])
    let fail: ApiError | undefined = new ApiError('agent-not-running', 'ended', 409)
    const store = createAgentsStore({
      ...b,
      cancel: async (s, a) => {
        if (fail) throw fail
        return b.cancel(s, a)
      },
    })
    await store.getState().cancel('p1', 'c1')
    fail = new ApiError('internal', 'boom', 500)
    await expect(store.getState().cancel('p1', 'c1')).rejects.toMatchObject({ code: 'internal' })
    fail = undefined
    await store.getState().cancel('p1', 'c1')
    expect(calls.cancel).toEqual(['c1'])
    await expect.poll(() => calls.list).toBe(3)
  })

  it('子 Session 的审批只回答一次；失败后可再答，approval-not-pending 之后不再重发', async () => {
    const answered: string[] = []
    let error: ApiError | undefined = new ApiError('network', 'down', 0)
    const store = createAgentsStore({
      ...backend([]).b,
      answer: async (s, r) => {
        answered.push(`${s}:${r}`)
        if (error) throw error
      },
    })
    await expect(store.getState().answerApproval('c1', 'q1', { decision: 'allow' })).rejects.toMatchObject({ code: 'network' })
    error = undefined
    const [a, b2] = await Promise.all([
      store.getState().answerApproval('c1', 'q1', { decision: 'allow' }),
      store.getState().answerApproval('c1', 'q1', { decision: 'allow' }),
    ])
    expect([a, b2]).toEqual([true, true])
    expect(answered).toEqual(['c1:q1', 'c1:q1'])
    error = new ApiError('approval-not-pending', 'gone', 409)
    await expect(store.getState().answerApproval('c2', 'q2', { decision: 'deny' })).rejects.toMatchObject({ code: 'approval-not-pending' })
    await expect(store.getState().answerApproval('c2', 'q2', { decision: 'deny' })).rejects.toMatchObject({ code: 'approval-not-pending' })
    expect(answered.filter((x) => x === 'c2:q2')).toHaveLength(1)
  })
})

describe('httpAgentsBackend', () => {
  const respond = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  it('列表与定义按 schema 校验；回答发往子 Session 的审批路径', async () => {
    await expect(httpAgentsBackend(respond(200, [{ agentId: 'c1' }])).list('p1')).rejects.toMatchObject({ code: 'bad-response' })
    const paths: string[] = []
    const ok = httpAgentsBackend(async (input, init) => {
      paths.push(`${init?.method} ${input} ${init?.body ?? ''}`)
      return new Response(null, { status: 204 })
    })
    await ok.answer('child-1', 'req-1', { decision: 'allow', scope: 'once' })
    await ok.cancel('p1', 'c1')
    expect(paths).toEqual(['POST /api/sessions/child-1/approvals/req-1 {"decision":"allow","scope":"once"}', 'POST /api/sessions/p1/agents/c1/cancel '])
  })
})
