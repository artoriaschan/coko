// ADR 0002 的验收场景：信任围栏先于 cookie（403 先于 401），WebSocket 升级同样校验，重启后旧 cookie 失效。
import { describe, expect, it } from 'vitest'
import { API_ROUTES } from '@coko/protocol'
import { client, exchange, openStream, request, sidecarDirs, startSidecar, type Sidecar } from './sidecar-harness.ts'

async function started(): Promise<{ sidecar: Sidecar; cookie: string }> {
  const sidecar = await startSidecar({ dirs: await sidecarDirs() })
  return { sidecar, cookie: await exchange(sidecar) }
}

describe('本地服务访问认证', () => {
  it('交换签发 HttpOnly、SameSite=Strict、Path=/ 的 cookie；令牌只能交换一次，错误令牌被拒绝', async () => {
    const sidecar = await startSidecar({ dirs: await sidecarDirs() })
    const wrong = await request(sidecar.port, 'POST', API_ROUTES.authExchange, { body: { token: sidecar.token.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')) } })
    expect(wrong.status).toBe(401)
    expect(wrong.headers['set-cookie']).toBeUndefined()

    const first = await request(sidecar.port, 'POST', API_ROUTES.authExchange, { body: { token: sidecar.token } })
    expect(first.status).toBe(204)
    const cookie = first.headers['set-cookie']?.[0] ?? ''
    expect(cookie).toMatch(/^coko-session=v1\.[^;]+; HttpOnly; SameSite=Strict; Path=\/$/)

    const again = await request(sidecar.port, 'POST', API_ROUTES.authExchange, { body: { token: sidecar.token } })
    expect(again.status).toBe(401)
    expect(again.headers['set-cookie']).toBeUndefined()
    expect((await request(sidecar.port, 'POST', API_ROUTES.authExchange, { body: '{not json' })).status).toBe(400)
  })

  it('没有 cookie、cookie 被篡改或令牌放在 Authorization 头时返回 401', async () => {
    const sidecar = await startSidecar({ dirs: await sidecarDirs() })
    const token = sidecar.token
    const cookie = await exchange(sidecar)
    expect((await request(sidecar.port, 'GET', API_ROUTES.health)).status).toBe(401)
    expect((await request(sidecar.port, 'GET', API_ROUTES.workspaces)).status).toBe(401)
    expect((await request(sidecar.port, 'GET', API_ROUTES.health, { headers: { authorization: `Bearer ${token}` } })).status).toBe(401)
    const tampered = cookie.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'))
    expect((await request(sidecar.port, 'GET', API_ROUTES.health, { headers: { cookie: tampered } })).status).toBe(401)
    expect((await request(sidecar.port, 'GET', API_ROUTES.health, { headers: { cookie } })).status).toBe(200)
  })

  it.each([
    ['非 loopback Host（DNS rebinding）', { host: 'evil.example:80' }],
    ['localhost 别名而非监听地址', { host: 'localhost:PORT' }],
    ['端口不同的 Host', { host: '127.0.0.1:1' }],
    ['跨站 Origin', { origin: 'https://evil.example' }],
    ['opaque Origin', { origin: 'null' }],
    ['coko-app 来源未经 main 改写', { origin: 'coko-app://app' }],
    ['sec-fetch-site: cross-site', { 'sec-fetch-site': 'cross-site' }],
  ])('%s：带有效 cookie 也返回 403，无 cookie 同样 403（围栏先于认证）', async (_name, headers) => {
    const { sidecar, cookie } = await started()
    const resolved = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k, v.replace('PORT', String(sidecar.port))]))
    expect((await request(sidecar.port, 'GET', API_ROUTES.health, { headers: { cookie, ...resolved } })).status).toBe(403)
    expect((await request(sidecar.port, 'GET', API_ROUTES.health, { headers: resolved })).status).toBe(403)
    expect((await request(sidecar.port, 'POST', API_ROUTES.authExchange, { headers: resolved, body: { token: sidecar.token } })).status).toBe(403)
    // 被围栏拒绝的交换不消耗令牌。
    expect((await request(sidecar.port, 'POST', API_ROUTES.authExchange, { body: { token: sidecar.token } })).status).toBe(401)
  })

  it('同源 Origin 与 sec-fetch-site: same-origin 通过围栏', async () => {
    const { sidecar, cookie } = await started()
    const res = await request(sidecar.port, 'GET', API_ROUTES.health, {
      headers: { cookie, origin: `http://${sidecar.authority}`, 'sec-fetch-site': 'same-origin' },
    })
    expect(res.status).toBe(200)
  })

  it('WebSocket 升级执行同样的校验：无 cookie 401，围栏失败 403，通过后建立连接', async () => {
    const { sidecar, cookie } = await started()
    expect(await openStream(sidecar.port, {})).toEqual({ kind: 'rejected', status: 401 })
    expect(await openStream(sidecar.port, { cookie: 'coko-session=v1.x.y' })).toEqual({ kind: 'rejected', status: 401 })
    expect(await openStream(sidecar.port, { cookie, origin: 'https://evil.example' })).toEqual({ kind: 'rejected', status: 403 })
    expect(await openStream(sidecar.port, { cookie, host: 'evil.example' })).toEqual({ kind: 'rejected', status: 403 })
    expect(await openStream(sidecar.port, { cookie, 'sec-fetch-site': 'cross-site' })).toEqual({ kind: 'rejected', status: 403 })
    const ok = await openStream(sidecar.port, { cookie, origin: `http://${sidecar.authority}` })
    expect(ok.kind).toBe('open')
  })

  it('Sidecar 重启后旧 cookie 被拒绝（HTTP 与 WebSocket），重新交换后恢复', async () => {
    const dirs = await sidecarDirs()
    const first = await startSidecar({ dirs })
    const oldCookie = await exchange(first)
    expect((await client(first, oldCookie).get(API_ROUTES.health)).status).toBe(200)
    await first.stop()

    const second = await startSidecar({ dirs })
    expect(second.token).not.toBe(first.token)
    expect((await client(second, oldCookie).get(API_ROUTES.health)).status).toBe(401)
    expect(await openStream(second.port, { cookie: oldCookie })).toEqual({ kind: 'rejected', status: 401 })
    const fresh = await exchange(second)
    expect((await client(second, fresh).get(API_ROUTES.health)).status).toBe(200)
  })
})
