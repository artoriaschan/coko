import { execFileSync } from 'node:child_process'
import { mkdir, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { client, exchange, sidecarDirs, startSidecar, tempDir } from './sidecar-harness.ts'

it('编辑项目与置顶重启读回，冲突返回项目且会话工作目录固定、归档不计数', async () => {
  const root = await realpath(await tempDir())
  const paths = ['first', 'second', 'third'].map((name) => join(root, name))
  await Promise.all(paths.map((path) => mkdir(path)))
  const dirs = await sidecarDirs()
  const sidecar = await startSidecar({ dirs })
  const api = client(sidecar, await exchange(sidecar))
  const create = async (name: string, path: string) => (await api.post('/api/projects', { name, folders: [{ path, primary: true }] })).body.project
  const project = await create('Original', paths[0]!)
  const conflict = await create('Other project', paths[2]!)
  const session = (await api.post('/api/sessions', { workspaceId: project.primaryWorkspaceId, title: 'Fixed directory' })).body
  const updated = await api.put(`/api/projects/${project.id}`, {
    name: '  Edited  ',
    folders: [
      { path: paths[0], primary: false },
      { path: paths[1], primary: true },
      { path: paths[2], primary: false },
    ],
  })
  expect(updated.status).toBe(200)
  expect(updated.body.project).toMatchObject({
    id: project.id,
    name: 'Edited',
    sessionCount: 1,
    folders: [
      { path: paths[0], primary: false },
      { path: paths[1], primary: true },
      { path: paths[2], primary: false },
    ],
  })
  expect((await api.get(`/api/sessions/${session.id}`)).body.session.workspaceId).toBe(project.primaryWorkspaceId)
  for (const folders of [
    [
      { path: paths[2], primary: true },
      { path: paths[1], primary: false },
    ],
    [{ path: paths[2], primary: true }],
  ]) {
    const failed = await api.put(`/api/projects/${project.id}`, { name: 'Rejected', folders })
    expect(failed.status).toBe(409)
    expect(failed.body.error.details).toMatchObject({ reason: 'primary-conflict', project: { id: conflict.id, name: 'Other project' } })
  }
  const pinned = await api.put(`/api/projects/${project.id}/pin`, { pinned: true })
  expect(pinned.status).toBe(200)
  expect(pinned.body.pinnedAt).toBeTypeOf('number')
  expect((await api.put(`/api/projects/${project.id}/pin`, { pinned: true })).body.pinnedAt).toBe(pinned.body.pinnedAt)
  await api.put(`/api/sessions/${session.id}/pin`, { pinned: true })
  expect((await api.get('/api/projects')).body.projects.find((item: { id: string }) => item.id === project.id).sessionCount).toBe(1)
  // Seed an archived member through the public storage interface while Sidecar is stopped.
  await sidecar.stop()
  execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
    const { openSqliteStore } = await import(process.argv[1]);
    const store = await openSqliteStore({ path: process.argv[2] });
    try {
      const member = await store.sessions.createSession({ workspaceId: process.argv[3], projectId: process.argv[4], title: 'Archived member' });
      await store.sessions.setSessionOrganization(member.id, { archivedAt: Date.now() });
    } finally { await store.close(); }
  `,
      new URL('../../packages/session/src/sqlite/index.ts', import.meta.url).href,
      join(dirs.dataDir, 'coko.db'),
      project.primaryWorkspaceId,
      project.id,
    ],
    { stdio: 'pipe' },
  )
  const restarted = await startSidecar({ dirs })
  const after = client(restarted, await exchange(restarted))
  expect((await after.get('/api/projects')).body.projects.find((item: { id: string }) => item.id === project.id)).toMatchObject({
    id: project.id,
    name: 'Edited',
    pinnedAt: pinned.body.pinnedAt,
    folders: pinned.body.folders,
    sessionCount: 1,
  })
  expect((await after.put(`/api/projects/${project.id}/pin`, { pinned: false })).body.pinnedAt).toBeNull()
  expect((await after.get(`/api/sessions/${session.id}`)).body.session.workspaceId).toBe(project.primaryWorkspaceId)
  expect((await after.get('/api/projects')).body.projects.find((item: { id: string }) => item.id === project.id).sessionCount).toBe(1)
  const renamed = await after.put(`/api/projects/${project.id}/name`, { name: '  Renamed  ' })
  expect(renamed.body.name).toBe('Renamed')
  for (const name of ['', '   ', 'x'.repeat(51), 5]) expect((await after.put(`/api/projects/${project.id}/name`, { name })).status).toBe(400)
  expect((await after.put('/api/projects/missing/pin', { pinned: true })).status).toBe(404)
  expect((await after.put(`/api/projects/${project.id}/pin`, { pinned: 'yes' })).status).toBe(400)
  expect(
    (
      await after.put(`/api/projects/${project.id}`, {
        name: 'Bad',
        folders: [
          { path: paths[0], primary: true },
          { path: paths[0], primary: false },
        ],
      })
    ).status,
  ).toBe(400)
  expect((await after.get('/api/projects')).body.projects.find((item: { id: string }) => item.id === project.id).name).toBe('Renamed')
})
