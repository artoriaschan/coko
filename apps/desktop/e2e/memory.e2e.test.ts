// Memory：真实 Electron + 真实 Sidecar（faux）。模型经 memory_write 记下条目（default 模式审批），工具卡显示"已记住"；
// 设置的 Memory 分区按用户级与当前工作区分组列出它，删除、手动添加与编辑生效，记忆开关写入全局配置；重新打开后读到 Sidecar 中的条目。
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, onTestFinished } from 'vitest'
import { launchApp, stubDirectoryPicker, waitConnected, type LaunchedApp } from './harness.ts'

const apps: LaunchedApp[] = []
afterEach(async () => {
  for (const app of apps.splice(0)) await app.dispose()
})

describe('Memory', () => {
  it('工具卡显示记忆操作；Memory 分区列出模型写入的条目，删除、手动添加与编辑生效', async () => {
    const root = await mkdtemp(join(tmpdir(), 'coko-memory-'))
    onTestFinished(() => rm(root, { recursive: true, force: true }))
    const workspace = join(root, 'workspace')
    await mkdir(workspace)
    await writeFile(
      join(root, 'faux.json'),
      JSON.stringify({
        responses: [
          { content: [{ type: 'toolCall', name: 'memory_write', id: 'w1', arguments: { content: 'This project uses pnpm', scope: 'workspace' } }] },
          { content: 'I will remember that.' },
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

    const composer = window.getByRole('textbox', { name: /Give Coko a task|向 Coko 布置任务/ })
    await composer.click()
    await composer.fill('remember the package manager')
    await composer.press('Enter')
    // default 模式：memory_write 先审批。
    const approval = window.locator('[data-slot="approval-card"]')
    await approval.waitFor({ timeout: 30_000 })
    expect(await approval.textContent()).toContain('This project uses pnpm')
    await approval.getByRole('button', { name: /^(Allow once|允许一次)$/ }).click()
    const card = window.locator('[data-slot="tool-card"][data-tool="memory_write"]')
    await expect.poll(() => card.getAttribute('data-status'), { timeout: 30_000 }).toBe('done')
    await expect.poll(() => card.textContent()).toMatch(/(Remembered|已记住)/)
    expect(await card.textContent()).toContain('This project uses pnpm')
    await window.locator('[data-action="send"]').waitFor({ timeout: 30_000 })

    await window.getByRole('button', { name: /^(Settings|设置)$/ }).click()
    const dialog = window.getByRole('dialog')
    await dialog.locator('[data-section="memory"]').click()
    const workspaceList = dialog.locator('[data-memory-list="workspace"]')
    const userList = dialog.locator('[data-memory-list="user"]')
    const modelEntry = workspaceList.locator('[data-memory-id][data-memory-source="model"]')
    await modelEntry.waitFor()
    expect(await modelEntry.textContent()).toContain('This project uses pnpm')
    expect(await userList.locator('[data-memory-id]').count()).toBe(0)
    expect(await dialog.locator('[data-memory-enabled]').getAttribute('data-memory-enabled')).toBe('true')

    // 删除模型写入的条目。
    await modelEntry.getByRole('button', { name: /^(Delete memory|删除记忆)$/ }).click()
    await expect.poll(() => workspaceList.locator('[data-memory-id]').count()).toBe(0)

    // 手动添加一条用户级记忆，再编辑它。
    const add = userList.getByRole('textbox', { name: /^(Memory content|记忆内容)$/ })
    await add.fill('Answer in Chinese')
    await userList.getByRole('button', { name: /^(Add|添加)$/ }).click()
    const userEntry = userList.locator('[data-memory-id][data-memory-source="user"]')
    await userEntry.waitFor()
    await expect.poll(() => userEntry.locator('p').textContent()).toBe('Answer in Chinese')
    await userEntry.getByRole('button', { name: /^(Edit memory|编辑记忆)$/ }).click()
    const edit = userList.locator('[data-memory-id] textarea')
    await edit.fill('Answer in Chinese, briefly')
    await userList.getByRole('button', { name: /^(Save|保存)$/ }).click()
    await expect.poll(() => userList.locator('[data-memory-id] p').first().textContent()).toBe('Answer in Chinese, briefly')
    expect(await userList.locator('[data-memory-id]').count()).toBe(1)

    // 记忆开关：关闭后全局配置读回为关闭，再打开。
    const toggle = dialog.locator('[data-memory-enabled]')
    await toggle.click()
    await expect.poll(() => toggle.getAttribute('data-memory-enabled')).toBe('false')
    await toggle.click()
    await expect.poll(() => toggle.getAttribute('data-memory-enabled')).toBe('true')

    // 关闭再打开设置：列表来自 Sidecar。
    await window.keyboard.press('Escape')
    await dialog.waitFor({ state: 'hidden' })
    await window.getByRole('button', { name: /^(Settings|设置)$/ }).click()
    await dialog.locator('[data-section="memory"]').click()
    await expect.poll(() => dialog.locator('[data-memory-list="user"] [data-memory-id] p').first().textContent()).toBe('Answer in Chinese, briefly')
    expect(await dialog.locator('[data-memory-list="workspace"] [data-memory-id]').count()).toBe(0)
  })
})
