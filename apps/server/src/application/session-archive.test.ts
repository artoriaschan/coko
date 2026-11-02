import { createModelRegistry, InMemoryCredentialStore, SESSION_ENTRY_PAYLOADS } from '@coko/agent'
import { createPayloadRegistry } from '@coko/session'
import { createMemoryStore } from '@coko/session/memory'
import { expect, it, onTestFinished } from 'vitest'
import { SessionService } from './sessions.ts'
import { SessionHub } from './hub.ts'

const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

it('archive excludes concurrent admissions, rolls back on failure and rejects every Run source after commit', async () => {
  const store = createMemoryStore({ payloads: createPayloadRegistry(SESSION_ENTRY_PAYLOADS) })
  onTestFinished(() => store.close())
  const service = new SessionService({
    store,
    registry: createModelRegistry({ credentials: new InMemoryCredentialStore() }),
    hub: new SessionHub(),
    runs: { launch() {} },
  })
  const workspace = await store.sessions.registerWorkspace({ path: '/test' })
  const session = await service.create({ workspaceId: workspace.id })
  const entered = deferred()
  const release = deferred()
  service.useLifecycle({
    runningJobs: async () => false,
    forget() {},
    quiesce: async (_ids, task) => {
      entered.resolve()
      await release.promise
      return task()
    },
  })
  const archiving = service.setArchived(session.id, true)
  await entered.promise
  await expect(service.submit(session.id, 'late')).rejects.toMatchObject({ code: 'session-busy' })
  await expect(service.createRecord({ workspaceId: workspace.id, parentSessionId: session.id })).rejects.toMatchObject({ code: 'session-busy' })
  await expect(service.delete(session.id)).rejects.toMatchObject({ code: 'session-busy' })
  release.resolve()
  await archiving
  const requests: import('./context/types.ts').RunRequest[] = [
    { trigger: 'submit', input: { text: 'late' } },
    { trigger: 'retry' },
    { trigger: 'continue' },
    { trigger: 'compact' },
    { trigger: 'goal', input: { text: 'goal' }, goal: { goalId: 'g', round: 1 } },
    { trigger: 'schedule', input: { text: 'schedule' }, schedule: { scheduleId: 's', occurrence: 1 } },
    { trigger: 'subagent', input: { text: 'child' } },
    { trigger: 'handoff', input: { text: 'handoff' } },
  ]
  for (const request of requests) await expect(service.runs.startRun(session.id, request)).rejects.toMatchObject({ code: 'session-archived' })
  await expect(service.submit(session.id, '/goal start')).rejects.toMatchObject({ code: 'session-archived' })
  await expect(service.createRecord({ workspaceId: workspace.id, parentSessionId: session.id })).rejects.toMatchObject({ code: 'session-archived' })
  await service.setArchived(session.id, false)
  service.useLifecycle({
    runningJobs: async () => false,
    forget() {},
    quiesce: async () => {
      throw new Error('storage unavailable')
    },
  })
  await expect(service.setArchived(session.id, true)).rejects.toThrow('storage unavailable')
  expect((await service.detail(session.id)).session.archivedAt).toBeNull()
  expect(() => service.assertAdmission(session.id)).not.toThrow()
})
