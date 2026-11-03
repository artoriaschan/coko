import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, onTestFinished } from 'vitest'
import { electronPath } from '../tests/sidecar-fixture.ts'
import { launchApp, launchSecondInstance, processExists, realSidecarEntry, waitFor, type LaunchedApp, type LaunchOptions } from './harness.ts'
import { readLogRecords } from './logs.ts'

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

const status = (app: LaunchedApp) => app.window.locator('[role="status"][data-connection]')

describe('构建产物', () => {
  it('dist/sidecar 中有无界面运行的入口 headless.mjs；没有参数时以 4 退出', async () => {
    const entry = join(dirname(realSidecarEntry), 'headless.mjs')
    expect(existsSync(entry)).toBe(true)
    const child = spawn(electronPath, [entry], { env: { PATH: process.env.PATH ?? '', ELECTRON_RUN_AS_NODE: '1' }, stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk))
    const code = await new Promise<number | null>((resolve) => child.once('exit', (c) => resolve(c)))
    expect([code, stderr]).toEqual([4, expect.stringMatching(/^coko headless: Missing --data-dir\nUsage: headless\.mjs /)])
  })
})

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
        // 自动更新存根：renderer 经 preload 收到 main 的状态（接收侧）。
        update: await new Promise((resolve) => {
          const off = window.coko!.onUpdateStatus((status) => {
            off()
            resolve(status)
          })
        }),
        echoSetCookie: echo.headers.get('set-cookie'),
        // sidecar 收到的 cookie（main 注入）；renderer 只经响应体看到它，用来确认响应头里没有。
        echoedCookie: echoed.headers.cookie,
        html: document.documentElement.outerHTML,
        exchange: (await fetch('/api/auth/exchange', { method: 'POST', body: '{}' })).status,
      }
    })
    expect(visible.documentCookie).toBe('')
    // saveProvider、fetchProviderModels 与 setSecret 只把 Key 交给 main，不回传 Key（ADR 0004、0007、0010）。
    expect(visible.bridgeKeys.sort()).toEqual([
      'boot',
      'cancelProviderModels',
      'checkForUpdates',
      'fetchProviderModels',
      'installUpdate',
      'log',
      'onOpenSession',
      'onSidecarState',
      'onUpdateStatus',
      'openLogs',
      'pickDirectory',
      'saveProvider',
      'setSecret',
    ])
    expect(visible.echoSetCookie).toBeNull()
    expect(visible.exchange).toBe(404)
    const exposed = JSON.stringify({ boot: visible.boot, html: visible.html, documentCookie: visible.documentCookie })
    expect(exposed).not.toContain(token)
    expect(exposed).not.toContain('coko-session')
    expect(Object.keys((visible.boot as { info: object }).info).sort()).toEqual(['locale', 'platform', 'wsBaseUrl'])
    expect(visible.update).toEqual({ state: 'disabled', reason: 'not-packaged' })
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

  it('Sidecar 启动失败时显示错误对话框（含打开日志文件夹），renderer 显示失败状态与诊断入口，stderr 脱敏后写入 desktop.jsonl', async () => {
    const fixtureGate = join(await import('node:os').then((os) => os.tmpdir()), `coko-gate-${process.pid}-${Date.now()}`)
    const secret = 'sk-stderrSecretValue123456'
    const { mkdtemp, realpath, rm } = await import('node:fs/promises')
    // 测试自己持有目录：dispose 之后还要读取日志。
    const dir = await mkdtemp(join(await import('node:os').then((os) => os.tmpdir()), 'coko-fatal-'))
    onTestFinished(() => rm(dir, { recursive: true, force: true }))
    const app = await launch(
      { COKO_FIXTURE_MODE: 'fatal', COKO_FIXTURE_GATE: fixtureGate, COKO_FIXTURE_STDERR: `boot trace with key ${secret}` },
      { sidecar: 'placeholder', dir },
    )
    // 先替换对话框与 shell.openPath，再放行 sidecar 报告 fatal。对话框选择"打开日志文件夹"（按钮 1）。
    await app.app.evaluate(({ dialog, shell }) => {
      const g = globalThis as { __boxes?: unknown[]; __opened?: string[] }
      g.__boxes = []
      g.__opened = []
      dialog.showMessageBox = (async (...args: unknown[]) => {
        g.__boxes!.push(args.at(-1))
        return { response: 1, checkboxChecked: false }
      }) as typeof dialog.showMessageBox
      shell.openPath = (async (path: string) => {
        g.__opened!.push(path)
        return ''
      }) as typeof shell.openPath
    })
    await writeFile(fixtureGate, '')
    const boxes = () =>
      app.app.evaluate(() => (globalThis as { __boxes?: { type?: string; message?: string; detail?: string; buttons?: string[] }[] }).__boxes ?? [])
    const opened = () => app.app.evaluate(() => (globalThis as { __opened?: string[] }).__opened ?? [])
    const logsDir = join(await realpath(dir), 'user-data', 'logs')
    await expect.poll(async () => (await boxes()).length, { timeout: 15_000 }).toBe(1)
    const [box] = await boxes()
    expect(box?.type).toBe('error')
    expect(box?.message).toMatch(/Sidecar 启动失败|Sidecar failed to start/)
    expect(box?.detail).toContain('fixture-fatal')
    expect(box?.buttons).toEqual(expect.arrayContaining([expect.stringMatching(/^(打开日志文件夹|Open logs folder)$/)]))
    await expect.poll(opened).toEqual([logsDir])

    await expect.poll(() => status(app).getAttribute('data-connection'), { timeout: 15_000 }).toBe('failed')
    expect(await app.window.locator('[data-error-code]').getAttribute('data-error-code')).toBe('fixture-fatal')
    await app.window.getByRole('button', { name: /^(打开日志文件夹|Open logs folder)$/ }).click()
    await expect.poll(opened).toEqual([logsDir, logsDir])

    const [pid] = await app.sidecarPids()
    await waitFor(() => !processExists(pid!), 5_000, 'sidecar exit')
    await app.dispose()
    const desktopLog = await readFile(join(logsDir, 'desktop.jsonl'), 'utf8')
    expect(desktopLog).not.toContain(secret)
    const diagnostic = (await readLogRecords(join(logsDir, 'desktop.jsonl'))).find((r) => r.message === 'sidecar diagnostic')
    expect(diagnostic?.properties.stderrTail).toContain('boot trace with key [REDACTED]')
    await rm(fixtureGate, { force: true })
  })

  it('Sidecar 在 ready 之后退出：main 重启并重新交换 cookie，renderer 重连后数据仍在、可以继续对话', async () => {
    const { mkdir, mkdtemp, rm } = await import('node:fs/promises')
    const root = await mkdtemp(join(await import('node:os').then((os) => os.tmpdir()), 'coko-restart-'))
    onTestFinished(() => rm(root, { recursive: true, force: true }))
    const workspace = join(root, 'workspace')
    await mkdir(workspace)
    const script = join(root, 'faux.json')
    await writeFile(script, JSON.stringify({ responses: [{ content: 'Answered by the restarted sidecar.' }] }))
    const app = await launch({ COKO_FAUX_SCRIPT: script }, { dir: root })
    await expect.poll(() => status(app).getAttribute('data-connection'), { timeout: 30_000 }).toBe('connected')
    const registered = await app.window.evaluate(
      async (path) => (await fetch('/api/workspaces', { method: 'POST', body: JSON.stringify({ path }) })).status,
      workspace,
    )
    expect(registered).toBe(201)
    await app.window.evaluate(() => {
      const g = window as unknown as { __phases: string[] }
      g.__phases = []
      const el = document.querySelector('[role="status"][data-connection]')!
      new MutationObserver(() => g.__phases.push(el.getAttribute('data-connection') ?? '')).observe(el, { attributes: true })
    })
    const [pid] = await app.sidecarPids()
    process.kill(pid!, 'SIGKILL')

    await expect.poll(async () => (await app.sidecarPids()).length, { timeout: 15_000 }).toBe(2)
    await expect.poll(() => status(app).getAttribute('data-connection'), { timeout: 30_000 }).toBe('connected')
    const phases = await app.window.evaluate(() => (window as unknown as { __phases: string[] }).__phases)
    expect(phases).toContain('restarting')
    expect(phases.at(-1)).toBe('connected')
    expect(processExists(pid!)).toBe(false)
    // 经代理的 HTTP 使用重新交换的 cookie；数据来自同一个库。
    const workspaces = await app.window.evaluate(async () => (await (await fetch('/api/workspaces')).json()) as { workspaces: { path: string }[] })
    expect(workspaces.workspaces.map((w) => w.path)).toEqual([workspace])

    // WebSocket 连向新 Sidecar：发送后看到回复。
    await app.window.reload()
    await expect.poll(() => status(app).getAttribute('data-connection'), { timeout: 30_000 }).toBe('connected')
    await app.window.getByRole('heading', { level: 1, name: /^(New chat|新对话)$/ }).waitFor()
    const composer = app.window.getByRole('textbox', { name: /Give Coko a task|向 Coko 布置任务/ })
    await composer.click()
    await composer.fill('still there?')
    await composer.press('Enter')
    await expect
      .poll(() => app.window.getByRole('article', { name: 'Coko' }).last().textContent(), { timeout: 30_000 })
      .toBe('Answered by the restarted sidecar.')
    await app.dispose()
    const records = await readLogRecords(join(root, 'user-data', 'logs', 'desktop.jsonl'))
    expect(records.map((r) => r.message)).toEqual(expect.arrayContaining(['sidecar exited unexpectedly', 'sidecar restarting', 'sidecar restarted']))
  })

  it('Sidecar 重启连续失败达到上限：renderer 进入 failed 并停止重连，弹出一次错误对话框', async () => {
    const app = await launch({ COKO_FIXTURE_MODE: 'fatal-after-first' }, { sidecar: 'placeholder' })
    await expect.poll(() => status(app).getAttribute('data-connection'), { timeout: 30_000 }).toBe('connected')
    await app.app.evaluate(({ dialog }) => {
      const g = globalThis as { __boxes?: unknown[] }
      g.__boxes = []
      dialog.showMessageBox = ((...args: unknown[]) => {
        g.__boxes!.push(args.at(-1))
        return new Promise(() => {})
      }) as typeof dialog.showMessageBox
    })
    const [pid] = await app.sidecarPids()
    process.kill(pid!, 'SIGKILL')

    await expect.poll(() => status(app).getAttribute('data-connection'), { timeout: 30_000 }).toBe('failed')
    // data-connection 先变为 failed，失败覆盖层在下一次渲染出现：等待覆盖层本身，而不是只读一次。
    await expect.poll(() => app.window.locator('[data-error-code]').getAttribute('data-error-code')).toBe('fixture-fatal')
    await expect.poll(() => app.window.getByText(/^(Sidecar 多次重启失败，已停止|Sidecar kept failing to restart and was stopped)$/).count()).toBe(1)
    await expect.poll(() => app.window.getByRole('button', { name: /^(打开日志文件夹|Open logs folder)$/ }).count()).toBe(1)
    const boxes = () => app.app.evaluate(() => (globalThis as { __boxes?: { type?: string; message?: string; buttons?: string[] }[] }).__boxes ?? [])
    await expect.poll(async () => (await boxes()).length).toBe(1)
    const [box] = await boxes()
    expect(box).toMatchObject({ type: 'error' })
    expect(box?.message).toMatch(/^(Sidecar 已意外退出|Sidecar exited unexpectedly)$/)
    expect(box?.buttons).toHaveLength(3)
    // 初次 1 个 + 默认 3 次重启；之后不再 spawn，所有 sidecar 进程都已退出。
    const spawned = await app.sidecarPids()
    expect(spawned).toHaveLength(4)
    for (const spawnedPid of spawned) await waitFor(() => !processExists(spawnedPid), 5_000, 'sidecar exit')
    expect(await status(app).getAttribute('data-connection')).toBe('failed')
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
