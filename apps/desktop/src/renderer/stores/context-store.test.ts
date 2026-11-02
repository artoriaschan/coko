import type { ContextUsageResponse, ProgressEvent, ServerMessage } from '@coko/protocol'
import { describe, expect, it } from 'vitest'
import { createContextStore, httpFetchContextUsage, trackCompaction, type CompactionFailure } from './context-store.ts'

const usage = (tokens: number, extra: Partial<ContextUsageResponse> = {}): ContextUsageResponse => ({
  contextWindow: 40_000,
  threshold: 23_000,
  warning: 3_000,
  tokens,
  estimated: false,
  breakdown: { system: 120, prompt: 1000, assistant: 400, thinking: 80, tools: 400 },
  instructions: [
    { path: '/home/u/.coko/AGENTS.md', scope: 'user', chars: 10, truncated: false },
    { path: '/w/AGENTS.md', scope: 'project', chars: 40_000, truncated: true },
  ],
  diagnostics: [{ source: 'skills', code: 'name-mismatch', path: '/w/.coko/skills/x/SKILL.md', message: 'Name does not match' }],
  autoCompact: { enabled: true, paused: false },
  ...extra,
})

const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

describe('context-store', () => {
  it('按作用域请求会话或 Workspace 的路径，响应按 schema 校验', async () => {
    const paths: string[] = []
    const fetchUsage = httpFetchContextUsage(async (path) => {
      paths.push(path)
      return new Response(JSON.stringify(path.includes('bad') ? { tokens: 'x' } : usage(5)), { status: 200 })
    })
    await expect(fetchUsage({ sessionId: 's 1' })).resolves.toEqual(usage(5))
    await expect(fetchUsage({ workspaceId: 'w' })).resolves.toEqual(usage(5))
    await expect(fetchUsage({ sessionId: 'bad' })).rejects.toThrow(/failed/)
    expect(paths).toEqual(['/api/sessions/s%201/context', '/api/workspaces/w/context', '/api/sessions/bad/context'])
  })

  it('较早的请求晚到时被丢弃；切换作用域先清空；同作用域刷新失败保留旧值', async () => {
    const pending: ReturnType<typeof deferred<ContextUsageResponse>>[] = []
    const store = createContextStore(() => {
      const d = deferred<ContextUsageResponse>()
      pending.push(d)
      return d.promise
    })
    const first = store.getState().load({ sessionId: 'a' })
    const second = store.getState().load({ sessionId: 'a' })
    pending[1]!.resolve(usage(2))
    await second
    pending[0]!.resolve(usage(1))
    await first
    expect(store.getState()).toMatchObject({ key: 'session:a', status: 'ready', usage: { tokens: 2 } })

    const switched = store.getState().load({ workspaceId: 'w' })
    expect(store.getState()).toMatchObject({ key: 'workspace:w', status: 'loading', usage: null })
    pending[2]!.resolve(usage(3))
    await switched

    const failing = createContextStore(async () => {
      throw new Error('down')
    })
    failing.setState({ key: 'session:a', status: 'ready', usage: usage(9) })
    await failing.getState().load({ sessionId: 'a' })
    expect(failing.getState()).toMatchObject({ status: 'error', usage: { tokens: 9 } })
  })

  it('trackCompaction：compaction_start 标记会话正在压缩；end / failed / run_end 清除；结束时 revision 加一，失败时报告一次', () => {
    const store = createContextStore(async () => usage(0))
    const listeners: ((m: ServerMessage) => void)[] = []
    const opens: ((r: boolean) => void)[] = []
    const failures: CompactionFailure[] = []
    const off = trackCompaction(store, { onMessage: (l) => (listeners.push(l), () => undefined), onOpen: (l) => (opens.push(l), () => undefined) }, (f) =>
      failures.push(f),
    )
    const send = (sessionId: string, event: ProgressEvent) => listeners.forEach((l) => l({ type: 'progress', sessionId, runId: 'r', event }))
    send('s1', { type: 'compaction_start', trigger: 'auto' })
    send('s2', { type: 'compaction_start', trigger: 'manual' })
    expect(store.getState()).toMatchObject({ compacting: { s1: true, s2: true }, compactionRevision: 0 })
    send('s1', { type: 'compaction_end', trigger: 'auto', tokensBefore: 10, tokensAfter: 2 })
    send('s2', { type: 'compaction_failed', trigger: 'manual', message: 'boom', consecutiveFailures: 2 })
    expect(store.getState()).toMatchObject({ compacting: {}, compactionRevision: 2 })
    expect(failures).toEqual([{ sessionId: 's2', trigger: 'manual', message: 'boom', consecutiveFailures: 2 }])
    // 停止：只有 run_end，不报告失败。
    send('s1', { type: 'compaction_start', trigger: 'manual' })
    send('s1', { type: 'run_end', status: 'aborted' })
    expect(store.getState()).toMatchObject({ compacting: {}, compactionRevision: 2 })
    send('s1', { type: 'compaction_start', trigger: 'manual' })
    opens.forEach((o) => o(true))
    expect(store.getState().compacting).toEqual({})
    expect(failures).toHaveLength(1)
    off()
  })
})
