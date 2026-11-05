import { mkdir, readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { API_ROUTES, apiPaths } from '@coko/protocol'
import { client, exchange, fauxScript, pollUntil, sidecarDirs, startSidecar, tempDir } from './sidecar-harness.ts'

it('空白项目清洗名称、原子分配重名目录并在重启后保留项目', async () => {
  const dirs = await sidecarDirs()
  const chatsRoot = await tempDir()
  const projectsRoot = join(chatsRoot, 'projects')
  await mkdir(join(projectsRoot, 'Example'), { recursive: true })
  await writeFile(join(projectsRoot, 'Example', 'keep.txt'), 'existing contents')
  const sidecar = await startSidecar({ dirs, env: { COKO_CHATS_ROOT: chatsRoot } })
  const api = client(sidecar, await exchange(sidecar))
  const first = await api.post(API_ROUTES.projects, { mode: 'blank', name: '  ../Exa\\mple/  ' })
  expect(first.status).toBe(201)
  expect(first.body.project).toMatchObject({ name: 'Example-2', folders: [{ path: await realpath(join(projectsRoot, 'Example-2')), primary: true }] })
  expect(await readFile(join(projectsRoot, 'Example', 'keep.txt'), 'utf8')).toBe('existing contents')
  expect(await readdir(join(projectsRoot, 'Example-2'))).toEqual([])
  const duplicates = await Promise.all([
    api.post(API_ROUTES.projects, { mode: 'blank', name: 'Example' }),
    api.post(API_ROUTES.projects, { mode: 'blank', name: 'Example' }),
  ])
  expect(duplicates.map((result) => result.status)).toEqual([201, 201])
  expect(duplicates.map((result) => result.body.project.name).sort()).toEqual(['Example-3', 'Example-4'])
  const empty = await api.post(API_ROUTES.projects, { mode: 'blank', name: '  ../\\  ' })
  expect(empty.status).toBe(201)
  expect(empty.body.project.name).toBe('新项目')
  expect((await stat(join(projectsRoot, '新项目'))).isDirectory()).toBe(true)
  const dotted = await api.post(API_ROUTES.projects, { mode: 'blank', name: ' . / .nested ' })
  expect(dotted.status).toBe(201)
  expect(dotted.body.project.name).toBe('nested')
  await sidecar.stop()
  const restarted = await startSidecar({ dirs, env: { COKO_CHATS_ROOT: chatsRoot } })
  const after = client(restarted, await exchange(restarted))
  expect((await after.get(API_ROUTES.projects)).body.projects).toContainEqual(first.body.project)
})

it('空白项目首次发送的 cwd 就是项目根，目录创建失败不留下 Workspace 或项目', async () => {
  const root = await tempDir()
  const chatsRoot = join(root, 'chats')
  const dirs = await sidecarDirs()
  const script = await fauxScript(root, { responses: [{ content: 'Project ready.' }] })
  const env = { COKO_CHATS_ROOT: chatsRoot, COKO_FAUX_SCRIPT: script }
  const sidecar = await startSidecar({ dirs, env })
  const api = client(sidecar, await exchange(sidecar))
  const created = await api.post(API_ROUTES.projects, { mode: 'blank', name: 'Project task' })
  const project = created.body.project
  const sent = await api.post(API_ROUTES.firstSend, { draftId: 'blank-project-first-send', projectId: project.id, text: 'Begin in this project' })
  expect(sent.status).toBe(201)
  expect(sent.body.session).toMatchObject({ projectId: project.id, workspaceId: project.primaryWorkspaceId, cwd: project.folders[0].path, directory: null })
  await pollUntil(
    async () => (await api.get(apiPaths.session(sent.body.session.id))).body.entries.some((entry: { kind: string }) => entry.kind === 'run_end'),
    { timeoutMs: 5000, what: 'first project Run ends' },
  )
  expect(await readdir(project.folders[0].path)).toEqual([])
  const long = 'x'.repeat(50)
  expect((await api.post(API_ROUTES.projects, { mode: 'blank', name: long })).status).toBe(201)
  const collision = await api.post(API_ROUTES.projects, { mode: 'blank', name: long })
  expect(collision.status).toBe(201)
  expect(collision.body.project.name).toBe(`${'x'.repeat(48)}-2`)
  await sidecar.stop()
  const blockedRoot = join(root, 'blocked')
  await writeFile(blockedRoot, 'keep')
  const failure = await startSidecar({ dirs: await sidecarDirs(), env: { COKO_CHATS_ROOT: blockedRoot } })
  const failedApi = client(failure, await exchange(failure))
  expect((await failedApi.post(API_ROUTES.projects, { mode: 'blank', name: 'Cannot create' })).status).toBe(500)
  expect((await failedApi.get(API_ROUTES.projects)).body.projects).toEqual([])
  expect((await failedApi.get(API_ROUTES.workspaces)).body.workspaces).toEqual([])
  expect(await readFile(blockedRoot, 'utf8')).toBe('keep')
})
