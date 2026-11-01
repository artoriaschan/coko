// 设置 → 代码智能分区：真实 Electron + 真实 Sidecar（faux）与仓库内的 LSP 假服务器。编辑全局 JSON（非法时行内诊断、不保存），保存后列表显示假服务器；
// Agent 调用 lsp 后工具卡显示操作、文件位置与结果计数，分区中状态为 running；键盘"重启"后换成新的进程；明暗主题。
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, onTestFinished } from 'vitest'
import { launchApp, processExists, stubDirectoryPicker, waitConnected, type LaunchedApp } from './harness.ts'

const lspFixture = fileURLToPath(new URL('../../../tests/fixtures/lsp/server.mjs', import.meta.url))

const apps: LaunchedApp[] = []
afterEach(async () => {
  for (const app of apps.splice(0)) await app.dispose()
})

describe('代码智能分区', () => {
  it('编辑全局 JSON（诊断、保存后列表）、Agent 调用后 running 与工具卡、键盘重启、明暗主题', async () => {
    const root = await mkdtemp(join(tmpdir(), 'coko-lsp-e2e-'))
    onTestFinished(() => rm(root, { recursive: true, force: true }))
    const workspace = join(root, 'workspace')
    await mkdir(workspace)
    await writeFile(join(workspace, 'a.ts'), 'export const value = 1\nconsole.log(value)\n')
    const at = (line: number, character: number) => ({ start: { line, character }, end: { line, character: character + 5 } })
    const uri = pathToFileURL(join(workspace, 'a.ts')).href
    await writeFile(
      join(root, 'faux.json'),
      JSON.stringify({
        responses: [
          { content: [{ type: 'toolCall', name: 'lsp', id: 'l1', arguments: { operation: 'references', file_path: 'a.ts', line: 1, character: 14 } }] },
          { content: 'Two references.' },
        ],
      }),
    )
    const app = await launchApp({ COKO_FAUX_SCRIPT: join(root, 'faux.json') }, { dir: root })
    apps.push(app)
    const { window } = app
    await waitConnected(window)
    await stubDirectoryPicker(app.app, [workspace])
    await window
      .getByRole('button', { name: /^(Add workspace|添加工作区)$/ })
      .first()
      .click()
    await window.getByRole('heading', { level: 1, name: /^(New session|新会话)$/ }).waitFor()

    const openSection = async () => {
      await window.getByRole('button', { name: /^(Settings|设置)$/ }).click()
      const dialog = window.locator('[data-settings-page]')
      await dialog.locator('[data-section="lsp"]').click()
      const section = dialog.locator('[data-lsp-section]')
      await section.waitFor()
      return { dialog, section }
    }
    const closeSettings = async () => {
      await window.keyboard.press('Escape')
      await window.locator('[data-settings-page]').waitFor({ state: 'detached' })
    }
    let { section } = await openSection()
    await section.getByText(/No language servers configured yet|还没有配置语言服务器/).waitFor()

    // 非法 JSON 与服务端诊断：行内显示，不保存。
    const editor = section.locator('textarea[name="lsp-global"]')
    const save = section.locator('[data-action="save-lsp-global"]')
    const problem = section.locator('[data-lsp-problem]')
    await editor.fill('{ "ts": ')
    await save.click()
    await expect.poll(() => problem.textContent()).toMatch(/^(Invalid JSON|JSON 无法解析)/)
    await editor.fill(JSON.stringify({ ts: { command: 'node', extensionToLanguage: { ts: 'typescript' } } }))
    await save.click()
    await expect.poll(() => problem.locator('[data-diagnostic="invalid-lsp-server"]').count()).toBe(1)
    expect(await section.locator('[data-lsp-editor="global"]').getAttribute('data-revision')).toBe('0')

    // 保存后列表显示假服务器（idle）。
    const servers = {
      ts: {
        command: process.execPath,
        args: [
          lspFixture,
          '--references',
          JSON.stringify([
            { uri, range: at(0, 13) },
            { uri, range: at(1, 12) },
          ]),
        ],
        extensionToLanguage: { '.ts': 'typescript' },
      },
    }
    await editor.fill(JSON.stringify(servers))
    await save.click()
    await expect.poll(() => section.locator('[data-lsp-editor="global"]').getAttribute('data-revision')).toBe('1')
    const row = section.locator('[data-lsp-server="ts"]')
    await expect.poll(() => row.getAttribute('data-state')).toBe('idle')
    expect(await row.textContent()).toContain('.ts')
    await closeSettings()

    // Agent 调用 lsp：工具卡显示操作、文件位置与结果计数。
    const composer = window.getByRole('textbox', { name: /Give Coko a task|向 Coko 布置任务/ })
    await composer.click()
    await composer.fill('find the references')
    await composer.press('Enter')
    const card = window.locator('[data-slot="tool-card"][data-tool="lsp"]')
    await expect.poll(() => card.getAttribute('data-status'), { timeout: 30_000 }).toBe('done')
    const header = card.getByRole('button', { name: /(Find references|查找引用)/ })
    expect(await header.textContent()).toContain('a.ts:1:14')
    await header.click()
    await expect.poll(() => card.locator('[data-lsp-count]').textContent()).toMatch(/^(2 items|2 项)$/)
    expect(await card.textContent()).toContain('a.ts:2:13 console.log(value)')
    await window.locator('[data-action="send"]').waitFor({ timeout: 30_000 })

    // 分区：状态 running；键盘"重启"后为新的进程。
    ;({ section } = await openSection())
    await expect.poll(() => row.getAttribute('data-state'), { timeout: 15_000 }).toBe('running')
    const pidOf = async () => Number(/(\d+)/.exec((await row.textContent()) ?? '')?.[1] ?? NaN)
    const before = await pidOf()
    expect(processExists(before)).toBe(true)
    await row.locator('[data-action="restart-lsp"]').focus()
    await window.keyboard.press('Enter')
    await expect.poll(async () => (await row.getAttribute('data-state')) === 'running' && (await pidOf()) !== before, { timeout: 15_000 }).toBe(true)
    await expect.poll(() => processExists(before), { timeout: 10_000 }).toBe(false)

    // 明暗主题：状态文字不与背景同色。
    const dialog = window.locator('[data-settings-page]')
    for (const theme of ['dark', 'light'] as const) {
      await dialog.locator('[data-section="general"]').click()
      await dialog.locator(`[data-theme-option="${theme}"]`).click()
      await expect.poll(() => window.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(theme === 'dark')
      await dialog.locator('[data-section="lsp"]').click()
      const colors = await section.locator('[data-lsp-server="ts"]').evaluate((el) => {
        const state = el.querySelector('[data-lsp-state]')!
        let node: Element | null = el
        let background = 'rgba(0, 0, 0, 0)'
        while (node && /rgba\(.*,\s*0\)$|transparent/.test(background)) {
          background = getComputedStyle(node).backgroundColor
          node = node.parentElement
        }
        return [getComputedStyle(state).color, background]
      })
      expect(colors[0]).not.toBe(colors[1])
    }
  })
})
