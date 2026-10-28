import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { launchApp, launchSecondInstance, processExists, waitFor, type LaunchedApp, type LaunchOptions } from './harness.ts'

const apps: LaunchedApp[] = []
afterEach(async () => {
  for (const app of apps.splice(0)) await app.dispose()
})
/** 默认使用真实 Sidecar；需要观测认证细节或模拟故障的壳层用例显式使用占位 sidecar。 */
async function launch(extra: Record<string, string> = {}, options: LaunchOptions = {}): Promise<LaunchedApp> {
  const launched = await launchApp(extra, options)
  apps.push(launched)
  return launched
}

const status = (app: LaunchedApp) => app.window.locator('[role="status"]')

describe('桌面壳', () => {
  it('窗口加载 coko-app://app 并显示 Sidecar 已连接', async () => {
    const app = await launch()
    expect(app.window.url()).toBe('coko-app://app/')
    await expect.poll(() => status(app).getAttribute('data-connection'), { timeout: 30_000 }).toBe('connected')
    expect(await status(app).textContent()).toMatch(/Sidecar 已连接|Sidecar connected/)
  })

  it('renderer 经代理请求真实 Sidecar 的 health，并经头注入建立已认证的 WebSocket', async () => {
    const app = await launch()
    await expect.poll(() => status(app).getAttribute('data-connection'), { timeout: 30_000 }).toBe('connected')
    const result = await app.window.evaluate(async () => {
      const boot = await window.coko!.boot()
      if (!boot.ok) throw new Error(boot.error.message)
      const health = await fetch('/api/health')
      const workspaces = await fetch('/api/workspaces')
      // 认证失败的升级会被拒绝；能收到协议应答说明 main 注入了 cookie 与 Origin。
      const reply = await new Promise<unknown>((resolve, reject) => {
        const ws = new WebSocket(boot.info.wsBaseUrl + '/api/ws')
        ws.onopen = () => ws.send(JSON.stringify({ type: 'subscribe', sessionId: 'missing', afterSeq: 0 }))
        ws.onmessage = (event) => {
          resolve(JSON.parse(String(event.data)))
          ws.close()
        }
        ws.onerror = () => reject(new Error('WebSocket error'))
      })
      return { origin: location.origin, status: health.status, body: await health.json(), workspaces: await workspaces.json(), reply }
    })
    expect(result).toEqual({
      origin: 'coko-app://app',
      status: 200,
      body: { status: 'ok' },
      workspaces: { workspaces: [] },
      reply: { type: 'error', code: 'not-found', message: 'Session missing not found', sessionId: 'missing' },
    })
  })

  it('renderer 读不到启动令牌或 cookie', async () => {
    const app = await launch({}, { sidecar: 'placeholder' })
    await expect.poll(() => status(app).getAttribute('data-connection'), { timeout: 30_000 }).toBe('connected')
    const token = (await app.events()).find((e) => e.event === 'listening')?.token as string
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const visible = await app.window.evaluate(async () => {
      const echo = await fetch('/api/fixture/echo', { method: 'POST', body: 'x' })
      const echoed = (await echo.json()) as { headers: Record<string, string> }
      return {
        documentCookie: document.cookie,
        bridgeKeys: Object.keys(window.coko ?? {}),
        boot: await window.coko!.boot(),
        echoSetCookie: echo.headers.get('set-cookie'),
        // sidecar 收到的 cookie（main 注入）；renderer 只经响应体看到它，用来确认响应头里没有。
        echoedCookie: echoed.headers.cookie,
        html: document.documentElement.outerHTML,
        exchange: (await fetch('/api/auth/exchange', { method: 'POST', body: '{}' })).status,
      }
    })
    expect(visible.documentCookie).toBe('')
    expect(visible.bridgeKeys.sort()).toEqual(['boot', 'pickDirectory'])
    expect(visible.echoSetCookie).toBeNull()
    expect(visible.exchange).toBe(404)
    const exposed = JSON.stringify({ boot: visible.boot, html: visible.html, documentCookie: visible.documentCookie })
    expect(exposed).not.toContain(token)
    expect(exposed).not.toContain('coko-session')
    expect(Object.keys((visible.boot as { info: object }).info).sort()).toEqual(['locale', 'platform', 'wsBaseUrl'])
    // Chromium 的 cookie jar 中也没有 sidecar cookie。
    const cookies = await app.app.evaluate(({ session }) => session.defaultSession.cookies.get({}))
    expect(cookies).toEqual([])
  })

  it('非主窗口发往 sidecar 的 WebSocket 升级被取消，不到达 sidecar', async () => {
    const app = await launch({}, { sidecar: 'placeholder' })
    await expect.poll(() => status(app).getAttribute('data-connection'), { timeout: 30_000 }).toBe('connected')
    const port = (await app.events()).find((e) => e.event === 'listening')?.port as number
    const before = (await app.events()).filter((e) => e.event === 'upgrade').length
    const outcome = await app.app.evaluate(async ({ BrowserWindow }, url) => {
      const other = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } })
      try {
        await other.loadURL('data:text/html,<p>other</p>')
        return (await other.webContents.executeJavaScript(`new Promise((resolve) => {
          const ws = new WebSocket(${JSON.stringify(url)})
          ws.onopen = () => resolve('open')
          ws.onerror = () => resolve('error')
          setTimeout(() => resolve('timeout'), 5000)
        })`)) as string
      } finally {
        other.destroy()
      }
    }, `ws://127.0.0.1:${port}/api/ws`)
    expect(outcome).toBe('error')
    const after = (await app.events()).filter((e) => e.event === 'upgrade').length
    expect(after).toBe(before)
  })

  it('退出后 Sidecar 进程不存在', async () => {
    const app = await launch()
    await expect.poll(() => status(app).getAttribute('data-connection'), { timeout: 30_000 }).toBe('connected')
    const [pid] = await app.sidecarPids()
    expect(pid).toBeDefined()
    expect(processExists(pid!)).toBe(true)
    await app.app.close()
    await waitFor(() => !processExists(pid!), 5_000, 'sidecar exit')
  })

  it('有活动 Run 时退出先确认：取消后继续运行，确认后退出并关闭 Sidecar', async () => {
    const app = await launch({ COKO_FIXTURE_ACTIVE_RUNS: '1' }, { sidecar: 'placeholder' })
    await expect.poll(() => status(app).getAttribute('data-connection'), { timeout: 30_000 }).toBe('connected')
    const [pid] = await app.sidecarPids()
    await app.app.evaluate(({ dialog }) => {
      const g = globalThis as { __boxes?: unknown[]; __answer?: number }
      g.__boxes = []
      g.__answer = 1
      dialog.showMessageBox = (async (...args: unknown[]) => {
        g.__boxes!.push(args.at(-1))
        return { response: g.__answer!, checkboxChecked: false }
      }) as typeof dialog.showMessageBox
    })
    const boxes = () => app.app.evaluate(() => (globalThis as { __boxes?: { detail?: string }[] }).__boxes ?? [])
    await app.app.evaluate(({ app: electronApp }) => electronApp.quit())
    await expect.poll(async () => (await boxes()).length).toBe(1)
    expect((await boxes())[0]?.detail).toMatch(/1/)
    expect(await app.window.evaluate(() => document.visibilityState)).toBeDefined()
    expect(processExists(pid!)).toBe(true)

    await app.app.evaluate(() => {
      ;(globalThis as { __answer?: number }).__answer = 0
    })
    const closed = new Promise<void>((resolve) => app.app.once('close', () => resolve()))
    await app.app.evaluate(({ app: electronApp }) => electronApp.quit())
    await closed
    await waitFor(() => !processExists(pid!), 5_000, 'sidecar exit')
  })

  it('Sidecar 启动失败时显示错误对话框，renderer 显示失败状态', async () => {
    const fixtureGate = join(await import('node:os').then((os) => os.tmpdir()), `coko-gate-${process.pid}-${Date.now()}`)
    const app = await launch({ COKO_FIXTURE_MODE: 'fatal', COKO_FIXTURE_GATE: fixtureGate }, { sidecar: 'placeholder' })
    // 先替换对话框，再放行 sidecar 报告 fatal。
    await app.app.evaluate(({ dialog }) => {
      const g = globalThis as { __boxes?: unknown[] }
      g.__boxes = []
      dialog.showMessageBox = ((...args: unknown[]) => {
        g.__boxes!.push(args.at(-1))
        return new Promise(() => {})
      }) as typeof dialog.showMessageBox
    })
    await writeFile(fixtureGate, '')
    const boxes = () => app.app.evaluate(() => (globalThis as { __boxes?: { type?: string; message?: string; detail?: string }[] }).__boxes ?? [])
    await expect.poll(async () => (await boxes()).length, { timeout: 15_000 }).toBe(1)
    const [box] = await boxes()
    expect(box?.type).toBe('error')
    expect(box?.message).toMatch(/Sidecar 启动失败|Sidecar failed to start/)
    expect(box?.detail).toContain('fixture-fatal')
    await expect.poll(() => status(app).getAttribute('data-connection'), { timeout: 15_000 }).toBe('failed')
    expect(await app.window.locator('[data-error-code]').getAttribute('data-error-code')).toBe('fixture-fatal')
    const [pid] = await app.sidecarPids()
    await waitFor(() => !processExists(pid!), 5_000, 'sidecar exit')
    const { rm } = await import('node:fs/promises')
    await rm(fixtureGate, { force: true })
  })

  it('目录选择经 preload 返回所选路径，取消时为 null', async () => {
    const app = await launch()
    await app.app.evaluate(({ dialog }) => {
      const g = globalThis as { __picks?: { canceled: boolean; filePaths: string[] }[] }
      g.__picks = [
        { canceled: false, filePaths: ['/tmp/coko-workspace'] },
        { canceled: true, filePaths: [] },
      ]
      dialog.showOpenDialog = (async () => g.__picks!.shift()!) as typeof dialog.showOpenDialog
    })
    expect(await app.window.evaluate(() => window.coko!.pickDirectory())).toBe('/tmp/coko-workspace')
    expect(await app.window.evaluate(() => window.coko!.pickDirectory())).toBeNull()
  })

  it('同一 userData 的第二个实例立即退出，不再启动 Sidecar', async () => {
    const app = await launch()
    await expect.poll(() => status(app).getAttribute('data-connection'), { timeout: 30_000 }).toBe('connected')
    expect(await launchSecondInstance(app.env)).toBe(0)
    expect(await app.sidecarPids()).toHaveLength(1)
    expect(await status(app).getAttribute('data-connection')).toBe('connected')
  })

  it('主窗口使用 macOS 窗口参数', async () => {
    const app = await launch()
    const info = await app.app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]!
      return { min: window.getMinimumSize(), size: window.getSize(), traffic: process.platform === 'darwin' ? window.getWindowButtonPosition() : null }
    })
    expect(info.min).toEqual([520, 600])
    expect(info.size).toEqual([1280, 820])
    expect(info.traffic).toEqual(process.platform === 'darwin' ? { x: 16, y: 18 } : null)
  })
})
