// MCP 分区：真实 Electron + 真实 Sidecar + 仓库内的 stdio 测试 Server。添加 stdio Server 后看到 connected 与工具数，
// 停用后工具消失；登记 Secret 只显示末四位（值经 preload → main safeStorage → secret.store，ADR 0007）；批准项目 Server 的对话框显示完整命令。
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, onTestFinished } from 'vitest'
import { launchApp, stubDirectoryPicker, waitConnected, type LaunchedApp } from './harness.ts'

/** 仓库内的 stdio MCP 测试 Server（tests/fixtures/mcp/），以测试进程的 node 启动。 */
const stdioServerEntry = fileURLToPath(new URL('../../../tests/fixtures/mcp/stdio-server.ts', import.meta.url))

const apps: LaunchedApp[] = []
afterEach(async () => {
  for (const app of apps.splice(0)) await app.dispose()
})

async function filesUnder(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true }).catch(() => [])
  return entries.filter((e) => e.isFile()).map((e) => join(e.parentPath, e.name))
}

describe('MCP 分区', () => {
  it('添加 stdio Server → connected 与工具数，停用后工具消失；Secret 只显示末四位；项目 Server 的批准对话框显示完整命令', async () => {
    const root = await mkdtemp(join(tmpdir(), 'coko-mcp-e2e-'))
    onTestFinished(() => rm(root, { recursive: true, force: true }))
    const workspace = join(root, 'workspace')
    await mkdir(workspace)
    const projectLog = join(root, 'project.jsonl')
    await writeFile(
      join(workspace, '.mcp.json'),
      JSON.stringify({ mcpServers: { proj: { command: process.execPath, args: [stdioServerEntry, '--project'], env: { MCP_FIXTURE_LOG: projectLog } } } }),
    )
    await writeFile(join(root, 'faux.json'), JSON.stringify({ responses: [] }))
    const app = await launchApp({ COKO_FAUX_SCRIPT: join(root, 'faux.json') }, { dir: root })
    apps.push(app)
    const { window } = app
    await waitConnected(window)
    await stubDirectoryPicker(app.app, [workspace])
    await window
      .getByRole('button', { name: /^(Add workspace|添加工作区)$/ })
      .first()
      .click()
    await window.getByRole('heading', { level: 1, name: /^(New chat|新对话)$/ }).waitFor()
    await window.getByRole('button', { name: /^(Settings|设置)$/ }).click()
    const dialog = window.locator('[data-settings-page]')
    await dialog.locator('[data-section="mcp"]').click()

    // 添加 stdio Server。
    await dialog.getByRole('button', { name: /^(Add server|添加 Server)$/ }).click()
    const form = dialog.locator('[data-mcp-form]')
    await form.locator('input[name="name"]').fill('fixture')
    await form.locator('input[name="command"]').fill(process.execPath)
    await form.locator('textarea[name="args"]').fill(stdioServerEntry)
    await form.locator('input[name="disabledTools"]').fill('hidden')
    await form.locator('button[type="submit"]').click()
    await form.waitFor({ state: 'detached' })
    const card = dialog.locator('[data-mcp-server="fixture"]')
    await expect.poll(() => card.getAttribute('data-status'), { timeout: 20_000 }).toBe('connected')
    expect(await card.getAttribute('data-tool-count')).toBe('6')
    await card.locator('[data-mcp-tools]').click()
    await card.locator('[data-mcp-tool="mcp__fixture__echo"]').waitFor()
    expect(await card.locator('[data-mcp-tool="mcp__fixture__hidden"]').count()).toBe(0)

    // 停用：连接关闭，工具消失。
    await card.locator('[data-action="toggle"]').click()
    await expect.poll(() => card.getAttribute('data-status')).toBe('disabled')
    expect(await card.getAttribute('data-tool-count')).toBe('0')
    expect(await card.locator('[data-mcp-tools]').count()).toBe(0)

    // 登记 Secret：只显示末四位，输入框随即清空。
    const secret = 'postgres://svc:e2e-secret-value@db/app-9f3c'
    const secrets = dialog.locator('[data-secrets]')
    await secrets.locator('input[name="secretName"]').fill('MY_SERVICE_DSN')
    await secrets.locator('input[name="secretValue"]').fill(secret)
    await secrets.locator('[data-secret-form] button[type="submit"]').click()
    const row = secrets.locator('[data-secret="MY_SERVICE_DSN"]')
    await row.waitFor()
    await expect.poll(() => row.locator('[data-secret-hint]').textContent()).toMatch(/9f3c$/)
    expect(await secrets.locator('input[name="secretValue"]').inputValue()).toBe('')
    expect(await window.evaluate(() => document.body.innerText)).not.toContain(secret)
    const listed = await window.evaluate(() => fetch('/api/secrets').then((r) => r.text()))
    expect(listed).toContain('"hint":"9f3c"')
    expect(listed).not.toContain(secret)

    // 项目 Server：等待批准；对话框显示完整命令与参数；批准后启动。
    const project = dialog.locator('[data-mcp-server="proj"]')
    expect(await project.getAttribute('data-status')).toBe('pending-approval')
    await project.locator('[data-action="review"]').click()
    const approval = window.locator('[data-mcp-approval="proj"]')
    await approval.waitFor()
    expect(await approval.locator('[data-launch="command"]').textContent()).toBe(process.execPath)
    expect(await approval.locator('[data-launch="args"]').textContent()).toBe(`${stdioServerEntry} --project`)
    // 环境变量显示完整的键值（项目文件只有字面值）。
    expect(await approval.locator('[data-launch="env"]').textContent()).toBe(`MCP_FIXTURE_LOG=${projectLog}`)
    await approval.locator('[data-action="approve"]').click()
    await approval.waitFor({ state: 'detached' })
    await expect.poll(() => project.getAttribute('data-status'), { timeout: 20_000 }).toBe('connected')
    await expect.poll(async () => (await readFile(projectLog, 'utf8').catch(() => '')).includes('"start"')).toBe(true)

    await app.dispose()
    // 用户数据目录（库、WAL、日志、Chromium 存储）中没有 Secret 明文。
    const files = await filesUnder(join(root, 'user-data'))
    expect(files.some((f) => f.endsWith('coko.db'))).toBe(true)
    const leaking: string[] = []
    for (const file of files) if ((await readFile(file)).includes(secret)) leaking.push(file)
    expect(leaking).toEqual([])
  })
})
