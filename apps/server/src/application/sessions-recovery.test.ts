// 启动恢复失败的 Session：拒绝新 Run、回退与分叉（recovery-failed），恢复条件消除后再次尝试恢复。
import { SESSION_ENTRY_PAYLOADS, createModelRegistry, InMemoryCredentialStore, createBuiltinToolRegistry, createLocalExecPort } from '@coko/agent'
import { createPayloadRegistry, type SessionStore } from '@coko/session'
import { createMemoryStore } from '@coko/session/memory'
import { describe, expect, it } from 'vitest'
import { SessionHub } from './hub.ts'
import { SessionService, type RecoverySource } from './sessions.ts'

async function setup() {
  const store: SessionStore = createMemoryStore({ payloads: createPayloadRegistry(SESSION_ENTRY_PAYLOADS) })
  const workspace = await store.sessions.registerWorkspace({ path: process.cwd(), name: 'ws' })
  const session = await store.sessions.createSession({ workspaceId: workspace.id, title: 't', model: null })
  await store.sessions.appendEntries(session.id, [
    { kind: 'run_start', runId: 'r1', payload: { trigger: 'submit' } },
    { kind: 'message', runId: 'r1', payload: { role: 'user', content: [{ type: 'text', text: 'hi' }], timestamp: 1 } },
  ])
  let failing = true
  const service = new SessionService({
    store,
    registry: createModelRegistry({ credentials: new InMemoryCredentialStore() }),
    hub: new SessionHub(),
    runs: { launch: () => undefined },
    tools: (cwd) => {
      if (failing) throw new Error('tools unavailable')
      return createBuiltinToolRegistry({ cwd, exec: createLocalExecPort() })
    },
  })
  const source: RecoverySource = {
    listUnfinishedRuns: async () => [{ sessionId: session.id, runId: 'r1' }],
    listLatestEntries: async () => [],
  }
  return { store, service, session, source, heal: () => (failing = false) }
}

describe('回退预览的并发', () => {
  it('同时发出的两次 dry-run 都成功（只读预览不互相排斥）', async () => {
    const { service, session, source, heal } = await setup()
    heal()
    await service.recover(source)
    const preview = () => service.rewind(session.id, { targetSeq: 2, mode: 'both', dryRun: true })
    const results = await Promise.allSettled([preview(), preview()])
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled'])
  })
})

describe('启动恢复失败的 Session', () => {
  it('开始 Run、继续、回退与分叉以 recovery-failed 拒绝；Session DTO 标出 interrupted', async () => {
    const { service, session, source } = await setup()
    expect(await service.recover(source)).toMatchObject({ failedSessions: 1 })
    const failed = { code: 'recovery-failed' }
    await expect(service.submit(session.id, 'next')).rejects.toMatchObject(failed)
    await expect(service.continue(session.id)).rejects.toMatchObject(failed)
    await expect(service.rewind(session.id, { targetSeq: 2, mode: 'conversation' })).rejects.toMatchObject(failed)
    await expect(service.fork(session.id, 2)).rejects.toMatchObject(failed)
    expect((await service.list()).find((s) => s.id === session.id)?.activity).toBe('interrupted')
  })

  it('下次操作时重试恢复：成功后补齐 run_end interrupted，不再拒绝', async () => {
    const { store, service, session, source, heal } = await setup()
    await service.recover(source)
    heal()
    await expect(service.rewind(session.id, { targetSeq: 2, mode: 'conversation', dryRun: true })).resolves.toMatchObject({ targetSeq: 2 })
    const kinds = (await store.sessions.listEntries(session.id)).map((e) => e.kind)
    expect(kinds).toEqual(['run_start', 'message', 'run_end'])
  })
})
