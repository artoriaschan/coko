// 设置 → Hooks 分区：真实 Electron + 真实 Sidecar。分区出现在导航中；全局 JSON 非法时行内诊断、不保存，保存后 GET /api/hooks 读回，revision 冲突
// 时提示并读回；项目 Hook 显示完整命令，键盘批准后状态变为已批准，改文件后变为已改动；能力开关；明暗主题。
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, onTestFinished } from 'vitest'
import { createProjectDraft, launchApp, waitConnected, type LaunchedApp } from './harness.ts'

const apps: LaunchedApp[] = []
afterEach(async () => {
  for (const app of apps.splice(0)) await app.dispose()
})

const PROJECT_COMMAND = `node ./scripts/guard.mjs --policy strict --log ./logs/${'very-long-segment-'.repeat(6)}hook.jsonl`

describe('Hooks 分区', () => {
  it('编辑全局 JSON（诊断、读回、冲突）、批准项目 Hook 与已改动、开关、明暗主题与键盘', async () => {
    const root = await mkdtemp(join(tmpdir(), 'coko-hooks-e2e-'))
    onTestFinished(() => rm(root, { recursive: true, force: true }))
    const workspace = join(root, 'workspace')
    await mkdir(join(workspace, '.coko'), { recursive: true })
    const projectFile = (command: string) =>
      writeFile(join(workspace, '.coko', 'settings.json'), JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command }] }] } }))
    await projectFile(PROJECT_COMMAND)
    await writeFile(join(root, 'faux.json'), JSON.stringify({ responses: [] }))
    const app = await launchApp({ COKO_FAUX_SCRIPT: join(root, 'faux.json') }, { dir: root })
    apps.push(app)
    const { window } = app
    await waitConnected(window)
    await createProjectDraft(app, workspace)
    await window.getByRole('heading', { level: 1, name: /^(New chat|新对话)$/ }).waitFor()
    await window.getByRole('button', { name: /^(Settings|设置)$/ }).click()
    const dialog = window.locator('[data-settings-page]')
    const nav = dialog.locator('[data-section="hooks"]')
    await nav.waitFor()
    await nav.click()
    const section = dialog.locator('[data-hooks-section]')
    await section.waitFor()
    const api = (path: string, init?: { method: string; body: unknown }) =>
      window.evaluate(
        async ({ path, init }) => {
          const res = await fetch(
            path,
            init ? { method: init.method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(init.body) } : undefined,
          )
          return { status: res.status, body: (await res.json().catch(() => null)) as unknown }
        },
        { path, init },
      )

    // 非法 JSON 与 schema 诊断：行内显示，不保存（revision 不变）。
    const editor = section.locator('textarea[name="hooks"]')
    const save = section.locator('[data-action="save-hooks"]')
    const problem = section.locator('[data-hooks-problem]')
    await editor.fill('{ "Stop": [')
    await save.click()
    await expect.poll(() => problem.textContent()).toMatch(/^(Invalid JSON|JSON 无法解析)/)
    await editor.fill(JSON.stringify({ Bogus: [{ hooks: [{ type: 'command', command: 'x' }] }] }))
    await save.click()
    await expect.poll(() => problem.locator('[data-diagnostic="unknown-event"]').count()).toBe(1)
    expect(((await api('/api/hooks')).body as { global: { revision: number } }).global.revision).toBe(0)

    // 保存后读回。
    const saved = { UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'echo saved-from-ui' }] }] }
    await editor.fill(JSON.stringify(saved))
    await save.click()
    await expect.poll(() => section.locator('[data-hooks-global]').getAttribute('data-revision')).toBe('1')
    expect(await problem.count()).toBe(0)
    expect((await api('/api/hooks')).body).toMatchObject({ global: { hooks: saved, revision: 1 } })
    await section.locator('[data-hooks-event="UserPromptSubmit"]').getByText('echo saved-from-ui').waitFor()

    // 别处改了配置（revision 2）：界面保存被拒绝，提示冲突并读回最新内容。
    const elsewhere = { Stop: [{ hooks: [{ type: 'command', command: 'echo from-elsewhere' }] }] }
    expect((await api('/api/hooks', { method: 'PUT', body: { hooks: elsewhere, expectedRevision: 1 } })).status).toBe(200)
    await editor.fill(JSON.stringify({}))
    await save.click()
    await expect.poll(() => problem.textContent()).toMatch(/changed elsewhere|已在别处修改/)
    await expect.poll(() => editor.inputValue()).toBe(JSON.stringify(elsewhere, null, 2))

    // 项目 Hook：完整命令、待批准；键盘批准后为已批准。
    const card = section.locator('[data-project-hook="project:Stop:0:0"]')
    await expect.poll(() => card.getAttribute('data-status')).toBe('pending')
    expect(await card.locator('[data-hook-command]').textContent()).toBe(PROJECT_COMMAND)
    await card.locator('[data-action="approve-hook"]').focus()
    await window.keyboard.press('Enter')
    await expect.poll(() => card.getAttribute('data-status')).toBe('approved')
    await section.locator('[data-hooks-event="Stop"] [data-loaded-hook="project:Stop:0:0"]').waitFor()

    // 改文件后重新打开分区：已改动，不在已加载清单中。
    await projectFile(`${PROJECT_COMMAND} --changed`)
    await dialog.locator('[data-section="mcp"]').click()
    await nav.click()
    await expect.poll(() => section.locator('[data-project-hook="project:Stop:0:0"]').getAttribute('data-status')).toBe('changed')
    expect(await section.locator('[data-loaded-hook="project:Stop:0:0"]').count()).toBe(0)

    // 能力开关：关闭后有效值为 false，提示出现；再打开。
    const toggle = section.locator('[data-capability="hooks.enabled"] button[role="checkbox"]')
    await toggle.click()
    await expect.poll(() => toggle.getAttribute('data-capability-enabled')).toBe('false')
    expect(((await api('/api/hooks')).body as { enabled: boolean }).enabled).toBe(false)
    await toggle.click()
    await expect.poll(() => toggle.getAttribute('data-capability-enabled')).toBe('true')

    // 明暗主题：分区在暗色下渲染，状态与命令文字不与背景同色。
    for (const theme of ['dark', 'light'] as const) {
      await dialog.locator('[data-section="general"]').click()
      await dialog.locator(`[data-theme-option="${theme}"]`).click()
      await expect.poll(() => window.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(theme === 'dark')
      await nav.click()
      const colors = await section.locator('[data-project-hook="project:Stop:0:0"]').evaluate((el) => {
        const status = el.querySelector('[data-hook-status]')!
        const command = el.querySelector('[data-hook-command]')!
        const card = getComputedStyle(el).backgroundColor
        return [getComputedStyle(status).color, getComputedStyle(command).color, card]
      })
      expect(colors[0]).not.toBe(colors[2])
      expect(colors[1]).not.toBe(colors[2])
    }
  })
})
