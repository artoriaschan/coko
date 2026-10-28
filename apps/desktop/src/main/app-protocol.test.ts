import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { API_ROUTES } from '@coko/protocol'
import { createFixtureDir, electronPath, placeholderSidecarEntry, readFixtureEvents } from '../../tests/sidecar-fixture.ts'
import { APP_ORIGIN, createAppProtocolHandler, type SidecarEndpoint } from './app-protocol.ts'
import { exchangeLaunchToken } from './sidecar-auth.ts'
import { SidecarProcess } from './sidecar-process.ts'

let sidecar: SidecarProcess
let endpoint: SidecarEndpoint
let launchToken: string
let fixture: Awaited<ReturnType<typeof createFixtureDir>>
let rendererRoot: string

beforeAll(async () => {
  fixture = await createFixtureDir()
  rendererRoot = join(fixture.dir, 'renderer')
  await mkdir(join(rendererRoot, 'assets'), { recursive: true })
  await writeFile(join(rendererRoot, 'index.html'), '<!doctype html><html><head></head><body>coko</body></html>')
  await writeFile(join(rendererRoot, 'assets', 'app.js'), 'console.log(1)')
  await writeFile(join(fixture.dir, 'secret.txt'), 'outside')
  sidecar = new SidecarProcess({
    execPath: electronPath,
    entry: placeholderSidecarEntry,
    env: { ...process.env, COKO_FIXTURE_EVENTS: fixture.eventsPath },
  })
  const ready = await sidecar.start()
  launchToken = ready.token
  const origin = `http://127.0.0.1:${ready.port}`
  endpoint = { origin, cookie: await exchangeLaunchToken(origin, ready.token) }
}, 30_000)

afterAll(async () => {
  await sidecar?.stop()
  await fixture?.dispose()
})

const handler = () => createAppProtocolHandler({ renderer: { kind: 'directory', root: rendererRoot }, endpoint: () => endpoint })
const appRequest = (path: string, init: RequestInit = {}) => new Request(`${APP_ORIGIN}${path}`, init)

describe('令牌交换', () => {
  it('交换得到 name=value 形式的 cookie，同一令牌不能再次交换', async () => {
    expect(endpoint.cookie).toMatch(/^coko-session=[^;]+$/)
    await expect(exchangeLaunchToken(endpoint.origin, launchToken)).rejects.toThrow(/401/)
  })
})

describe('coko-app:// 协议代理', () => {
  it('转发 API 请求并注入 cookie，renderer 拿到 health', async () => {
    const response = await handler()(appRequest(API_ROUTES.health))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok' })
  })

  it('替换 renderer 提供的 cookie / host / origin，剥离响应中的 set-cookie，流式转发请求体', async () => {
    const response = await handler()(
      appRequest('/api/fixture/echo?x=1', {
        method: 'POST',
        body: 'hello',
        headers: { cookie: 'coko-session=forged', origin: APP_ORIGIN, 'content-type': 'text/plain', 'sec-fetch-site': 'same-origin' },
      }),
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('set-cookie')).toBeNull()
    const echoed = (await response.json()) as { method: string; body: string; headers: Record<string, string> }
    expect(echoed.method).toBe('POST')
    expect(echoed.body).toBe('hello')
    expect(echoed.headers.cookie).toBe(endpoint.cookie)
    expect(echoed.headers.host).toBe(new URL(endpoint.origin).host)
    expect(echoed.headers.origin).toBeUndefined()
    expect(echoed.headers['sec-fetch-site']).toBeUndefined()
  })

  it('非 coko-app://app 来源返回 403 且不到达 sidecar', async () => {
    const before = (await readFixtureEvents(fixture.eventsPath)).length
    const response = await handler()(appRequest(API_ROUTES.health, { headers: { origin: 'https://evil.example' } }))
    expect(response.status).toBe(403)
    expect((await readFixtureEvents(fixture.eventsPath)).length).toBe(before)
  })

  it('renderer 不能经代理访问令牌交换入口', async () => {
    const response = await handler()(appRequest(API_ROUTES.authExchange, { method: 'POST', body: JSON.stringify({ token: 'x' }) }))
    expect(response.status).toBe(404)
  })

  it('sidecar 未就绪时 API 返回 503', async () => {
    const pending = createAppProtocolHandler({ renderer: { kind: 'directory', root: rendererRoot }, endpoint: () => undefined })
    expect((await pending(appRequest(API_ROUTES.health))).status).toBe(503)
  })

  it('其他 host 返回 404', async () => {
    expect((await handler()(new Request('coko-app://other/index.html'))).status).toBe(404)
  })
})

describe('coko-app:// 静态资源', () => {
  it('根路径返回 index.html 并带 CSP；资源按扩展名给出类型', async () => {
    const index = await handler()(appRequest('/'))
    expect(index.status).toBe(200)
    expect(index.headers.get('content-type')).toContain('text/html')
    expect(index.headers.get('content-security-policy')).toContain("default-src 'self'")
    expect(await index.text()).toContain('coko')
    const script = await handler()(appRequest('/assets/app.js'))
    expect(script.headers.get('content-type')).toContain('text/javascript')
  })

  it('拒绝越出 renderer 目录的路径、缺失文件与非 GET 方法', async () => {
    expect((await handler()(appRequest('/..%2Fsecret.txt'))).status).toBe(403)
    expect((await handler()(appRequest('/missing.js'))).status).toBe(404)
    expect((await handler()(appRequest('/index.html', { method: 'POST', body: 'x' }))).status).toBe(405)
  })
})
