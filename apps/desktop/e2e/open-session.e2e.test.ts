// 桌面通知点击打开会话的跨通道路径（docs/subsystems/schedules.md 的桌面通知）：真实 Electron + 真实 Sidecar（faux）。main 经真实的 IPC 通道名
// （shared/bridge.ts 的 IPC.openSession，与 main/index.ts 中通知点击时的 webContents.send 相同）发送 sessionId，preload 的 onOpenSession
// 转给 renderer 的 bindOpenSession：设置页关闭，目标会话成为当前会话。系统通知本身在测试构建中不显示，点击回调由 main/notifications.test.ts 覆盖。
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, onTestFinished } from 'vitest'
import { IPC } from '../src/shared/bridge.ts'
import { createProjectDraft, launchApp, waitConnected, type LaunchedApp } from './harness.ts'

const apps: LaunchedApp[] = []
afterEach(async () => {
  for (const app of apps.splice(0)) await app.dispose()
})

const composer = (app: LaunchedApp) => app.window.getByRole('textbox', { name: /Give Coko a task|向 Coko 布置任务/ })
async function send(app: LaunchedApp, text: string) {
  await composer(app).click()
  await composer(app).fill(text)
  await composer(app).press('Enter')
}
const lastReply = (app: LaunchedApp) => app.window.getByRole('article', { name: 'Coko' }).last().textContent()
const currentSession = (app: LaunchedApp) => app.window.locator('[data-session-id][aria-current="page"]').getAttribute('data-session-id')

describe('通知点击打开会话（main → preload → renderer）', { timeout: 120_000 }, () => {
  it('main 发送 IPC.openSession：设置页关闭，打开该会话', async () => {
    const root = await mkdtemp(join(tmpdir(), 'coko-open-session-'))
    onTestFinished(() => rm(root, { recursive: true, force: true }))
    const workspace = join(root, 'workspace')
    await mkdir(workspace)
    await writeFile(
      join(root, 'faux.json'),
      JSON.stringify({
        responses: [
          { content: 'First ready.', match: 'first session' },
          { content: 'Second ready.', match: 'second session' },
        ],
      }),
    )
    const app = await launchApp({ COKO_FAUX_SCRIPT: join(root, 'faux.json') }, { dir: root })
    apps.push(app)
    const { window } = app
    await waitConnected(window)
    await createProjectDraft(app, workspace)
    await window.getByRole('heading', { level: 1, name: /^(New chat|新对话)$/ }).waitFor()

    await send(app, 'first session')
    await expect.poll(() => lastReply(app), { timeout: 30_000 }).toBe('First ready.')
    const first = await currentSession(app)
    expect(first).toBeTruthy()
    await window
      .getByRole('button', { name: /^(New chat|新对话)$/ })
      .first()
      .click()
    await send(app, 'second session')
    await expect.poll(() => lastReply(app), { timeout: 30_000 }).toBe('Second ready.')
    await expect.poll(() => currentSession(app)).not.toBe(first)

    // 打开设置页：通知点击应关闭它。
    await window.getByRole('button', { name: /^(Settings|设置)$/ }).click()
    const settings = window.locator('[data-settings-page]')
    await settings.waitFor()

    await app.app.evaluate(
      ({ BrowserWindow }, { channel, sessionId }) => {
        BrowserWindow.getAllWindows()[0]!.webContents.send(channel, sessionId)
      },
      { channel: IPC.openSession, sessionId: first! },
    )
    await settings.waitFor({ state: 'detached' })
    await expect.poll(() => currentSession(app)).toBe(first)
    await expect.poll(() => lastReply(app)).toBe('First ready.')
  })
})
