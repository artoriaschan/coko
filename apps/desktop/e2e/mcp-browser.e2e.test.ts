// MCP 分区的浏览器预设与认证状态：真实 Electron + 真实 Sidecar（faux）。Sidecar 的 PATH 以假 npx 开头（启动仓库内的 stdio 测试 Server 并声明
// screenshot 工具），不从网络下载 Playwright MCP。键盘"添加浏览器"→ 确认 → 列表出现 playwright 并 connected；要求认证的 HTTP Server 显示
// "需要认证"（明暗主题下与背景可分），"编辑请求头"打开表单并聚焦 headers；Agent 调用 screenshot（审批后）工具卡显示缩略图（naturalWidth > 0）。
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, onTestFinished } from 'vitest'
import { createProjectDraft, launchApp, waitConnected, type LaunchedApp } from './harness.ts'

/** 仓库内的 stdio MCP 测试 Server（tests/fixtures/mcp/）。 */
const stdioServerEntry = fileURLToPath(new URL('../../../tests/fixtures/mcp/stdio-server.ts', import.meta.url))

const apps: LaunchedApp[] = []
afterEach(async () => {
  for (const app of apps.splice(0)) await app.dispose()
})

/** 对每个 POST 回 401 的 HTTP 端点（GET 405），计数请求。 */
async function unauthorizedServer() {
  let requests = 0
  const server = createServer((req, res) => {
    if (req.method !== 'POST') return void res.writeHead(405).end()
    requests++
    req.resume()
    req.on('end', () => res.writeHead(401, { 'www-authenticate': 'Bearer realm="e2e"' }).end('unauthorized'))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  onTestFinished(
    () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  )
  return { url: `http://127.0.0.1:${(server.address() as { port: number }).port}/mcp`, requests: () => requests }
}

describe('MCP 浏览器预设与认证', () => {
  it('键盘添加浏览器 → playwright connected；需要认证的徽标与编辑请求头；截图工具卡显示缩略图；明暗主题', async () => {
    const root = await mkdtemp(join(tmpdir(), 'coko-mcp-browser-'))
    onTestFinished(() => rm(root, { recursive: true, force: true }))
    const workspace = join(root, 'workspace')
    await mkdir(workspace)
    const bin = join(root, 'bin')
    await mkdir(bin)
    await writeFile(join(bin, 'npx'), `#!/bin/sh\nexport MCP_FIXTURE_FEATURES=screenshot\nexec '${process.execPath}' '${stdioServerEntry}' "$@"\n`)
    await chmod(join(bin, 'npx'), 0o755)
    const remote = await unauthorizedServer()
    await writeFile(
      join(root, 'faux.json'),
      JSON.stringify({
        responses: [
          { content: [{ type: 'toolCall', name: 'mcp__playwright__screenshot', id: 'p1', arguments: { url: 'https://example.test' } }] },
          { content: 'The page looks right.' },
        ],
      }),
    )
    const app = await launchApp({ COKO_FAUX_SCRIPT: join(root, 'faux.json'), PATH: `${bin}:${process.env.PATH ?? ''}` }, { dir: root })
    apps.push(app)
    const { window } = app
    await window.getByRole('heading', { level: 1, name: /^(New chat|新对话)$/ }).waitFor()
    await createProjectDraft(app, workspace)
    await window.getByRole('heading', { level: 1, name: /^(New chat|新对话)$/ }).waitFor()
    await window.getByRole('button', { name: /^(Settings|设置)$/ }).click()
    const dialog = window.locator('[data-settings-page]')
    await dialog.locator('[data-section="mcp"]').click()

    // 键盘：添加浏览器 → 菜单项 → 确认。
    const trigger = dialog.locator('[data-action="add-browser"]')
    await expect.poll(() => trigger.isEnabled()).toBe(true)
    await trigger.focus()
    await window.keyboard.press('Enter')
    const item = window.locator('[role="menuitem"][data-preset="playwright"]')
    await item.waitFor()
    await expect.poll(() => window.evaluate(() => document.activeElement?.getAttribute('role'))).toBe('menuitem')
    await window.keyboard.press('Enter')
    const confirm = window.locator('[data-mcp-preset="playwright"]')
    await confirm.waitFor()
    await window.locator('[role="menu"]').waitFor({ state: 'detached' })
    expect(await confirm.locator('[data-preset-command]').textContent()).toBe('npx -y @playwright/mcp@0.0.83 --isolated')
    await expect.poll(() => window.evaluate(() => (document.activeElement as HTMLInputElement | null)?.name)).toBe('presetName')
    await window.keyboard.press('Enter')
    await confirm.waitFor({ state: 'detached' })
    const browser = dialog.locator('[data-mcp-server="playwright"]')
    await expect.poll(() => browser.getAttribute('data-status'), { timeout: 30_000 }).toBe('connected')

    // 要求认证的 HTTP Server：需要认证、说明、编辑请求头（聚焦 headers）。
    const saved = await window.evaluate(async (url) => {
      const current = (await (await fetch('/api/mcp')).json()) as { global: Record<string, unknown>; globalRevision: number }
      const workspaceId = ((await (await fetch('/api/workspaces')).json()) as { workspaces: { id: string }[] }).workspaces[0]!.id
      const response = await fetch('/api/mcp/servers', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          servers: { ...current.global, remote: { url, headers: { Authorization: 'Bearer wrong' } } },
          expectedRevision: current.globalRevision,
          workspaceId,
        }),
      })
      return response.status
    }, remote.url)
    expect(saved).toBe(200)
    const card = dialog.locator('[data-mcp-server="remote"]')
    await expect.poll(() => card.getAttribute('data-status'), { timeout: 20_000 }).toBe('auth-required')
    expect(await card.locator('[data-mcp-status]').textContent()).toMatch(/^(Authentication required|需要认证)$/)
    expect(await card.locator('[data-mcp-auth]').textContent()).toContain('${NAME}')
    const attempts = remote.requests()
    await card.locator('[data-action="edit-headers"]').click()
    const headers = dialog.locator('[data-mcp-form] textarea[name="headers"]')
    await expect.poll(() => headers.evaluate((el) => el === document.activeElement)).toBe(true)
    expect(await headers.inputValue()).toBe('Authorization: Bearer wrong')
    await dialog
      .locator('[data-mcp-form]')
      .getByRole('button', { name: /^(Cancel|取消)$/ })
      .click()
    expect(remote.requests()).toBe(attempts)

    // 明暗主题：徽标文字与卡片背景可分。
    for (const theme of ['dark', 'light'] as const) {
      await dialog.locator('[data-section="general"]').click()
      await dialog.locator(`[data-theme-option="${theme}"]`).click()
      await expect.poll(() => window.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(theme === 'dark')
      await dialog.locator('[data-section="mcp"]').click()
      const colors = await card.evaluate((el) => {
        const status = el.querySelector('[data-mcp-status]')!
        let node: Element | null = el
        let background = 'rgba(0, 0, 0, 0)'
        while (node && /rgba\(.*,\s*0\)$|transparent/.test(background)) {
          background = getComputedStyle(node).backgroundColor
          node = node.parentElement
        }
        return [getComputedStyle(status).color, background]
      })
      expect(colors[0]).not.toBe(colors[1])
    }
    await window.keyboard.press('Escape')
    await window.locator('[data-settings-page]').waitFor({ state: 'detached' })

    // Agent 截图：审批后工具卡显示缩略图（实际解码）。
    const composer = window.getByRole('textbox', { name: /Give Coko a task|向 Coko 布置任务/ })
    await composer.click()
    await composer.fill('check the page')
    await composer.press('Enter')
    await waitConnected(window)
    await window
      .locator('[data-slot="approval-card"]')
      .getByRole('button', { name: /^(Allow once|允许一次)$/ })
      .click({ timeout: 30_000 })
    const tool = window.locator('[data-slot="tool-card"][data-tool="mcp__playwright__screenshot"]')
    await expect.poll(() => tool.getAttribute('data-status'), { timeout: 30_000 }).toBe('done')
    const processControl = window.locator('[data-slot="run-process-control"][aria-expanded="false"]')
    await processControl.waitFor()
    await processControl.click()
    await window.locator('[data-slot="process-group-header"]').click()
    await tool.getByRole('button', { name: /(Tool call|工具调用)/ }).click()
    const thumb = tool.locator('img[data-tool-image]')
    await thumb.waitFor()
    await expect.poll(() => thumb.evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBe(160)
    const opener = tool.locator('[data-action="open-image"]')
    await opener.focus()
    await window.keyboard.press('Enter')
    const preview = window.locator('[data-tool-image-dialog]')
    await preview.waitFor()
    await expect.poll(() => preview.locator('img').evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBe(160)
    await window.keyboard.press('Escape')
    await preview.waitFor({ state: 'detached' })
    await expect.poll(() => opener.evaluate((button) => button === document.activeElement)).toBe(true)
    expect(await tool.getByRole('button', { name: /(Tool call|工具调用)/ }).getAttribute('aria-expanded')).toBe('true')
  })
})
