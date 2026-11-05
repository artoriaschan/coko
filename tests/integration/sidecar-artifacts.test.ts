import { mkdir, rename, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { API_ROUTES } from '@coko/protocol'
import { client, exchange, fauxScript, sidecarDirs, startSidecar, tempDir } from './sidecar-harness.ts'

it('Artifacts is a filtered live snapshot of the standalone outputs tree', async () => {
  const root = await tempDir()
  const script = await fauxScript(root, { responses: [{ content: 'Ready.' }] })
  const sidecar = await startSidecar({ dirs: await sidecarDirs(), env: { COKO_FAUX_SCRIPT: script, COKO_CHATS_ROOT: join(root, 'chats') } })
  const api = client(sidecar, await exchange(sidecar))
  const session = (await api.post(API_ROUTES.firstSend, { draftId: 'artifacts', text: 'hello' })).body.session
  const path = `/api/sessions/${session.id}/artifacts`
  expect((await api.get(path)).body).toEqual({ artifacts: [] })
  const outputs = join(session.directory, 'outputs')
  await mkdir(join(outputs, 'chapters'))
  await mkdir(join(outputs, '.hidden'))
  await writeFile(join(outputs, 'chapters', 'report.txt'), 'final report')
  await writeFile(join(outputs, '.private'), 'hidden')
  await writeFile(join(outputs, '.hidden', 'notes.txt'), 'hidden too')
  const outside = join(root, 'private.txt')
  await writeFile(outside, 'outside')
  await symlink(outside, join(outputs, 'outside.txt'))
  await symlink(root, join(outputs, 'outside-folder'))
  const snapshot = (await api.get(path)).body.artifacts
  expect(snapshot.map((entry: { path: string }) => entry.path)).toEqual(['chapters', 'chapters/report.txt'])
  expect(snapshot[0]).toMatchObject({ name: 'chapters', kind: 'directory' })
  expect(snapshot[1]).toEqual({
    path: 'chapters/report.txt',
    name: 'report.txt',
    kind: 'file',
    size: 12,
    modifiedAt: (await stat(join(outputs, 'chapters', 'report.txt'))).mtimeMs,
  })
  await writeFile(join(outputs, 'chapters', 'report.txt'), 'updated')
  expect((await api.get(path)).body.artifacts[1].size).toBe(7)
  await rm(join(outputs, 'chapters', 'report.txt'))
  expect((await api.get(path)).body.artifacts.map((entry: { path: string }) => entry.path)).toEqual(['chapters'])
})

it('Artifacts rejects project and legacy sessions, stale outside links and a replaced outputs root', async () => {
  const root = await tempDir()
  const script = await fauxScript(root, { responses: [{ content: 'Ready.' }] })
  const sidecar = await startSidecar({ dirs: await sidecarDirs(), env: { COKO_FAUX_SCRIPT: script, COKO_CHATS_ROOT: join(root, 'chats') } })
  const api = client(sidecar, await exchange(sidecar))
  const session = (await api.post(API_ROUTES.firstSend, { draftId: 'actions', text: 'hello' })).body.session
  const path = `/api/sessions/${session.id}/artifacts`
  const outputs = join(session.directory, 'outputs')
  const report = join(outputs, 'report.txt')
  await writeFile(report, 'deliverable')
  expect((await api.post(path + '/resolve', { path: 'report.txt' })).body).toEqual({ path: report })
  for (const name of ['../work', '.private', 'folder/../report.txt', '/etc/passwd']) {
    expect((await api.post(path + '/resolve', { path: name })).status).toBe(400)
  }
  const name = process.platform === 'win32' ? 'ordinary.txt' : 'part\\name.txt'
  await writeFile(join(outputs, name), 'ordinary file')
  expect((await api.post(path + '/resolve', { path: name })).body).toEqual({ path: join(outputs, name) })
  await rm(report)
  await symlink(join(root, 'outside.txt'), report)
  await writeFile(join(root, 'outside.txt'), 'outside')
  expect((await api.post(path + '/resolve', { path: 'report.txt' })).status).toBe(403)
  await rename(outputs, outputs + '-original')
  await symlink(root, outputs)
  expect((await api.get(path)).status).toBe(403)
  expect((await api.post(path + '/resolve', { path: 'outside.txt' })).status).toBe(403)
  const projectRoot = join(root, 'project')
  await mkdir(projectRoot)
  const workspace = (await api.post(API_ROUTES.workspaces, { path: projectRoot })).body
  const legacy = (await api.post(API_ROUTES.sessions, { workspaceId: workspace.id, title: 'Legacy' })).body
  expect((await api.get(`/api/sessions/${legacy.id}/artifacts`)).status).toBe(404)
  const project = (await api.get(API_ROUTES.projects)).body.projects[0]
  await api.put(`/api/sessions/${session.id}/project`, { projectId: project.id })
  expect((await api.get(path)).status).toBe(404)
  expect((await api.get('/api/sessions/missing/artifacts')).status).toBe(404)
})
