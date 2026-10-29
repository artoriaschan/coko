// 产物 smoke：对 electron-forge package 的输出（out/）运行真实应用，完成一次 faux 对话，确认 grep 使用随包 ripgrep，
// 并在审批卡中允许一次 bash 写入；批准的 Workspace 外写入被产物中的 Seatbelt 拦截（只在 darwin 断言）。
// 打包产物关闭了 Node 调试参数（Fuses），Playwright 的 _electron.launch 不可用：直接启动可执行文件并经 CDP 连接窗口。
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import { describe, expect, it, onTestFinished } from 'vitest'
import { BACKGROUND_ENV, processExists, waitFor } from './harness.ts'
import { readLogRecords, TOKEN_SHAPED } from './logs.ts'

const desktopRoot = fileURLToPath(new URL('..', import.meta.url))
const outDir = join(desktopRoot, 'out', `Coko-${process.platform}-${process.arch}`)
const executable = process.platform === 'darwin' ? join(outDir, 'Coko.app', 'Contents', 'MacOS', 'Coko') : join(outDir, 'Coko')
const resources = process.platform === 'darwin' ? join(outDir, 'Coko.app', 'Contents', 'Resources') : join(outDir, 'resources')

/** 不向产物传递宿主的凭据与开发用覆盖变量。 */
const STRIPPED = /^(?:COKO_|DEEPSEEK_API_KEY$|OPENAI_API_KEY$|ANTHROPIC_API_KEY$|ELECTRON_RUN_AS_NODE$)/

function childProcesses(parentPid: number): { pid: number; command: string }[] {
  const out = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,command='], { encoding: 'utf8' })
  return out.split('\n').flatMap((line) => {
    const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line)
    return m && Number(m[2]) === parentPid ? [{ pid: Number(m[1]), command: m[3]! }] : []
  })
}

interface Packaged {
  readonly child: ChildProcess
  readonly browser: Browser
  readonly page: Page
  readonly exited: Promise<number | null>
}

