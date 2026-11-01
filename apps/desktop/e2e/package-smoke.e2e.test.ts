// 产物 smoke：对 electron-forge package 的输出（out/）运行真实应用，完成一次 faux 对话，确认 grep 使用随包 ripgrep，
// 并在审批卡中允许一次 bash 写入；批准的 Workspace 外写入被产物中的 Seatbelt 拦截（只在 darwin 断言）。
// M3：临时 COKO_HOME 的 AGENTS.md 出现在 faux requestLog 的系统提示中（产物同样读取 COKO_HOME）；仓库内的 stdio MCP 测试 Server
// 的工具经审批调用成功（pi-mcp 与 cross-spawn 进入 sidecar 产物）。
// M4：Resources/sidecar/node_modules/node-pty 的 spawn-helper 可执行，打包应用中一个 tty 后台任务输出 ok（node-pty 从随包位置加载）。
// 打包产物关闭了 Node 调试参数（Fuses），Playwright 的 _electron.launch 不可用：直接启动可执行文件并经 CDP 连接窗口。
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import { describe, expect, it, onTestFinished } from 'vitest'
import { BACKGROUND_ENV, processExists, waitFor } from './harness.ts'
import { readLogRecords, TOKEN_SHAPED } from './logs.ts'

const desktopRoot = fileURLToPath(new URL('..', import.meta.url))
/** 仓库内的 stdio MCP 测试 Server（tests/fixtures/mcp/），以测试进程的 node 启动。 */
const stdioServerEntry = fileURLToPath(new URL('../../../tests/fixtures/mcp/stdio-server.ts', import.meta.url))
/** 仓库内的 LSP 假服务器（tests/fixtures/lsp/），以测试进程的 node 启动。 */
const lspServerEntry = fileURLToPath(new URL('../../../tests/fixtures/lsp/server.mjs', import.meta.url))
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

