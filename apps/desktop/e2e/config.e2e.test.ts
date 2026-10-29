// 分层配置的界面（票 02）：真实 Electron + 真实 Sidecar。General 分区显示当前工作区的项目设置路径与诊断（可展开），
// Permissions 分区列出项目规则（只读、标出来源文件，没有删除入口）。
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
    const dialog = app.window.getByRole('dialog')
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
})
