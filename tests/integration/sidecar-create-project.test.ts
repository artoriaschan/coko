import { mkdir, realpath, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { API_ROUTES } from '@coko/protocol'
import { client, exchange, sidecarDirs, startSidecar, tempDir } from './sidecar-harness.ts'

it('多文件夹项目真实路径检查、创建与已有结果、拒绝非法输入并重启读回', async () => {
  const root = await tempDir()
  const first = join(root, 'first')
  const second = join(root, 'second')
  await mkdir(first)
  await mkdir(second)
  await symlink(second, join(root, 'alias'))
  await writeFile(join(root, 'file'), 'not a directory')
  const dirs = await sidecarDirs()
  const sidecar = await startSidecar({ dirs })
  const api = client(sidecar, await exchange(sidecar))
  const folders = [
    { path: first, primary: false },
    { path: second, primary: true },
  ]
  const created = await api.post(API_ROUTES.projects, { name: '  Shared name  ', folders })
  expect(created.status).toBe(201)
  expect(created.body.status).toBe('created')
  expect(created.body.project).toMatchObject({
    name: 'Shared name',
    folders: [
      { path: await realpath(first), primary: false },
      { path: await realpath(second), primary: true },
    ],
  })
  for (const path of [join(root, 'alias'), `${second}/`, join(second, '..', 'second')]) {
    const existing = await api.post(API_ROUTES.projects, {
      name: 'Do not merge',
      folders: [
        { path, primary: true },
        { path: first, primary: false },
      ],
    })
    expect(existing.status).toBe(200)
    expect(existing.body).toEqual({ status: 'existing', project: created.body.project })
  }
  expect((await api.get(API_ROUTES.projects)).body.projects).toEqual([created.body.project])
  const check = await api.post('/api/projects/check-folder', { path: join(root, 'alias') })
  expect(check.status).toBe(200)
  expect(check.body).toEqual({ path: await realpath(second) })
  for (const path of [join(root, 'missing'), join(root, 'file'), 'relative']) {
    const response = await api.post('/api/projects/check-folder', { path })
    expect(response.status).toBe(400)
    expect(response.body.error.details.reason).toMatch(/absolute|unavailable|not-directory/)
    expect((await api.post(API_ROUTES.projects, { name: 'Invalid', folders: [{ path, primary: true }] })).status).toBe(400)
  }
  for (const input of [
    { name: 'a'.repeat(51), folders },
    { name: '   ', folders },
    { name: 'Valid', folders: [] },
    { name: 'Valid', folders: folders.map((folder) => ({ ...folder, primary: true })) },
    {
      name: 'Valid',
      folders: [
        { path: second, primary: true },
        { path: join(root, 'alias'), primary: false },
      ],
    },
  ])
    expect((await api.post(API_ROUTES.projects, input)).status).toBe(400)
  const duplicateName = await api.post(API_ROUTES.projects, { name: 'Shared name', folders: [{ path: first, primary: true }] })
  expect(duplicateName.status).toBe(201)
  expect((await api.get(API_ROUTES.projects)).body.projects).toHaveLength(2)
  await sidecar.stop()
  const restarted = await startSidecar({ dirs })
  const after = client(restarted, await exchange(restarted))
  expect((await after.get(API_ROUTES.projects)).body.projects).toContainEqual(created.body.project)
})
