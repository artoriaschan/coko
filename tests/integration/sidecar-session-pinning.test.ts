import { expect, it } from 'vitest'
import { API_ROUTES, apiPaths } from '@coko/protocol'
import { client, exchange, sidecarDirs, startSidecar, tempDir } from './sidecar-harness.ts'

it('置顶与取消置顶持久化，不改变项目归属或最后记录时间', async () => {
  const dirs = await sidecarDirs()
  const first = await startSidecar({ dirs })
  const api = client(first, await exchange(first))
  const workspace = await api.post(API_ROUTES.workspaces, { path: await tempDir(), name: 'Example project' })
  const created = (await api.post(API_ROUTES.sessions, { workspaceId: workspace.body.id, title: 'Example conversation' })).body
  const session = (await api.get(apiPaths.session(created.id))).body.session
  const pinned = await api.put(`${apiPaths.session(session.id)}/pin`, { pinned: true })
  expect(pinned.status).toBe(200)
  expect(pinned.body).toMatchObject({ id: session.id, projectId: session.projectId, updatedAt: session.updatedAt, pinnedAt: expect.any(Number) })
  const pinTime = pinned.body.pinnedAt
  expect((await api.put(`${apiPaths.session(session.id)}/pin`, { pinned: true })).body.pinnedAt).toBe(pinTime)
  await first.stop()
  const second = await startSidecar({ dirs })
  const after = client(second, await exchange(second))
  expect((await after.get(apiPaths.session(session.id))).body.session).toMatchObject({
    pinnedAt: pinTime,
    projectId: session.projectId,
    updatedAt: session.updatedAt,
  })
  expect((await after.put(`${apiPaths.session(session.id)}/pin`, { pinned: false })).body).toMatchObject({
    pinnedAt: null,
    projectId: session.projectId,
    updatedAt: session.updatedAt,
  })
  expect((await after.put(`${apiPaths.session(session.id)}/pin`, { pinned: 'yes' })).status).toBe(400)
})
