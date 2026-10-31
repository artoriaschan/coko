// 子代理的桌面通知（docs/subsystems/subagents.md#界面）在接收的一侧：真实 Electron + 真实 Sidecar（faux）。后台子代理等待写入审批时，
// main 记 notification shown { kind: approval-waiting }；在父会话输入区允许后子代理结束，记 agent-finished。两条都属于父 Session。
// 测试构建不弹出通知，只写 desktop.jsonl；后台模式的窗口不激活，所以 main 判定为不在前台。
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, onTestFinished } from 'vitest'
import { launchApp, notificationsShown, stubDirectoryPicker, waitConnected, type LaunchedApp } from './harness.ts'

const apps: LaunchedApp[] = []
afterEach(async () => {
  for (const app of apps.splice(0)) await app.dispose()
})

const call = (name: string, id: string, args: Record<string, unknown>) => ({ type: 'toolCall', name, id, arguments: args })

describe('子代理通知', () => {
  it('后台子代理等待审批 → approval-waiting；回答后结束 → agent-finished（desktop.jsonl）', { timeout: 120_000 }, async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'coko-subagent-notify-e2e-')))
    onTestFinished(() => rm(root, { recursive: true, force: true }))
    const workspace = join(root, 'workspace')
    await mkdir(workspace)
    await writeFile(
      join(root, 'faux.json'),
      JSON.stringify({
        responses: [
          {
            match: 'PARENT-N',
            content: [
              call('agent', 'a1', { description: 'write the file', prompt: 'CHILD-N write out.txt', subagent_type: 'general', run_in_background: true }),
            ],
          },
          { match: 'PARENT-N', content: 'Started in background.' },
          { match: 'CHILD-N', content: [call('write', 'w1', { path: 'out.txt', content: 'from child\n' })] },
          { match: 'CHILD-N', content: 'Wrote out.txt.' },
          // 子代理结束时父 Session 若仍有 Run，结束通知作为追加指令送达。
          { match: 'PARENT-N', content: 'Noted.' },
        ],
      }),
    )
    const app = await launchApp({ COKO_FAUX_SCRIPT: join(root, 'faux.json') }, { dir: root })
    apps.push(app)
    const win = app.window
    await waitConnected(win)
    await stubDirectoryPicker(app.app, [workspace])
    await win
      .getByRole('button', { name: /^(Add workspace|添加工作区)$/ })
      .first()
      .click()
    await win.getByRole('heading', { level: 1, name: /^(New session|新会话)$/ }).waitFor()
    // 后台模式：窗口不在前台（main 的判定依据），通知不因前台被跳过。
    expect(await app.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isFocused())).toBe(false)

    const composer = win.getByRole('textbox', { name: /Give Coko a task|向 Coko 布置任务/ })
    await composer.click()
    await composer.fill('PARENT-N write in the background')
    await composer.press('Enter')

    // 子代理的写入审批在父会话输入区接管；允许后子代理写入并结束。
    const card = win.locator('[data-slot="approval-card"]')
    await card.waitFor({ timeout: 30_000 })
    expect(await card.textContent()).toMatch(/(From subagent|来自子代理) general · write the file/)
    await card.getByRole('button', { name: /^(Allow once|允许一次)$/ }).click()
    const agentCard = win.locator('[data-slot="tool-card"][data-tool="agent"] [data-slot="agent-card"]')
    await expect.poll(() => agentCard.getAttribute('data-agent-status'), { timeout: 30_000 }).toBe('completed')
    expect(await readFile(join(workspace, 'out.txt'), 'utf8')).toBe('from child\n')
    const parentId = await win.evaluate(async () => {
      const response = await fetch('/api/sessions')
      return ((await response.json()) as { sessions: { id: string }[] }).sessions[0]!.id
    })

    // main 的文件日志按块缓冲，有序退出时写出：关闭应用后读取。
    await apps.splice(apps.indexOf(app), 1)[0]!.dispose()
    const shown = (await notificationsShown(app.dir)).filter((n) => n.kind === 'approval-waiting' || n.kind === 'agent-finished')
    expect(shown.map((n) => [n.kind, n.sessionId])).toEqual([
      ['approval-waiting', parentId],
      ['agent-finished', parentId],
    ])
    expect(shown[0]!.title).toBe('Subagent is waiting for approval')
    expect(shown[1]!.title).toBe('Subagent completed')
  })
})
