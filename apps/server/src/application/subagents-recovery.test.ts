// 子代理的启动恢复（SubagentService.prepareRecovery，ADR 0014）：被中断的父 Run 中没有结果的 agent 调用（前台与后台）补中断说明，
// 说明子代理可能已改动文件并给出子 Session id，不沿用 read 工具"可以重试"的文本；agent_start 之前崩溃时从子 Session 的 subagent_origin
// 补记 agent_start / agent_end interrupted，并按 removeIfUnchanged 回收 isolation worktree；子 Session 还没创建时说明子代理没有开始。
import { SESSION_ENTRY_PAYLOADS, type RunEntry } from '@coko/agent'
import { createPayloadRegistry } from '@coko/session'
import { createMemoryStore } from '@coko/session/memory'
import { describe, expect, it } from 'vitest'
import { SessionHub } from './hub.ts'
import type { RecoverySource } from './recovery.ts'
import { SubagentService } from './subagents.ts'

const RUN = 'run-1'
const agentCall = (id: string, background: boolean) => ({
  kind: 'message',
  runId: RUN,
  payload: {
    role: 'assistant',
    content: [{ type: 'toolCall', id, name: 'agent', arguments: { description: 'd', prompt: 'p', run_in_background: background } }],
    stopReason: 'toolUse',
    timestamp: 1,
  },
})

async function setup() {
  const store = createMemoryStore({ payloads: createPayloadRegistry(SESSION_ENTRY_PAYLOADS) })
  const workspace = await store.sessions.registerWorkspace({ path: '/tmp/coko-subagents-recovery' })
  const parent = await store.sessions.createSession({ workspaceId: workspace.id, model: null })
  const removed: string[] = []
  const service = new SubagentService({
    store,
    hub: new SessionHub(),
    entries: {
      list: (sessionId) => store.sessions.listEntries(sessionId),
      commit: async (sessionId, entry: RunEntry) => (await store.sessions.appendEntries(sessionId, [entry as never]))[0]!,
    },
    config: { effective: async () => ({}) } as never,
    cokoHome: '/tmp/coko-home-unused',
    worktrees: {
      createForSubagent: async () => {
        throw new Error('not used')
      },
      removeIfUnchanged: async (id) => {
        removed.push(id)
        return { removed: true as const }
      },
    },
  })
  const source: RecoverySource = { listUnfinishedRuns: async () => [{ sessionId: parent.id, runId: RUN }], listLatestEntries: async () => [] }
  const commit = (sessionId: string, entries: unknown[]) => store.sessions.appendEntries(sessionId, entries as never)
  const child = async (toolCallId: string, worktreeId?: string) => {
    const session = await store.sessions.createSession({
      workspaceId: workspace.id,
      parentSessionId: parent.id,
      model: null,
      ...(worktreeId ? { worktreeId } : {}),
    })
    await commit(session.id, [
      {
        kind: 'subagent_origin',
        payload: {
          parentSessionId: parent.id,
          parentRunId: RUN,
          toolCallId,
          definition: { name: 'general', source: 'builtin', tools: ['read'], maxTurns: 50 },
        },
      },
    ])
    return { id: session.id, worktreeId }
  }
  const entries = () => store.sessions.listEntries(parent.id)
  const results = async () =>
    (await entries())
      .filter((e) => e.kind === 'message' && (e.payload as { role: string }).role === 'toolResult')
      .map((e) => e.payload as { toolCallId: string; isError: boolean; content: { text: string }[] })
  return { store, parent, service, source, commit, child, entries, results, removed }
}

describe('子代理的启动恢复', () => {
  it('后台调用在 agent_start 之后、结果之前崩溃：补 agent_end interrupted 与中断说明（含子 Session id，说明可能已改动文件）', async () => {
    const t = await setup()
    const c = await t.child('a1')
    await t.commit(t.parent.id, [
      { kind: 'run_start', runId: RUN, payload: { trigger: 'submit' } },
      agentCall('a1', true),
      { kind: 'agent_start', runId: RUN, payload: { agentId: c.id, agentType: 'general', description: 'd', background: true, toolCallId: 'a1' } },
    ])
    expect(await t.service.prepareRecovery(t.source)).toBe(1)
    const [result] = await t.results()
    expect(result).toMatchObject({ toolCallId: 'a1', isError: true })
    expect(result!.content[0]!.text).toContain(`partial results are in child session ${c.id}`)
    expect(result!.content[0]!.text).toMatch(/may have changed files/)
    expect(result!.content[0]!.text).not.toMatch(/no side effects|retry it/i)
    expect((await t.entries()).filter((e) => e.kind === 'agent_end').map((e) => e.payload)).toEqual([
      expect.objectContaining({ agentId: c.id, status: 'interrupted' }),
    ])
  })

  it('子 Session 已创建、agent_start 之前崩溃：从 subagent_origin 补 agent_start 与 agent_end interrupted，回收 isolation worktree', async () => {
    const t = await setup()
    const worktree = await t.store.worktrees.create({
      workspaceId: t.parent.workspaceId,
      name: 'agent-x',
      path: '/tmp/r/.coko-worktrees/agent-x',
      branch: 'coko/agent-x',
      baseCommit: 'b',
      repoRoot: '/tmp/r',
      createdBy: 'subagent',
    })
    const c = await t.child('a2', worktree.id)
    await t.commit(t.parent.id, [{ kind: 'run_start', runId: RUN, payload: { trigger: 'submit' } }, agentCall('a2', false)])
    expect(await t.service.prepareRecovery(t.source)).toBe(1)
    const entries = await t.entries()
    expect(entries.filter((e) => e.kind === 'agent_start').map((e) => e.payload)).toEqual([
      expect.objectContaining({ agentId: c.id, agentType: 'general', toolCallId: 'a2', background: false }),
    ])
    expect(entries.filter((e) => e.kind === 'agent_end').map((e) => e.payload)).toEqual([expect.objectContaining({ agentId: c.id, status: 'interrupted' })])
    const [result] = await t.results()
    expect(result!.content[0]!.text).toContain(`child session ${c.id}`)
    expect(t.removed).toEqual([worktree.id])
  })

  it('子 Session 还没创建时崩溃：结果说明子代理没有开始（没有子 Session），不补 agent_start', async () => {
    const t = await setup()
    await t.commit(t.parent.id, [{ kind: 'run_start', runId: RUN, payload: { trigger: 'submit' } }, agentCall('a3', true)])
    expect(await t.service.prepareRecovery(t.source)).toBe(1)
    const [result] = await t.results()
    expect(result).toMatchObject({ toolCallId: 'a3', isError: true })
    expect(result!.content[0]!.text).toMatch(/did not start/)
    expect((await t.entries()).filter((e) => e.kind === 'agent_start')).toEqual([])
  })
})
