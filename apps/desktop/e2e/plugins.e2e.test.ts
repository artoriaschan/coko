// 设置 → 插件分区：真实 Electron + 真实 Sidecar。从夹具目录（tests/fixtures/plugins/sample 的临时副本，占位替换为绝对路径）经目录选择安装 →
// 待批准 → 批准对话框显示 Hook 的完整命令（Esc 关闭不批准）→ Tab 到"批准"后 Enter → 启用；新会话的 / 命令菜单出现 sample:hello，禁用后消失；
// 改动副本中的 Hook 命令后"更新"→ 回到待批准且对话框显示新命令；卸载确认后列表为空、安装目录被删除；明暗主题下状态文字的对比度。
import { existsSync } from 'node:fs'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Locator, Page } from 'playwright'
import { afterEach, describe, expect, it, onTestFinished } from 'vitest'
import { cokoHomeOf, launchApp, stubDirectoryPicker, waitConnected, type LaunchedApp } from './harness.ts'

const pluginFixture = fileURLToPath(new URL('../../../tests/fixtures/plugins/sample', import.meta.url))
const hookFixture = fileURLToPath(new URL('../../../tests/fixtures/hooks/hook.mjs', import.meta.url))
const mcpFixture = fileURLToPath(new URL('../../../tests/fixtures/mcp/stdio-server.ts', import.meta.url))
const lspFixture = fileURLToPath(new URL('../../../tests/fixtures/lsp/server.mjs', import.meta.url))

const apps: LaunchedApp[] = []
afterEach(async () => {
  for (const app of apps.splice(0)) await app.dispose()
})

/** 插件夹具的临时副本：占位替换为绝对路径（见夹具 README）；返回副本目录与替换后的 Hook 命令。 */
async function preparePlugin(root: string) {
  const plugin = join(root, 'sample')
  await cp(pluginFixture, plugin, { recursive: true })
  const values: Record<string, string> = {
    NODE: process.execPath,
    HOOK_FIXTURE: hookFixture,
    HOOK_RECORD: join(root, 'hook-stdin.jsonl'),
    MCP_FIXTURE: mcpFixture,
    MCP_LOG: join(root, 'mcp.jsonl'),
    LSP_FIXTURE: lspFixture,
  }
  for (const file of ['hooks/hooks.json', '.mcp.json', '.lsp.json']) {
    let text = await readFile(join(plugin, file), 'utf8')
    for (const [name, value] of Object.entries(values)) text = text.replaceAll('${' + name + '}', value)
    await writeFile(join(plugin, file), text)
  }
  const hooks = JSON.parse(await readFile(join(plugin, 'hooks/hooks.json'), 'utf8')) as { hooks: { PreToolUse: { hooks: { command: string }[] }[] } }
  return { plugin, command: hooks.hooks.PreToolUse[0]!.hooks[0]!.command }
}

/** / 菜单中是否有 /sample:hello（打开菜单读取后按 Esc 关闭并清空输入）。 */
async function hasSampleHello(page: Page): Promise<boolean> {
  const composer = page.getByRole('textbox', { name: /Give Coko a task|向 Coko 布置任务/ })
  await composer.click()
  await page.keyboard.type('/')
  const menu = page.getByRole('listbox', { name: /^(Commands|命令)$/ })
  await menu.waitFor()
  const found = (await menu.getByRole('option').allTextContents()).some((text) => text.startsWith('/sample:hello'))
  await page.keyboard.press('Escape')
  await menu.waitFor({ state: 'detached' })
  await page.keyboard.press('Backspace')
  return found
}

/** 文字颜色对最近的不透明背景的对比度。 */
const contrast = (locator: Locator) =>
  locator.evaluate((el) => {
    const rgb = (v: string) =>
      v
        .match(/[\d.]+/g)!
        .slice(0, 3)
        .map(Number)
    const lum = (c: number[]) => {
      const f = (x: number) => ((x /= 255) <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)
      return 0.2126 * f(c[0]!) + 0.7152 * f(c[1]!) + 0.0722 * f(c[2]!)
    }
    let node: Element | null = el
    let bg = ''
    while (node) {
      const color = getComputedStyle(node).backgroundColor
      if (color !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(color)) {
        bg = color
        break
      }
      node = node.parentElement
    }
    const [a, b] = [lum(rgb(getComputedStyle(el).color)), lum(rgb(bg || getComputedStyle(document.documentElement).backgroundColor))].sort((x, y) => y - x)
    return (a! + 0.05) / (b! + 0.05)
  })