async function launchPackaged(env: Record<string, string>): Promise<Packaged> {
  const base: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined && !STRIPPED.test(key)) base[key] = value
  // 测试构建的产物同样以后台模式运行；COKO_E2E_VISIBLE=1 时保留，便于本地观察窗口。
  const visible = process.env.COKO_E2E_VISIBLE === '1' ? { COKO_E2E_VISIBLE: '1' } : {}
  const child = spawn(executable, ['--remote-debugging-port=0'], {
    env: { ...base, ...BACKGROUND_ENV, ...visible, ...env },
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  const exited = new Promise<number | null>((resolve) => child.once('exit', (code) => resolve(code)))
  onTestFinished(async () => {
    const pid = child.pid
    const children = pid === undefined ? [] : childProcesses(pid).map((p) => p.pid)
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    await exited
    for (const id of children) if (processExists(id)) process.kill(id, 'SIGKILL')
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
  return { child, browser, page: page!, exited }
}

const waitConnected = (page: Page) =>
  waitFor(async () => (await page.locator('[role="status"]').getAttribute('data-connection')) === 'connected', 30_000, 'sidecar connected')

describe('打包产物 smoke', () => {
  it('globalSetup 已产出可执行文件', () => {
    expect(existsSync(executable)).toBe(true)
  })

  it('启动并完成一次 faux 对话；Sidecar 与 grep 使用随包资源；日志落盘且已脱敏', async () => {
    const root = await mkdtemp(join(tmpdir(), 'coko-packaged-'))
    onTestFinished(() => rm(root, { recursive: true, force: true }))
    const workspace = join(root, 'workspace')
    // Sidecar 的 TMPDIR 指向 root/tmp：同级的 outside 不在 workspace-write 的可写根内。
    const outside = join(root, 'outside')
    const temp = join(root, 'tmp')
    await Promise.all([mkdir(workspace), mkdir(outside), mkdir(temp)])
    await writeFile(join(workspace, 'notes.txt'), 'alpha\nneedle in the haystack\n')
    const script = join(root, 'faux.json')
    await writeFile(
      script,
      JSON.stringify({
        tokensPerSecond: 40,
        responses: [
          { content: [{ type: 'toolCall', name: 'grep', id: 'g1', arguments: { pattern: 'needle' } }] },
          { content: [{ type: 'toolCall', name: 'bash', id: 'b1', arguments: { command: 'printf found > found.txt' } }] },
          { content: [{ type: 'toolCall', name: 'bash', id: 'b2', arguments: { command: `printf leak > ${join(outside, 'leak.txt')}` } }] },
          { content: 'Found the needle in **notes.txt**.' },
        ],
      }),
    )
    const userData = join(root, 'user-data')
    const app = await launchPackaged({ COKO_USER_DATA_DIR: userData, COKO_FAUX_SCRIPT: script, TMPDIR: temp })
    const { page } = app
    await waitConnected(page)

    // 随包 Sidecar 由应用自身以 ELECTRON_RUN_AS_NODE 启动，参数带随包 ripgrep 的路径。
    const sidecar = childProcesses(app.child.pid!).find((p) => p.command.includes(join(resources, 'sidecar', 'index.mjs')))
    expect(sidecar?.command).toContain(`--ripgrep ${join(resources, 'ripgrep', 'rg')}`)
    // 打包产物带 --packaged：只有测试构建（COKO_TEST_BUILD=1 打包，见 globalSetup）才接受 COKO_FAUX_SCRIPT 等测试钩子。
    expect(sidecar?.command).toContain('--packaged')

    // 目录选择对话框无法在产物中替换：经协议代理登记 Workspace，重新加载后从侧栏新建会话。
    const registered = await page.evaluate(async (path) => {
      const res = await fetch('/api/workspaces', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path }) })
      return { status: res.status, body: (await res.json()) as { name: string } }
    }, workspace)
    expect(registered.status).toBe(201)
    await page.reload()
    await waitConnected(page)
    await page.getByRole('button', { name: new RegExp(`^(New session in|在 ).*${registered.body.name}`) }).click()

    const composer = page.getByRole('textbox', { name: /Give Coko a task|向 Coko 布置任务/ })
    await composer.click()
    await composer.fill('find the needle')
    await composer.press('Enter')
    const card = page.locator('[data-slot="tool-card"][data-tool="grep"]')
    await expect.poll(() => card.getAttribute('data-status'), { timeout: 30_000 }).toBe('done')
    await card.locator('[aria-expanded]').first().click()
    await expect.poll(() => card.textContent()).toContain('notes.txt:2: needle in the haystack')
    // 审批：bash 写入在产物中经审批卡允许一次后执行。
    const approval = page.locator('[data-slot="approval-card"]')
    await approval.waitFor({ timeout: 30_000 })
    expect(await readFile(join(workspace, 'found.txt'), 'utf8').catch(() => null)).toBeNull()
    await approval.getByRole('button', { name: /^(Allow once|允许一次)$/ }).click()
    const bashCards = page.locator('[data-slot="tool-card"][data-tool="bash"]')
    await expect.poll(() => bashCards.first().getAttribute('data-status'), { timeout: 30_000 }).toBe('done')
    expect(await readFile(join(workspace, 'found.txt'), 'utf8')).toBe('found')
    // 沙箱：批准的 Workspace 外写入在产物中仍被 Seatbelt 拦截（其他平台受限档位 fail-closed，同样不写入）。
    await expect.poll(() => approval.getAttribute('data-approval-key'), { timeout: 30_000 }).not.toBeNull()
    await approval.getByRole('button', { name: /^(Allow once|允许一次)$/ }).click()
    await expect.poll(() => bashCards.nth(1).getAttribute('data-status'), { timeout: 30_000 }).toBe('error')
    expect(await bashCards.nth(1).locator('[data-sandbox-denied]').count()).toBe(process.platform === 'darwin' ? 1 : 0)
    expect(await readFile(join(outside, 'leak.txt'), 'utf8').catch(() => null)).toBeNull()
    await page.locator('[data-action="send"]').waitFor({ timeout: 30_000 })
    expect(await page.getByRole('article', { name: 'Coko' }).last().textContent()).toBe('Found the needle in notes.txt.')

    await page.evaluate(() =>
      window.coko!.log({ level: 'info', category: ['smoke'], message: 'smoke marker sk-smokeSecretValue1', properties: { apiKey: 'plain-secret' } }),
    )

    // SIGTERM 走 Electron 的正常退出：before-quit → 关闭 Sidecar → 刷新日志。
    await app.browser.close()
    app.child.kill('SIGTERM')
    expect(await app.exited).toBe(0)
    await waitFor(() => !processExists(sidecar!.pid), 10_000, 'sidecar exit')

    const logs = join(userData, 'logs')
    const desktop = await readLogRecords(join(logs, 'desktop.jsonl'))
    const sidecarLog = await readLogRecords(join(logs, 'sidecar.jsonl'))
    expect(desktop.find((r) => r.message === 'app starting')?.properties).toMatchObject({
      packaged: true,
      testBuild: true,
      background: process.env.COKO_E2E_VISIBLE !== '1',
      ripgrep: join(resources, 'ripgrep', 'rg'),
    })
    expect(desktop.map((r) => r.message)).toEqual(expect.arrayContaining(['sidecar ready', 'app quitting']))
    expect(desktop.find((r) => r.logger === 'coko.renderer.smoke')).toMatchObject({
      message: 'smoke marker [REDACTED]',
      properties: { source: 'renderer', apiKey: '[REDACTED]' },
    })
    const selected = sidecarLog.find((r) => r.message === 'grep implementation selected')
    expect(selected?.properties).toMatchObject({ implementation: 'ripgrep', path: join(resources, 'ripgrep', 'rg') })
    expect(String(selected?.properties.version)).toMatch(/^ripgrep \d+\.\d+\.\d+/)
    expect(sidecarLog.some((r) => r.message === 'run ended' && r.properties.status === 'completed')).toBe(true)
    for (const file of ['desktop.jsonl', 'sidecar.jsonl']) {
      const text = await readFile(join(logs, file), 'utf8')
      expect(text).not.toContain('plain-secret')
      expect(text).not.toContain('sk-smokeSecretValue1')
      expect(text).not.toMatch(TOKEN_SHAPED)
    }
  })
})
