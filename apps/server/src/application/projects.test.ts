import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPayloadRegistry } from '@coko/session'
import { createMemoryStore } from '@coko/session/memory'
import { expect, it, onTestFinished } from 'vitest'
import { ProjectService } from './projects.ts'

it('a project with an older moved Session uses its member activity, and only empty projects use creation time', async () => {
  const root = await mkdtemp(join(tmpdir(), 'coko-project-activity-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  for (const name of ['source', 'recent', 'destination']) await mkdir(join(root, name))
  let now = 100
  const store = createMemoryStore({ now: () => now, payloads: createPayloadRegistry([]) })
  const service = new ProjectService(store, { removeProject: async () => ({ sessionIds: [] }) }, root)
  const create = async (name: string) => (await service.create({ name, folders: [{ path: join(root, name), primary: true }] })).project
  const source = await create('source')
  const old = await store.sessions.createSession({ workspaceId: source.primaryWorkspaceId })
  now = 500
  const recent = await create('recent')
  await store.sessions.createSession({ workspaceId: recent.primaryWorkspaceId })
  now = 1000
  const destination = await create('destination')
  expect(destination.lastUsedAt).toBe(1000)
  await store.sessions.setSessionOrganization(old.id, { projectId: destination.id })
  const projects = await service.list()
  expect(projects.find((project) => project.id === destination.id)?.lastUsedAt).toBe(100)
  expect(projects.find((project) => project.id === source.id)?.lastUsedAt).toBe(100)
  expect(projects.toSorted((a, b) => b.lastUsedAt - a.lastUsedAt)[0]?.id).toBe(recent.id)
  expect((await store.sessions.getSession(old.id))?.updatedAt).toBe(100)
})
