import { expect, it } from 'vitest'
import { API_ROUTES, apiPaths } from '@coko/protocol'
import { client, exchange, sidecarDirs, startSidecar, tempDir } from './sidecar-harness.ts'

it('renaming persists a trimmed title without changing last record time and rejects invalid titles', async () => {
  const dirs = await sidecarDirs()
  const first = await startSidecar({ dirs })
  const api = client(first, await exchange(first))
  const workspace = await api.post(API_ROUTES.workspaces, { path: await tempDir(), name: 'Example project' })
  const created = (await api.post(API_ROUTES.sessions, { workspaceId: workspace.body.id, title: 'Original title' })).body
  const original = (await api.get(apiPaths.session(created.id))).body.session
  const result = await api.put(`${apiPaths.session(created.id)}/title`, { title: '  Renamed conversation  ' })
  expect(result.status).toBe(200)
  expect(result.body).toMatchObject({ title: 'Renamed conversation', updatedAt: original.updatedAt, projectId: original.projectId })
  expect((await api.get(apiPaths.session(created.id))).body.session.title).toBe('Renamed conversation')
  for (const title of ['x'.repeat(201), '', '   ', 42]) {
    expect((await api.put(`${apiPaths.session(created.id)}/title`, { title })).status).toBe(400)
  }
  const duplicate = (await api.post(API_ROUTES.sessions, { workspaceId: workspace.body.id, title: 'Duplicate title' })).body
  expect((await api.put(`${apiPaths.session(created.id)}/title`, { title: duplicate.title })).status).toBe(200)
  const limit = '中'.repeat(200)
  expect((await api.put(`${apiPaths.session(created.id)}/title`, { title: limit })).status).toBe(200)
  expect((await api.put(`${apiPaths.session('missing')}/title`, { title: 'Missing' })).status).toBe(404)
  await first.stop()
  const second = await startSidecar({ dirs })
  const after = client(second, await exchange(second))
  expect((await after.get(apiPaths.session(created.id))).body.session).toMatchObject({ title: limit, updatedAt: original.updatedAt })
})