describe('打包产物 smoke', { timeout: 180_000 }, () => {
  it('globalSetup 已产出可执行文件', () => {
    expect(existsSync(executable)).toBe(true)
  })

  it.skipIf(process.platform !== 'darwin')('PTY：随包 node-pty 的 spawn-helper 可执行，tty 后台任务输出 ok', async () => {
    const ptyRoot = join(resources, 'sidecar', 'node_modules', 'node-pty')
    const helper = join(ptyRoot, 'prebuilds', `darwin-${process.arch}`, 'spawn-helper')
    expect((await stat(helper)).mode & 0o111).not.toBe(0)

    const root = await mkdtemp(join(tmpdir(), 'coko-packaged-pty-'))
    onTestFinished(() => rm(root, { recursive: true, force: true }))
    const workspace = join(root, 'workspace')
    await mkdir(workspace)
    const script = join(root, 'faux.json')
    await writeFile(
      script,
      JSON.stringify({
        responses: [
          { content: [{ type: 'toolCall', name: 'bash', id: 't1', arguments: { command: 'echo ok', run_in_background: true, tty: true } }] },
          { content: [{ type: 'toolCall', name: 'job_output', id: 'o1', arguments: { job_id: '$LAST_JOB_ID', wait: true, timeout_ms: 20_000 } }] },
          { content: 'done' },
        ],
      }),
    )
    const userData = join(root, 'user-data')
    const app = await launchPackaged({ COKO_USER_DATA_DIR: userData, COKO_FAUX_SCRIPT: script, COKO_HOME: join(root, 'coko-home') })
    const { page } = app
    await waitConnected(page)
    // 经协议代理建会话并提交（full-access：不经审批），轮询 Job 列表与日志输出。
    const sessionId = await page.evaluate(async (path) => {
      const post = (url: string, body: unknown, method: 'POST' | 'PUT' = 'POST') =>
        fetch(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json().catch(() => null))
      const workspaceId = ((await post('/api/workspaces', { path })) as { id: string }).id
      const id = ((await post('/api/sessions', { workspaceId })) as { id: string }).id
      await post(`/api/sessions/${id}/permission-mode`, { mode: 'full-access' }, 'PUT')
      await post(`/api/sessions/${id}/messages`, { text: 'run a tty job' })
      return id
    }, workspace)
    const jobs = () =>
      page.evaluate(
        async (id) => ((await (await fetch(`/api/sessions/${id}/jobs`)).json()) as { jobs: { jobId: string; kind: string; status: string }[] }).jobs,
        sessionId,
      )
    await expect.poll(jobs, { timeout: 30_000 }).toMatchObject([{ kind: 'pty', status: 'completed' }])
    const [job] = await jobs()
    const output = await page.evaluate(async (jobId) => ((await (await fetch(`/api/jobs/${jobId}/output`)).json()) as { chunk: string }).chunk, job!.jobId)
    expect(output).toBe('ok\r\n')

    await app.browser.close()
    app.child.kill('SIGTERM')
    expect(await app.exited).toBe(0)
    const sidecarLog = await readLogRecords(join(userData, 'logs', 'sidecar.jsonl'))
    expect(sidecarLog.find((r) => r.message === 'pty backend selected')?.properties).toMatchObject({
      backend: 'node-pty',
      path: join(ptyRoot, 'package.json'),
    })
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
    // 用户级指令（临时 COKO_HOME，不读真实的 ~/.coko）。
    const cokoHome = join(root, 'coko-home')
    await mkdir(cokoHome)
    await writeFile(join(cokoHome, 'AGENTS.md'), 'SMOKE-USER-RULE: answer briefly.\n')
    const script = join(root, 'faux.json')
    const requestLog = join(root, 'requests.jsonl')
    await writeFile(
      script,
      JSON.stringify({
        tokensPerSecond: 40,
        requestLog,
        responses: [
          { content: [{ type: 'toolCall', name: 'grep', id: 'g1', arguments: { pattern: 'needle' } }] },
          { content: [{ type: 'toolCall', name: 'mcp__fixture__echo', id: 'm1', arguments: { text: 'from-package' } }] },
          { content: [{ type: 'toolCall', name: 'bash', id: 'b1', arguments: { command: 'printf found > found.txt' } }] },
          { content: [{ type: 'toolCall', name: 'bash', id: 'b2', arguments: { command: `printf leak > ${join(outside, 'leak.txt')}` } }] },
          { content: 'Found the needle in **notes.txt**.' },
        ],
      }),
    )
    const userData = join(root, 'user-data')
    const app = await launchPackaged({ COKO_USER_DATA_DIR: userData, COKO_FAUX_SCRIPT: script, TMPDIR: temp, COKO_HOME: cokoHome })
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
    // stdio MCP 测试 Server（以测试进程的 node 启动）：产物中的 Sidecar 经 pi-mcp / cross-spawn 连接。
    const workspaceId = (registered.body as unknown as { id: string }).id
    const mcp = await page.evaluate(
      async (body) => (await fetch('/api/mcp/servers', { method: 'PUT', headers: { 'content-type': 'application/json' }, body })).status,
      JSON.stringify({ servers: { fixture: { command: process.execPath, args: [stdioServerEntry] } }, expectedRevision: 0, workspaceId }),
    )
    expect(mcp).toBe(200)
    await waitFor(
      () =>
        page.evaluate(async (id) => {
          const body = (await (await fetch('/api/mcp?workspaceId=' + id)).json()) as { servers: { name: string; status: string }[] }
          return body.servers.some((s) => s.name === 'fixture' && s.status === 'connected')
        }, workspaceId),
      30_000,
      'mcp fixture connected',
    )
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
    // MCP 工具调用（external 类，默认需审批）：允许一次后 stdio 测试 Server 回显。
    const approval = page.locator('[data-slot="approval-card"]')
    await approval.waitFor({ timeout: 30_000 })
    await approval.getByRole('button', { name: /^(Allow once|允许一次)$/ }).click()
    const mcpCard = page.locator('[data-slot="tool-card"][data-tool="mcp__fixture__echo"]')
    await expect.poll(() => mcpCard.getAttribute('data-status'), { timeout: 30_000 }).toBe('done')
    await mcpCard.locator('[aria-expanded]').first().click()
    await expect.poll(() => mcpCard.textContent()).toContain('echo:from-package')
    // 审批：bash 写入在产物中经审批卡允许一次后执行。
    await expect.poll(() => approval.textContent().catch(() => ''), { timeout: 30_000 }).toContain('printf found')
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
    // 发送按钮恢复时最后一条回复可能仍是流式显示（Markdown 原文），等提交的条目渲染完成。
    await expect.poll(() => page.getByRole('article', { name: 'Coko' }).last().textContent(), { timeout: 15_000 }).toBe('Found the needle in notes.txt.')

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
    // COKO_HOME 的 AGENTS.md 进入第一次模型请求的系统提示。
    const firstRequest = JSON.parse((await readFile(requestLog, 'utf8')).split('\n')[0]!) as { role: string; sections?: Record<string, string> }[]
    expect(Object.values(firstRequest[0]?.sections ?? {}).join('\n')).toContain('SMOKE-USER-RULE: answer briefly.')
    for (const file of ['desktop.jsonl', 'sidecar.jsonl']) {
      const text = await readFile(join(logs, file), 'utf8')
      expect(text).not.toContain('plain-secret')
      expect(text).not.toContain('sk-smokeSecretValue1')
      expect(text).not.toMatch(TOKEN_SHAPED)
    }
  })

  // 插件声明的语言服务器在产物中经插件核心的安装与批准提供（COKO_TEST_PLUGINS 在 --packaged 时被忽略）；这里用全局配置的服务器验证产物中的
  // 语言服务器客户端与进程登记：lsp 调用经假服务器回答（接收侧：假服务器的记录），进程登记为 kind lsp，应用退出后进程退出、登记删除。
  it('语言服务器：lsp 调用经假服务器回答，进程登记为 kind lsp；退出后进程退出、登记删除', async () => {
    const root = await mkdtemp(join(tmpdir(), 'coko-packaged-lsp-'))
    onTestFinished(() => rm(root, { recursive: true, force: true }))
    const workspace = join(root, 'workspace')
    await mkdir(workspace)
    await writeFile(join(workspace, 'a.ts'), 'export const value = 1\n')
    const record = join(root, 'lsp.jsonl')
    const script = join(root, 'faux.json')
    await writeFile(
      script,
      JSON.stringify({
        responses: [
          { content: [{ type: 'toolCall', name: 'lsp', id: 'l1', arguments: { operation: 'hover', file_path: 'a.ts', line: 1, character: 14 } }] },
          { content: 'hovered' },
        ],
      }),
    )
    const userData = join(root, 'user-data')
    const app = await launchPackaged({ COKO_USER_DATA_DIR: userData, COKO_FAUX_SCRIPT: script, COKO_HOME: join(root, 'coko-home') })
    const { page } = app
    await waitConnected(page)
    const sessionId = await page.evaluate(
      async ({ path, server }) => {
        const call = (url: string, body: unknown, method: 'POST' | 'PUT' = 'POST') =>
          fetch(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json().catch(() => null))
        await call('/api/lsp', { scope: 'global', servers: { ts: server }, expectedRevision: 0 }, 'PUT')
        const workspaceId = ((await call('/api/workspaces', { path })) as { id: string }).id
        const id = ((await call('/api/sessions', { workspaceId })) as { id: string }).id
        await call(`/api/sessions/${id}/permission-mode`, { mode: 'full-access' }, 'PUT')
        await call(`/api/sessions/${id}/messages`, { text: 'hover' })
        return id
      },
      {
        path: workspace,
        server: {
          command: process.execPath,
          args: [lspServerEntry, '--record', record, '--hover', 'packaged hover'],
          extensionToLanguage: { '.ts': 'typescript' },
        },
      },
    )
    const status = () =>
      page.evaluate(
        async (id) => ((await (await fetch(`/api/lsp?sessionId=${encodeURIComponent(id)}`)).json()) as { status: { state: string; pid?: number }[] }).status,
        sessionId,
      )
    await expect.poll(async () => (await status())[0]?.state, { timeout: 30_000 }).toBe('running')
    const pid = (await status())[0]!.pid!
    onTestFinished(() => {
      if (processExists(pid)) process.kill(pid, 'SIGKILL')
    })
    // 接收侧：假服务器收到 initialize（rootUri 为 Workspace）与 hover。
    await expect.poll(async () => (await readFile(record, 'utf8').catch(() => '')).includes('"method":"textDocument/hover"'), { timeout: 30_000 }).toBe(true)
    expect(await readFile(record, 'utf8')).toContain(`"rootUri":"file://${workspace}"`)
    const db = join(userData, 'data', 'coko.db')
    const lspRows = () => {
      const handle = new DatabaseSync(db, { readOnly: true })
      try {
        return handle.prepare("SELECT pid, kind FROM host_processes WHERE kind = 'lsp'").all() as { pid: number; kind: string }[]
      } finally {
        handle.close()
      }
    }
    await expect.poll(lspRows, { timeout: 10_000 }).toEqual([{ pid, kind: 'lsp' }])

    await app.browser.close()
    app.child.kill('SIGTERM')
    expect(await app.exited).toBe(0)
    await waitFor(() => !processExists(pid), 10_000, 'language server exit')
    expect(lspRows()).toEqual([])
  })
})
