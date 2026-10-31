// 派发失败的清理（SubagentService 的 agent 工具端口）：isolation worktree 创建之后 agent_start 提交失败时，worktree 按 removeIfUnchanged 回收、
// 父 Session 的 Read 询问规则去掉、#live 不残留 running（不占并行上限）。
import { BUILTIN_AGENTS, SESSION_ENTRY_PAYLOADS, type RunEntry } from '@coko/agent'
import { createPayloadRegistry } from '@coko/session'
import { createMemoryStore } from '@coko/session/memory'
import { describe, expect, it } from 'vitest'
import { SessionHub } from './hub.ts'
import { SubagentService } from './subagents.ts'

describe('子代理的 max-turns', () => {
  it('按本 Run 已提交的 assistant 条目计数：自动压缩后上下文中没有 assistant 消息也照样停止', async () => {
    const store = createMemoryStore({ payloads: createPayloadRegistry(SESSION_ENTRY_PAYLOADS) })
    const workspace = await store.sessions.registerWorkspace({ path: '/tmp/coko-max-turns' })
    const child = await store.sessions.createSession({ workspaceId: workspace.id, model: null })
    const assistant = (runId: string) => ({
      kind: 'message',
      runId,
      payload: { role: 'assistant', content: [{ type: 'text', text: 'x' }], stopReason: 'stop', timestamp: 1 },
    })
    await store.sessions.appendEntries(child.id, [assistant('old'), assistant('r1'), assistant('r1')] as never)
    const service = new SubagentService({
      store,
      hub: new SessionHub(),
      entries: { list: (id) => store.sessions.listEntries(id), commit: async () => undefined as never },
      config: { effective: async () => ({}) } as never,
      cokoHome: '/tmp/coko-home-unused',
    })
    const scope = { sessionId: child.id, parentSessionId: 'p', subagent: { name: 'general', tools: [], maxTurns: 2 } } as never
    const compacted = [{ role: 'user', content: 'summary' }] as never
    expect(await service.beforeRequest({ runId: 'r1', messages: compacted, model: {} as never }, scope)).toMatchObject({ stop: { code: 'max_turns' } })
    expect(await service.beforeRequest({ runId: 'r2', messages: compacted, model: {} as never }, scope)).toBeUndefined()
  })
})

describe('子代理派发失败', () => {
  it('worktree 创建之后 agent_start 提交失败：回收 worktree 与询问规则，没有残留的 running 子代理', async () => {
    const store = createMemoryStore({ payloads: createPayloadRegistry(SESSION_ENTRY_PAYLOADS) })
    const workspace = await store.sessions.registerWorkspace({ path: '/tmp/coko-dispatch' })
    const parent = await store.sessions.createSession({ workspaceId: workspace.id, model: null })
    const worktree = await store.worktrees.create({
      workspaceId: workspace.id,
      name: 'agent-x',
      path: '/tmp/coko-dispatch/.coko-worktrees/agent-x',
      branch: 'coko/agent-x',
      baseCommit: 'b',
      repoRoot: '/tmp/coko-dispatch',
      createdBy: 'subagent',
    })
    const removed: string[] = []
    const service = new SubagentService({
      store,
      hub: new SessionHub(),
      entries: {
        list: (id) => store.sessions.listEntries(id),
        commit: async (id, entry: RunEntry) => {
          if (entry.kind === 'agent_start') throw new Error('disk full')
          return (await store.sessions.appendEntries(id, [entry as never]))[0]!
        },
      },
      config: { effective: async () => ({}) } as never,
      cokoHome: '/tmp/coko-home-unused',
      loader: { load: async () => ({ definitions: [...BUILTIN_AGENTS], diagnostics: [] }) } as never,
    })
    service.bind(
      {
        activeRunId: () => 'run-1',
        isRunning: () => true,
        startRun: async () => ({ runId: 'child-run' }),
        abort: async () => true,
        deliver: () => false,
        visibleTools: () => ['read'],
        mode: async () => 'default',
        resolveModel: () => ({ priced: true }),
        sessionModel: async () => ({ providerId: 'p', modelId: 'm' }),
        scope: async () => ({ cwd: '/tmp/coko-dispatch', config: { agents: { enabled: true } } }) as never,
        toolNames: () => ['read'],
      },
      {
        createForSubagent: async () => worktree as never,
        removeIfUnchanged: async (id) => {
          removed.push(id)
          return { removed: true as const }
        },
      },
    )
    const start = service
      .port(parent.id)
      .start({ toolCallId: 'c1', description: 'd', prompt: 'p', subagentType: 'general', background: true, isolation: 'worktree' })
    await expect(start).rejects.toThrow(/disk full/)
    expect(service.runningChildren(parent.id)).toEqual([])
    expect(service.extraRules(parent.id)).toEqual([])
    expect(removed).toEqual([worktree.id])
  })
})