describe('插件分区', () => {
  it('目录安装 → 批准对话框的完整命令 → 批准启用；/ 菜单随启停变化；更新回到待批准；卸载；明暗主题与键盘', async () => {
    const root = await mkdtemp(join(tmpdir(), 'coko-plugins-e2e-'))
    onTestFinished(() => rm(root, { recursive: true, force: true }))
    const workspace = join(root, 'workspace')
    await mkdir(workspace)
    const { plugin, command } = await preparePlugin(root)
    await writeFile(join(root, 'faux.json'), JSON.stringify({ responses: [] }))
    const app = await launchApp({ COKO_FAUX_SCRIPT: join(root, 'faux.json') }, { dir: root })
    apps.push(app)
    const page = app.window
    await waitConnected(page)
    // 第一次选择用于登记 Workspace，第二次用于"从文件夹安装"。
    await stubDirectoryPicker(app.app, [workspace, plugin])
    await page
      .getByRole('button', { name: /^(Add workspace|添加工作区)$/ })
      .first()
      .click()
    await page.getByRole('heading', { level: 1, name: /^(New chat|新对话)$/ }).waitFor()
    // 安装前：/ 菜单没有插件命令。
    expect(await hasSampleHello(page)).toBe(false)

    const settings = page.locator('[data-settings-page]')
    const openPlugins = async () => {
      await page.getByRole('button', { name: /^(Settings|设置)$/ }).click()
      await settings.locator('[data-section="plugins"]').click()
      await settings.locator('[data-plugins-section]').waitFor()
    }
    const backToApp = async () => {
      await settings.getByRole('button', { name: /^(Back to app|返回应用)$/ }).click()
      await settings.waitFor({ state: 'detached' })
    }
    await openPlugins()
    const section = settings.locator('[data-plugins-section]')
    const card = section.locator('[data-plugin="sample"]')

    // 从文件夹安装：待批准，批准对话框自动打开并显示 Hook 的完整命令。
    await section.locator('[data-action="install-folder"]').click()
    const dialog = page.locator('[data-plugin-approval="sample"]')
    await dialog.waitFor()
    await expect.poll(() => card.getAttribute('data-status')).toBe('needs-approval')
    expect(await dialog.locator('[data-approval-hook="0"] [data-approval-command]').textContent()).toBe(command)
    expect(await dialog.locator('[data-approval-mcp="plugin-sample-echo"]').textContent()).toContain(mcpFixture)
    expect(await dialog.locator('[data-approval-lsp="sample:ts"]').textContent()).toContain(lspFixture)
    expect(await dialog.locator('[data-approval-names="commands"] p').textContent()).toBe('sample:hello')
    // 长命令换行显示，不超出对话框。
    const fits = await dialog.locator('[data-approval-hook="0"] [data-approval-command]').evaluate((el) => {
      const box = el.getBoundingClientRect()
      const outer = el.closest('[data-slot="dialog-content"]')!.getBoundingClientRect()
      return el.scrollWidth <= el.clientWidth + 1 && box.right <= outer.right && box.left >= outer.left
    })
    expect(fits).toBe(true)

    // Esc 关闭：不批准。
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'detached' })
    expect(await card.getAttribute('data-status')).toBe('needs-approval')
    expect(existsSync(join(cokoHomeOf(root), 'plugins', 'sample', '.coko-plugin', 'plugin.json'))).toBe(true)

    // 键盘：重新打开，Tab 到"批准"后 Enter。
    await card.locator('[data-action="review"]').click()
    await dialog.waitFor()
    const approve = dialog.locator('[data-action="approve-plugin"]')
    for (let i = 0; i < 6 && !(await approve.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('Tab')
    expect(await approve.evaluate((el) => el === document.activeElement && el.matches(':focus-visible'))).toBe(true)
    await page.keyboard.press('Enter')
    await dialog.waitFor({ state: 'detached' })
    await expect.poll(() => card.getAttribute('data-status')).toBe('enabled')

    // 新会话的 / 菜单出现 sample:hello。
    await backToApp()
    await expect.poll(() => hasSampleHello(page), { timeout: 15_000 }).toBe(true)

    // 禁用后消失。
    await openPlugins()
    await card.locator('[data-action="toggle"]').click()
    await expect.poll(() => card.getAttribute('data-status')).toBe('disabled')
    await backToApp()
    await expect.poll(() => hasSampleHello(page), { timeout: 15_000 }).toBe(false)

    // 改动副本中的 Hook 命令后"更新"：回到待批准，对话框显示新命令。
    const changed = `${command} --changed`
    const hooksFile = join(plugin, 'hooks', 'hooks.json')
    await writeFile(hooksFile, (await readFile(hooksFile, 'utf8')).replace(JSON.stringify(command).slice(1, -1), JSON.stringify(changed).slice(1, -1)))
    await openPlugins()
    await card.locator('[data-action="update"]').click()
    await expect.poll(() => card.getAttribute('data-status')).toBe('needs-approval')
    await card.locator('[data-action="review"]').click()
    await dialog.waitFor()
    expect(await dialog.locator('[data-approval-hook="0"] [data-approval-command]').textContent()).toBe(changed)
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'detached' })

    // 明暗主题：状态文字对卡片背景的对比度。
    for (const theme of ['dark', 'light'] as const) {
      await settings.locator('[data-section="general"]').click()
      await settings.locator(`[data-theme-option="${theme}"]`).click()
      await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(theme === 'dark')
      await settings.locator('[data-section="plugins"]').click()
      expect(await contrast(card.locator('[data-plugin-status]'))).toBeGreaterThanOrEqual(4.5)
    }

    // 卸载：确认后列表为空，安装目录被删除。
    await card.locator('[data-action="uninstall"]').click()
    const confirm = page.locator('[data-plugin-uninstall="sample"]')
    await confirm.waitFor()
    await confirm.locator('[data-action="confirm-uninstall"]').click()
    await confirm.waitFor({ state: 'detached' })
    await section.locator('[data-plugins-empty]').waitFor()
    expect(await section.locator('[data-plugin]').count()).toBe(0)
    expect(existsSync(join(cokoHomeOf(root), 'plugins', 'sample'))).toBe(false)
    expect(await page.evaluate(async () => (await (await fetch('/api/plugins')).json()) as unknown[])).toEqual([])
  })
})
