import { describe, expect, it } from 'vitest'
import { API_ROUTES } from '@coko/protocol'
import { client, exchange, request, sidecarDirs, startSidecar } from './sidecar-harness.ts'

describe('Sidecar 启动（ELECTRON_RUN_AS_NODE）', () => {
  it('先发 starting 再发 ready，ready 带端口与 43 字符令牌；交换后 health 可用', async () => {
    const sidecar = await startSidecar({ dirs: await sidecarDirs() })
    expect(sidecar.messages.map((m) => m.type)).toEqual(['starting', 'ready'])
    expect(sidecar.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const cookie = await exchange(sidecar)
    const health = await client(sidecar, cookie).get(API_ROUTES.health)
    expect(health).toMatchObject({ status: 200, body: { status: 'ok' } })
    expect((await request(sidecar.port, 'GET', API_ROUTES.health)).status).toBe(401)
    expect(await sidecar.stop()).toEqual({ code: 0, signal: null })
  })
})
