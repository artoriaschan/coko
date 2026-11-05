// 自动更新（测试构建的打包产物）：COKO_TEST_UPDATE_FEED_URL 指向本地 feed 服务器（loopback 端口 0）。接收侧断言：feed 服务器收到 main
// （Squirrel.Mac）的请求；204 时关于页显示"已是最新"；返回一个更新（下载内容不是合法的签名应用）时状态进入 error，应用不崩溃、关于页显示错误；
// "检查更新"按钮触发新请求；明暗主题与键盘操作。autoUpdater 只在打包应用中可用，所以直接启动 out/ 中的可执行文件并经 CDP 连接。
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Page } from 'playwright'
import { describe, expect, it, onTestFinished } from 'vitest'
import { BACKGROUND_ENV, processExists, waitFor } from './harness.ts'
import { readLogRecords } from './logs.ts'

const desktopRoot = fileURLToPath(new URL('..', import.meta.url))
const outDir = join(desktopRoot, 'out', `Coko-${process.platform}-${process.arch}`)
const executable = join(outDir, 'Coko.app', 'Contents', 'MacOS', 'Coko')
const STRIPPED = /^(?:COKO_|DEEPSEEK_API_KEY$|OPENAI_API_KEY$|ANTHROPIC_API_KEY$|ELECTRON_RUN_AS_NODE$)/

interface FeedRequest {
  readonly method: string
  readonly url: string
  readonly headers: IncomingHttpHeaders
}

/** 本地 feed：mode none 时 204；update 时返回 9.9.9 的下载地址，下载内容不是 zip（Squirrel.Mac 解包或校验失败）。 */
async function startFeed(): Promise<{ base: string; requests: FeedRequest[]; setMode(mode: 'none' | 'update'): void; server: Server }> {
  const requests: FeedRequest[] = []
  let mode: 'none' | 'update' = 'none'
  const server = createServer((req, res) => {
    requests.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers })
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    if (req.url?.startsWith('/feed')) {
      if (mode === 'none') return void res.writeHead(204).end()
      return void res
        .writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ url: `${base}/download/Coko-9.9.9.zip`, name: '9.9.9', notes: 'test update' }))
    }
    if (req.url?.startsWith('/download/')) return void res.writeHead(200, { 'content-type': 'application/zip' }).end('not a zip archive')
    res.writeHead(404).end()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  onTestFinished(() => new Promise<void>((resolve) => server.close(() => resolve())))
  server.unref()
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, requests, setMode: (next) => void (mode = next), server }
}

function childProcesses(parentPid: number): number[] {
  const out = execFileSync('ps', ['-A', '-o', 'pid=,ppid='], { encoding: 'utf8' })
  return out.split('\n').flatMap((line) => {
    const m = /^\s*(\d+)\s+(\d+)/.exec(line)
    return m && Number(m[2]) === parentPid ? [Number(m[1])] : []
  })
}

async function launchPackaged(env: Record<string, string>): Promise<{ child: ChildProcess; page: Page; exited: Promise<number | null> }> {
  const base: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined && !STRIPPED.test(key)) base[key] = value
  const visible = process.env.COKO_E2E_VISIBLE === '1' ? { COKO_E2E_VISIBLE: '1' } : {}
  const child = spawn(executable, ['--remote-debugging-port=0'], {
    env: { ...base, ...BACKGROUND_ENV, ...visible, ...env },
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  const exited = new Promise<number | null>((resolve) => child.once('exit', (code) => resolve(code)))
  onTestFinished(async () => {
    const children = child.pid === undefined ? [] : childProcesses(child.pid)
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    await exited
    for (const pid of children) if (processExists(pid)) process.kill(pid, 'SIGKILL')
  })
  let stderr = ''
  const endpoint = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`No DevTools endpoint; stderr:\n${stderr}`)), 30_000)
    child.stderr!.setEncoding('utf8').on('data', (chunk: string) => {
      stderr += chunk
      const match = /DevTools listening on (ws:\/\/\S+)/.exec(stderr)
      if (match) {
        clearTimeout(timer)
        resolve(match[1]!)
      }
    })
    child.once('exit', (code) => reject(new Error(`Packaged app exited (${String(code)}); stderr:\n${stderr}`)))
  })
  const browser = await chromium.connectOverCDP(endpoint)
  onTestFinished(() => browser.close().catch(() => undefined))
  let page: Page | undefined
  await waitFor(
    () => {
      page = browser
        .contexts()
        .flatMap((context) => context.pages())
        .find((candidate) => candidate.url().startsWith('coko-app://app/'))
      return page !== undefined
    },
    30_000,
    'main window',
  )
  return { child, page: page!, exited }
}

const updateState = (page: Page) => page.locator('[data-settings-page] [data-update-state]').getAttribute('data-update-state')

async function openSection(page: Page, id: 'general' | 'about') {
  await page.locator(`[data-settings-page] nav [data-section="${id}"]`).click()
  await expect.poll(() => page.locator(`[data-settings-page] nav [data-section="${id}"]`).getAttribute('aria-current')).toBe('page')
}

