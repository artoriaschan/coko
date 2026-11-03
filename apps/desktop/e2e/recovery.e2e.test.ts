// 启动恢复：真实 Electron + 真实 Sidecar（faux）。Run 中 SIGKILL Sidecar，supervisor 重启后会话显示确认卡，
// 回答后中断横幅带"继续"，继续后 Run 完成。以标记文件（命令已在执行）与进程号变化同步，不用固定 sleep。
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, onTestFinished } from 'vitest'
import { createProjectDraft, launchApp, processExists, waitConnected, type LaunchedApp } from './harness.ts'

const apps: LaunchedApp[] = []
afterEach(async () => {
  for (const app of apps.splice(0)) await app.dispose()
})

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  )

describe('启动恢复', () => {
  it('Run 中 SIGKILL 真实 Sidecar → 重启后确认卡接管输入区；回答"未生效"后中断横幅带继续，继续后 Run 完成', async () => {
    const root = await mkdtemp(join(tmpdir(), 'coko-recovery-'))
    onTestFinished(() => rm(root, { recursive: true, force: true }))
    const workspace = join(root, 'workspace')
    await mkdir(workspace)
    const script = join(root, 'faux.json')
    const call = { type: 'toolCall', name: 'bash', id: 'b1', arguments: { command: 'touch started && sleep 30 && touch done' } }
    await writeFile(script, JSON.stringify({ responses: [{ content: [call] }] }))
    const app = await launchApp({ COKO_FAUX_SCRIPT: script }, { dir: root })
    apps.push(app)
    await app.window.getByRole('heading', { level: 1 }).waitFor()
    await createProjectDraft(app, workspace)
    await app.window.getByRole('heading', { level: 1, name: /^(New chat|新对话)$/ }).waitFor()
    await app.window.locator('[data-permission-mode]').click()
    await app.window.locator('[role="menuitemradio"][data-mode="full-access"]').click()
    await app.window
      .locator('[data-permission-risk-dialog]')
      .getByRole('button', { name: /^(Turn on anyway|仍要开启)$/ })
      .click()
    await app.window.locator('[data-permission-risk-dialog]').waitFor({ state: 'detached' })
    const composer = app.window.getByRole('textbox', { name: /Give Coko a task|向 Coko 布置任务/ })
    await composer.click()
    await composer.fill('run the long command')
    await composer.press('Enter')
    await waitConnected(app.window)
    await expect.poll(() => exists(join(workspace, 'started')), { timeout: 30_000 }).toBe(true)

    // 重启后的 Sidecar 重新读取脚本：继续时的回复。
    await writeFile(script, JSON.stringify({ responses: [{ content: 'Resumed after the crash.' }] }))
    const [pid] = await app.sidecarPids()
    process.kill(pid!, 'SIGKILL')
    await expect.poll(async () => (await app.sidecarPids()).length, { timeout: 15_000 }).toBe(2)
    expect(processExists(pid!)).toBe(false)
    // 确认卡也是 role=status：按连接状态的 data 属性等待重连（waitConnected 只适用于页面上只有连接状态时）。
    await expect.poll(() => app.window.locator('[data-connection]').getAttribute('data-connection'), { timeout: 30_000 }).toBe('connected')

    const card = app.window.locator('[data-slot="confirmation-card"]')
    await card.waitFor({ timeout: 30_000 })
    expect(await card.getAttribute('data-confirmation-key')).toBe('b1')
    expect(await card.textContent()).toContain('touch started && sleep 30 && touch done')
    expect(await composer.isVisible()).toBe(false)
    expect(await app.window.locator('[data-session-id] [data-activity="awaiting-confirmation"]').count()).toBe(0)
    expect(await app.window.locator('[data-run-status="interrupted"]').count()).toBe(1)

    await card.locator('[data-answer="not-applied"]').click()
    const banner = app.window.locator('[data-slot="run-banner"][data-activity="interrupted"]')
    await banner.waitFor({ timeout: 30_000 })
    expect(await card.count()).toBe(0)
    expect(await composer.isVisible()).toBe(true)
    expect(await app.window.locator('[data-session-id] [data-activity="interrupted"]').count()).toBe(0)
    expect(await app.window.locator('[data-slot="tool-card"][data-tool="bash"]').getAttribute('data-status')).toBe('error')

    await banner.locator('[data-action="continue"]').click()
    await expect.poll(() => app.window.getByRole('article', { name: 'Coko' }).last().textContent(), { timeout: 30_000 }).toBe('Resumed after the crash.')
    await app.window.locator('[data-action="send"]').waitFor({ timeout: 30_000 })
    expect(await banner.count()).toBe(0)
    expect(await app.window.locator('[data-session-id] [data-activity]').count()).toBe(0)
    expect(await exists(join(workspace, 'done'))).toBe(false)
  })
})
