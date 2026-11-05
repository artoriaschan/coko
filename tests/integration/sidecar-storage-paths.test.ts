import { join } from 'node:path'
import { expect, it } from 'vitest'
import { client, exchange, sidecarDirs, startSidecar } from './sidecar-harness.ts'

it('存储路径接口返回运行中的主根和对话根，覆盖值不写入可编辑设置', async () => {
  const dirs = await sidecarDirs()
  const chatsRoot = join(dirs.cokoHome, '..', 'custom-documents', 'Coko')
  const sidecar = await startSidecar({ dirs, env: { COKO_CHATS_ROOT: chatsRoot } })
  const api = client(sidecar, await exchange(sidecar))
  expect(await api.get('/api/storage')).toMatchObject({ status: 200, body: { home: dirs.cokoHome, chatsRoot } })
  expect((await api.get('/api/settings')).body).toEqual({ settings: [] })
  expect((await api.put('/api/storage', { home: '/changed', chatsRoot: '/changed' })).status).toBe(404)
})
