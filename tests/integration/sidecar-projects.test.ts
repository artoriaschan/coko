import { mkdir, realpath, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { API_ROUTES, apiPaths, checkpointPaths } from '@coko/protocol'
import { client, connect, exchange, fauxScript, isRunEnd, sidecarDirs, startSidecar, tempDir } from './sidecar-harness.ts'

it('登记目录创建单文件夹项目，符号链接不重复，Session 与分叉继承归属，重启后完整读回', async () => {
  const root = await tempDir()
  const folder = join(root, 'project')
  await mkdir(folder)
  await symlink(folder, join(root, 'alias'))
  const script = await fauxScript(root, { responses: [{ content: 'Ready.', match: 'hello' }] })
  const dirs = await sidecarDirs()
  const first = await startSidecar({ dirs, env: { COKO_FAUX_SCRIPT: script } })
  const cookie = await exchange(first)
  const api = client(first, cookie)
  const workspace = await api.post(API_ROUTES.workspaces, { path: folder, name: 'Project' })
  expect(workspace.status).toBe(201)
  expect((await api.post(API_ROUTES.workspaces, { path: join(root, 'alias') })).body).toEqual(workspace.body)
  const list = await api.get(API_ROUTES.projects)
  expect(list.status).toBe(200)
  expect(list.body.projects).toHaveLength(1)
  const project = list.body.projects[0]
  expect(project).toMatchObject({
    name: 'Project',
    primaryWorkspaceId: workspace.body.id,
    folders: [{ path: await realpath(folder), primary: true }],
    pinnedAt: null,
    sessionCount: 0,
  })
  const created = await api.post(API_ROUTES.sessions, { workspaceId: workspace.body.id, title: 'Existing route' })
  expect(created.body).toMatchObject({ projectId: project.id, pinnedAt: null, archivedAt: null })
  const id = created.body.id as string
  const stream = await connect(first, cookie)
  stream.send({ type: 'subscribe', sessionId: id, afterSeq: 0 })
  await stream.waitFor((m) => m.type === 'subscribed')
  await api.post(apiPaths.sessionMessages(id), { text: 'hello' })
  await stream.waitFor(isRunEnd(id))
  const user = stream.entries(id).find((e) => e.kind === 'message' && (e.payload as { role?: string }).role === 'user')!
  const fork = await api.post(checkpointPaths.sessionFork(id), { targetSeq: user.seq })
  expect(fork.status).toBe(201)
  expect((await api.get(apiPaths.session(fork.body.sessionId as string))).body.session.projectId).toBe(project.id)
  expect((await api.get(API_ROUTES.projects)).body.projects[0]).toMatchObject({ sessionCount: 2 })
  await first.stop()
  const second = await startSidecar({ dirs })
  const after = client(second, await exchange(second))
  expect((await after.get(API_ROUTES.projects)).body.projects[0]).toMatchObject({ id: project.id, sessionCount: 2 })
  expect((await after.get(API_ROUTES.sessions)).body.sessions).toHaveLength(2)
})
