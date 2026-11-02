import { createModelRegistry, InMemoryCredentialStore, SESSION_ENTRY_PAYLOADS } from '@coko/agent'
import { createPayloadRegistry } from '@coko/session'
import { createMemoryStore } from '@coko/session/memory'
import { expect, it, onTestFinished } from 'vitest'
import { SessionService } from './sessions.ts'
import { SessionHub } from './hub.ts'
import { emptyContextAssembly } from './context/index.ts'

const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

it('deletion excludes new admissions and child creation until commit, and releases its barrier on failure', async () => {
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
    forget: async () => {},
    quiesce: async (_ids, task) => {
      entered.resolve()
      await release.promise
      return task()
    },
  })
  const deleting = service.delete(session.id)
  await entered.promise
  await expect(service.submit(session.id, 'late')).rejects.toMatchObject({ code: 'session-busy' })
  await expect(service.runs.startRun(session.id, { trigger: 'retry' })).rejects.toMatchObject({ code: 'session-busy' })
  await expect(service.createRecord({ workspaceId: workspace.id, parentSessionId: session.id })).rejects.toMatchObject({ code: 'session-busy' })
  await expect(service.delete(session.id)).rejects.toMatchObject({ code: 'session-busy' })
  release.resolve()
  await deleting
  await expect(service.detail(session.id)).rejects.toMatchObject({ code: 'not-found' })
  const retained = await service.create({ workspaceId: workspace.id })
  service.useLifecycle({
    runningJobs: async () => false,
    forget: async () => {},
    quiesce: async () => {
      throw new Error('storage boundary unavailable')
    },
  })
  await expect(service.delete(retained.id)).rejects.toThrow('storage boundary unavailable')
  expect((await service.detail(retained.id)).session.id).toBe(retained.id)
  expect(() => service.assertAdmission(retained.id)).not.toThrow()
})

it('an in-flight submit preparing input rejects deletion before any session is removed', async () => {
  const store = createMemoryStore({ payloads: createPayloadRegistry(SESSION_ENTRY_PAYLOADS) })
  onTestFinished(() => store.close())
  const entered = deferred()
  const release = deferred()
  const context = emptyContextAssembly()
  context.beforeSubmit = async () => {
    entered.resolve()
    await release.promise
    return { reject: 'test finishes without a Run' }
  }
  const service = new SessionService({
    store,
    context,
    registry: createModelRegistry({ credentials: new InMemoryCredentialStore() }),
    hub: new SessionHub(),
    runs: { launch() {} },
  })
  const workspace = await store.sessions.registerWorkspace({ path: '/test' })
  const session = await service.create({ workspaceId: workspace.id })
  const submitting = service.submit(session.id, 'prepare')
  await entered.promise
  await expect(service.delete(session.id)).rejects.toMatchObject({ code: 'session-busy', details: { reasons: ['run'] } })
  expect((await service.detail(session.id)).session.id).toBe(session.id)
  release.resolve()
  await expect(submitting).rejects.toMatchObject({ code: 'hook-blocked' })
  await service.delete(session.id)
})