async function setTheme(page: Page, theme: 'dark' | 'light') {
  await openSection(page, 'general')
  await page.locator(`[data-settings-page] [data-theme-option="${theme}"]`).click()
  await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(theme === 'dark')
  await openSection(page, 'about')
}

/** 元素文字与最近不透明背景的对比度。 */
const contrastOf = (page: Page, selector: string) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel)!
    const rgb = (v: string) =>
      v
        .match(/[\d.]+/g)!
        .slice(0, 3)
        .map(Number)
    let bg = 'rgb(255, 255, 255)'
    for (let node: Element | null = el; node; node = node.parentElement) {
      const value = getComputedStyle(node).backgroundColor
      if (value !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(value)) {
        bg = value
        break
      }
    }
    const lum = (v: string) => {
      const [r, g, b] = rgb(v).map((n) => {
        const c = n / 255
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
      }) as [number, number, number]
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    const [a, b] = [lum(getComputedStyle(el).color), lum(bg)].sort((x, y) => y - x) as [number, number]
    return (a + 0.05) / (b + 0.05)
  }, selector)

describe.skipIf(process.platform !== 'darwin')('自动更新（打包的测试构建，本地 feed）', { timeout: 180_000 }, () => {
  it('feed 收到请求；204 → 已是最新；返回更新 → error 且应用不崩溃；按钮与键盘触发新请求；明暗主题', async () => {
    const feed = await startFeed()
    const root = await mkdtemp(join(tmpdir(), 'coko-update-e2e-'))
    onTestFinished(() => rm(root, { recursive: true, force: true }))
    const userData = join(root, 'user-data')
    const app = await launchPackaged({ COKO_USER_DATA_DIR: userData, COKO_HOME: join(root, 'coko-home'), COKO_TEST_UPDATE_FEED_URL: `${feed.base}/feed` })
    const { page } = app
    await waitFor(
      async () => (await page.locator('[role="status"][data-connection]').getAttribute('data-connection')) === 'connected',
      30_000,
      'sidecar connected',
    )

    await page.getByRole('button', { name: /^(Settings|设置)$/ }).click()
    await openSection(page, 'about')
    await expect.poll(() => updateState(page), { timeout: 15_000 }).toMatch(/^(idle|not-available|checking)$/)
    await expect.poll(() => page.locator('[data-runtime-versions]').textContent()).toMatch(/^Electron \d+\.\d+\.\d+ · Node \d+\.\d+\.\d+$/)

    // 204：没有更新。按钮触发的请求到达 feed 服务器（接收侧）。
    const check = page.locator('[data-settings-page] [data-action="check-updates"]')
    await expect.poll(() => check.isEnabled(), { timeout: 15_000 }).toBe(true)
    const before = feed.requests.length
    await check.click()
    await waitFor(() => feed.requests.slice(before).some((r) => r.method === 'GET' && r.url.startsWith('/feed')), 30_000, 'feed request')
    await expect.poll(() => updateState(page), { timeout: 30_000 }).toBe('not-available')
    await expect.poll(() => page.locator('[data-settings-page] [data-update-status]').textContent()).toMatch(/^(You are up to date|已是最新版本)$/)

    // 返回一个更新：下载内容不是签名应用，进入 error。键盘：焦点在按钮上按 Enter。
    feed.setMode('update')
    const second = feed.requests.length
    await check.focus()
    await page.keyboard.press('Enter')
    await waitFor(() => feed.requests.slice(second).some((r) => r.url.startsWith('/feed')), 30_000, 'second feed request')
    await expect.poll(() => updateState(page), { timeout: 60_000 }).toBe('error')
    await expect.poll(() => page.locator('[data-settings-page] [data-update-status]').textContent()).toMatch(/(Couldn't check for updates|检查更新失败)$/)
    await expect.poll(() => page.locator('[data-settings-page] [data-update-detail]').textContent()).toMatch(/^(Reason|原因)[:：] ?\S/)

    // 应用不崩溃：进程仍在，Sidecar 仍连接，error 后可以重试。
    expect(app.child.exitCode).toBeNull()
    expect(await page.evaluate(async () => (await fetch('/api/health')).status)).toBe(200)
    await expect.poll(() => check.isEnabled()).toBe(true)

    for (const theme of ['dark', 'light'] as const) {
      await setTheme(page, theme)
      await expect.poll(() => updateState(page)).toBe('error')
      expect(await contrastOf(page, '[data-settings-page] [data-update-detail]')).toBeGreaterThanOrEqual(4.5)
      expect(await contrastOf(page, '[data-settings-page] [data-update-status]')).toBeGreaterThanOrEqual(4.5)
    }

    app.child.kill('SIGTERM')
    expect(await app.exited).toBe(0)
    const desktop = await readLogRecords(join(root, 'coko-home', 'data', 'logs', 'desktop.jsonl'))
    const messages = desktop.map((r) => r.message)
    expect(messages).toContain('auto update enabled')
    expect(messages).not.toContain('auto update disabled')
    const states = desktop.filter((r) => r.message === 'update status').map((r) => r.properties.state)
    expect(states).toEqual(expect.arrayContaining(['checking', 'not-available', 'error']))
  })
})
