// 分层配置的界面：真实 Electron + 真实 Sidecar。General 分区显示当前工作区的项目设置路径与诊断（可展开），
// Permissions 分区列出项目规则（只读、标出来源文件，没有删除入口）；能力开关写全局配置并注明被项目关闭的项。
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, onTestFinished } from 'vitest'
import { launchApp, stubDirectoryPicker, waitConnected, type LaunchedApp } from './harness.ts'

const apps: LaunchedApp[] = []
afterEach(async () => {
  for (const app of apps.splice(0)) await app.dispose()
})

describe('项目设置', () => {
  it('General 分区显示项目设置路径与诊断；Permissions 分区列出 project 规则且没有删除入口', async () => {
    const root = await mkdtemp(join(tmpdir(), 'coko-config-'))
    onTestFinished(() => rm(root, { recursive: true, force: true }))
    const workspace = join(root, 'workspace')
    await mkdir(join(workspace, '.coko'), { recursive: true })
    const settingsPath = join(workspace, '.coko', 'settings.json')
    await writeFile(
      settingsPath,
      JSON.stringify({ memory: { enabled: false }, theme: 'dark', permissions: { allow: ['Bash(*)'], deny: ['Bash(rm *)'], ask: ['Edit(src/**)'] } }),
    )
    await writeFile(join(root, 'faux.json'), JSON.stringify({ responses: [] }))
    const app = await launchApp({ COKO_FAUX_SCRIPT: join(root, 'faux.json') }, { dir: root })
    apps.push(app)
    await waitConnected(app.window)
    await stubDirectoryPicker(app.app, [workspace])
    await app.window
      .getByRole('button', { name: /^(Add workspace|添加工作区)$/ })
      .first()
      .click()
    await app.window.getByRole('heading', { level: 1, name: /^(New session|新会话)$/ }).waitFor()

    await app.window.getByRole('button', { name: /^(Settings|设置)$/ }).click()
    const dialog = app.window.locator('[data-settings-page]')
    const row = dialog.locator('[data-project-settings]')
    await row.waitFor()
    // macOS 的 tmpdir 可能经 /private 符号链接；Workspace 按登记的路径显示。
    expect(await row.getAttribute('data-project-settings')).toMatch(/workspace\/\.coko\/settings\.json$/)
    await expect.poll(() => row.locator('code').textContent()).toMatch(/workspace\/\.coko\/settings\.json$/)
    const toggle = row.getByRole('button', { name: /^(Show project settings issues|查看项目设置的问题)$/ })
    expect(await toggle.getAttribute('data-project-diagnostics')).toBe('2')
    expect(await toggle.getAttribute('aria-expanded')).toBe('false')
    expect(await row.locator('[data-diagnostic]').count()).toBe(0)
    await toggle.click()
    expect(await toggle.getAttribute('aria-expanded')).toBe('true')
    expect(await row.locator('[data-diagnostic]').evaluateAll((items) => items.map((el) => el.getAttribute('data-diagnostic')))).toEqual([
      'unknown-key',
      'project-cannot-grant',
    ])
    await expect.poll(() => row.locator('[data-diagnostic="project-cannot-grant"]').textContent()).toMatch(/permissions\.allow/)

    await dialog.locator('[data-section="permissions"]').click()
    const project = dialog.locator('[data-rule-list="project"]')
    await project.waitFor()
    await project.locator('[data-rule="Bash(rm *)"][data-behavior="deny"]').waitFor()
    await project.locator('[data-rule="Edit(src/**)"][data-behavior="ask"]').waitFor()
    expect(await project.locator('[data-rule]').count()).toBe(2)
    expect(await project.getByRole('button').count()).toBe(0)
    expect(await project.getByRole('textbox').count()).toBe(0)
    await expect.poll(() => project.textContent()).toMatch(/\.coko\/settings\.json/)
    // 可编辑的 Workspace 规则列表照常有输入框；项目的 allow 不出现在任何列表中。
    expect(await dialog.locator('[data-rule-list="workspace"]').getByRole('textbox').count()).toBe(1)
    expect(await dialog.locator('[data-rule="Bash(*)"]').count()).toBe(0)
  })

  it('能力开关：指令、自动压缩、时间裁剪、MCP 与命令写入全局配置（其他全局键原样带回）；被项目关闭的项注明', { timeout: 120_000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'coko-capabilities-'))
    onTestFinished(() => rm(root, { recursive: true, force: true }))
    const workspace = join(root, 'workspace')
    await mkdir(join(workspace, '.coko'), { recursive: true })
    await writeFile(join(workspace, '.coko', 'settings.json'), JSON.stringify({ instructions: { enabled: false } }))
    await writeFile(join(root, 'faux.json'), JSON.stringify({ responses: [] }))
    const app = await launchApp({ COKO_FAUX_SCRIPT: join(root, 'faux.json') }, { dir: root })
    apps.push(app)
    await waitConnected(app.window)
    await stubDirectoryPicker(app.app, [workspace])
    await app.window
      .getByRole('button', { name: /^(Add workspace|添加工作区)$/ })
      .first()
      .click()
    await app.window.getByRole('heading', { level: 1, name: /^(New session|新会话)$/ }).waitFor()
    const config = () =>
      app.window.evaluate(async () => (await fetch('/api/config')).json() as Promise<{ global: Record<string, unknown>; globalRevision: number }>)

    await app.window.getByRole('button', { name: /^(Settings|设置)$/ }).click()
    const dialog = app.window.locator('[data-settings-page]')
    const toggle = (name: string) => dialog.locator(`[data-capability="${name}"]`)
    const box = (name: string) => toggle(name).locator('[data-capability-enabled]')
    for (const name of ['instructions.enabled', 'context.autoCompact', 'context.trimOldToolResults']) {
      await expect.poll(() => box(name).getAttribute('data-capability-enabled')).toBe('true')
    }
    // 项目关闭了指令：全局仍为开，注明被项目关闭；其余没有注明。
    await toggle('instructions.enabled').locator('[data-disabled-by-project]').waitFor()
    expect(await toggle('context.autoCompact').locator('[data-disabled-by-project]').count()).toBe(0)

    await box('context.autoCompact').click()
    await expect.poll(() => box('context.autoCompact').getAttribute('data-capability-enabled')).toBe('false')
    await box('context.trimOldToolResults').click()
    await expect.poll(() => box('context.trimOldToolResults').getAttribute('data-capability-enabled')).toBe('false')
    expect((await config()).global).toEqual({ context: { autoCompact: false, trimOldToolResults: false } })

    await dialog.locator('[data-section="mcp"]').click()
    await box('mcp.enabled').click()
    await expect.poll(() => box('mcp.enabled').getAttribute('data-capability-enabled')).toBe('false')
    await dialog.getByText(/^(MCP is turned off in the capability settings; servers will not connect|MCP 已在能力配置中关闭，Server 不会连接)$/).waitFor()

    await dialog.locator('[data-section="skills"]').click()
    await box('commands.enabled').click()
    await expect.poll(() => box('commands.enabled').getAttribute('data-capability-enabled')).toBe('false')
    const saved = await config()
    expect(saved.global).toEqual({ context: { autoCompact: false, trimOldToolResults: false }, mcp: { enabled: false }, commands: { enabled: false } })
    expect(saved.globalRevision).toBe(4)

    // 返回应用再打开设置：开关读回保存的值。
    await app.window.keyboard.press('Escape')
    await dialog.waitFor({ state: 'detached' })
    await app.window.getByRole('button', { name: /^(Settings|设置)$/ }).click()
    await dialog.locator('[data-section="general"]').click()
    await expect.poll(() => box('context.autoCompact').getAttribute('data-capability-enabled')).toBe('false')
    await expect.poll(() => box('instructions.enabled').getAttribute('data-capability-enabled')).toBe('true')
  })
})
