// 对话闭环：真实 Electron + 真实 Sidecar（faux provider 由 COKO_FAUX_SCRIPT 开启），断言窗口渲染、协议结果与工作区文件。
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, onTestFinished } from 'vitest'
import { createProjectDraft, launchApp, waitConnected, type LaunchedApp } from './harness.ts'

const apps: LaunchedApp[] = []
afterEach(async () => {
  for (const app of apps.splice(0)) await app.dispose()
})

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  onTestFinished(() => rm(dir, { recursive: true, force: true }))
  return dir
}

/** 每个用例独立的 userData 与工作区；faux 脚本按模型调用顺序消费。 */
async function setup(script?: unknown) {
  const root = await tempDir('coko-chat-')
  const workspace = join(root, 'workspace')
  await mkdir(workspace)
  const env: Record<string, string> = {}
  if (script !== undefined) {
    env.COKO_FAUX_SCRIPT = join(root, 'faux.json')
    await writeFile(env.COKO_FAUX_SCRIPT, JSON.stringify(script))
  }
  return { root, workspace, env }
}

async function launch(env: Record<string, string>, dir: string): Promise<LaunchedApp> {
  const app = await launchApp(env, { dir })
  apps.push(app)
  await waitConnected(app.window)
  return app
}

/** 登记工作区并在其中进入新会话草稿。 */
async function addWorkspace(app: LaunchedApp, path: string) {
  await createProjectDraft(app, path)
  await app.window.getByRole('heading', { level: 1, name: /^(New chat|新对话)$/ }).waitFor()
}

async function sendMessage(app: LaunchedApp, text: string) {
  const composer = app.window.getByRole('textbox', { name: /Give Coko a task|向 Coko 布置任务/ })
  await composer.click()
  await composer.fill(text)
  await composer.press('Enter')
}

const toolCard = (app: LaunchedApp, tool: string) => app.window.locator(`[data-slot="tool-card"][data-tool="${tool}"]`)
/** write 与 bash 需要审批：等审批卡出现并允许一次。 */
async function allowOnce(app: LaunchedApp) {
  await app.window
    .locator('[data-slot="approval-card"]')
    .getByRole('button', { name: /^(Allow once|允许一次)$/ })
    .click({ timeout: 30_000 })
}
const assistantText = (app: LaunchedApp) => app.window.getByRole('article', { name: 'Coko' })

const WRITE_SCRIPT = {
  tokensPerSecond: 40,
  responses: [
    {
      content: [
        { type: 'text', text: 'I will write the greeting file into notes for you right now.' },
        { type: 'toolCall', name: 'write', id: 'w1', arguments: { path: 'notes/hello.txt', content: 'hello from coko\n' } },
      ],
    },
    { content: 'Done. **notes/hello.txt** now contains the greeting.' },
  ],
}

describe('对话闭环', () => {
  it('登记临时目录 → 新建会话 → 发送 → 流式回复与 write 工具卡 → 文件实际存在', async () => {
    const { root, workspace, env } = await setup(WRITE_SCRIPT)
    const app = await launch(env, root)
    await addWorkspace(app, workspace)

    // 在发送前记录所有流式文本快照，确认回复是逐步出现的。
    await app.window.evaluate(() => {
      const g = window as unknown as { __streamed: string[] }
      g.__streamed = []
      new MutationObserver(() => {
        for (const el of document.querySelectorAll('[data-streaming]')) g.__streamed.push(el.textContent ?? '')
      }).observe(document.body, { subtree: true, childList: true, characterData: true })
    })
    await sendMessage(app, 'write a greeting')
    await allowOnce(app)

    await expect.poll(() => toolCard(app, 'write').getAttribute('data-status'), { timeout: 30_000 }).toBe('done')
    expect(await toolCard(app, 'write').textContent()).toContain('notes/hello.txt')
    await app.window.locator('[data-action="send"]').waitFor({ timeout: 30_000 })
    expect(await assistantText(app).last().textContent()).toBe('Done. notes/hello.txt now contains the greeting.')
    // Markdown 已渲染（加粗），流式标记已撤下。
    expect(await assistantText(app).last().locator('[data-streamdown="strong"]').textContent()).toBe('notes/hello.txt')
    expect(await app.window.locator('[data-streaming]').count()).toBe(0)

    const streamed = await app.window.evaluate(() => (window as unknown as { __streamed: string[] }).__streamed)
    const first = 'I will write the greeting file into notes for you right now.'
    const partial = new Set(streamed.filter((text) => text.length > 0 && first.startsWith(text) && text !== first))
    expect(partial.size).toBeGreaterThanOrEqual(2)

    expect(await readFile(join(workspace, 'notes/hello.txt'), 'utf8')).toBe('hello from coko\n')
    await expect.poll(() => app.window.locator('[data-session-id]').count()).toBe(1)
    expect(await app.window.getByRole('heading', { level: 1 }).textContent()).toBe('write a greeting')
  })

  it('Run 中停止按钮可用，停止后显示已停止并恢复发送', async () => {
    const { root, workspace, env } = await setup({
      responses: [{ content: [{ type: 'toolCall', name: 'bash', id: 'b1', arguments: { command: 'sleep 30' } }] }, { content: 'should not be used' }],
    })
    const app = await launch(env, root)
    await addWorkspace(app, workspace)
    await sendMessage(app, 'wait for a while')
    await allowOnce(app)

    await expect.poll(() => toolCard(app, 'bash').getAttribute('data-status'), { timeout: 30_000 }).toBe('running')
    const stop = app.window.locator('[data-action="stop"]')
    expect(await stop.isEnabled()).toBe(true)
    expect(await stop.getAttribute('aria-label')).toMatch(/^(Stop|停止)$/)
    const started = Date.now()
    await stop.click()

    await app.window.locator('[data-run-status="aborted"]').waitFor({ timeout: 15_000 })
    expect(Date.now() - started).toBeLessThan(10_000)
    expect(await app.window.locator('[data-run-status="aborted"]').textContent()).toMatch(/^(Stopped|已停止)$/)
    await app.window.locator('[data-action="send"]').waitFor()
    expect(await toolCard(app, 'bash').getAttribute('data-status')).not.toBe('running')
    expect(await app.window.locator('[data-session-id] [role="img"]').count()).toBe(0)
  })

  it('键盘：Escape 在输入区之外停止 Run，⌘N / Ctrl+N 新建会话并聚焦输入区', async () => {
    const { root, workspace, env } = await setup({
      responses: [{ content: [{ type: 'toolCall', name: 'bash', id: 'b1', arguments: { command: 'sleep 30' } }] }, { content: 'should not be used' }],
    })
    const app = await launch(env, root)
    await addWorkspace(app, workspace)
    await sendMessage(app, 'wait for a while')
    await allowOnce(app)
    await expect.poll(() => toolCard(app, 'bash').getAttribute('data-status'), { timeout: 30_000 }).toBe('running')
    // 焦点移到标题，离开输入区。
    await app.window.getByRole('heading', { level: 1 }).click()
    await app.window.keyboard.press('Escape')
    await app.window.locator('[data-run-status="aborted"]').waitFor({ timeout: 15_000 })

    await app.window.keyboard.press(process.platform === 'darwin' ? 'Meta+N' : 'Control+N')
    await app.window.getByRole('heading', { level: 1, name: /^(New chat|新对话)$/ }).waitFor()
    await expect.poll(() => app.window.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '')).toMatch(/Give Coko a task|向 Coko 布置任务/)
  })

  it('重启应用后会话列表、消息与工具卡仍在', async () => {
    const { root, workspace, env } = await setup(WRITE_SCRIPT)
    const first = await launch(env, root)
    await addWorkspace(first, workspace)
    await sendMessage(first, 'write a greeting')
    await allowOnce(first)
    await expect.poll(() => toolCard(first, 'write').getAttribute('data-status'), { timeout: 30_000 }).toBe('done')
    await first.window.locator('[data-action="send"]').waitFor({ timeout: 30_000 })
    await first.dispose()

    // 重启不再提供 faux 脚本：历史只来自 SQLite。
    const second = await launch({}, root)
    await second.window.getByRole('heading', { level: 1, name: 'write a greeting' }).waitFor({ timeout: 15_000 })
    expect(await second.window.locator('[data-session-id]').count()).toBe(1)
    expect(await second.window.getByRole('article', { name: /^(You|你)$/ }).textContent()).toBe('write a greeting')
    await expect.poll(() => toolCard(second, 'write').getAttribute('data-status')).toBe('done')
    expect(await toolCard(second, 'write').textContent()).toContain('notes/hello.txt')
    await expect.poll(() => assistantText(second).last().textContent()).toBe('Done. notes/hello.txt now contains the greeting.')
    expect(await assistantText(second).first().textContent()).toBe('I will write the greeting file into notes for you right now.')
  })

  it('模型出错时显示简短错误，重试后成功', async () => {
    const { root, workspace, env } = await setup({
      responses: [{ content: '', stopReason: 'error', errorMessage: 'faux model exploded' }, { content: 'Recovered on retry.' }],
    })
    const app = await launch(env, root)
    await addWorkspace(app, workspace)
    await sendMessage(app, 'try something')

    const error = app.window.locator('[data-run-status="error"]')
    await error.waitFor({ timeout: 30_000 })
    expect(await error.textContent()).toContain('faux model exploded')
    await error.getByRole('button', { name: /^(Retry|重试)$/ }).click()

    await expect.poll(() => assistantText(app).last().textContent(), { timeout: 30_000 }).toBe('Recovered on retry.')
    await app.window.locator('[data-action="send"]').waitFor()
    // 只有最后一个 Run 的错误提供重试。
    expect(await app.window.getByRole('button', { name: /^(Retry|重试)$/ }).count()).toBe(0)
    // 重试重新执行出错的一轮，不追加用户消息：对话中只有一条"你"。
    expect(await app.window.getByRole('article', { name: /^(You|你)$/ }).count()).toBe(1)
  })

  it('document 带有平台标记；macOS 收起为 rail 时标题避开红绿灯', async () => {
    const { root } = await setup()
    const app = await launch({}, root)
    const platform = await app.app.evaluate(() => process.platform)
    expect(await app.window.evaluate(() => document.documentElement.dataset.platform)).toBe(platform)
    if (platform !== 'darwin') return
    await app.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(800, 820))
    await expect.poll(() => app.window.locator('[data-slot="app-frame"]').getAttribute('data-sidebar')).toBe('rail')
    const geometry = () =>
      app.window.evaluate(() => {
        const heading = document.querySelector('h1')!.getBoundingClientRect()
        const expand = document.querySelector('[data-slot="app-frame-sidebar"] button')!.getBoundingClientRect()
        return {
          headingLeft: heading.left,
          expandTop: expand.top,
          clearance: getComputedStyle(document.documentElement).getPropertyValue('--frame-leading-clearance').trim(),
        }
      })
    // 红绿灯位于 x=16、宽约 52px；rail 56px + 标题内边距 16 + (72 − 56) = 88。栏宽有过渡动画，等其结束。
    await expect.poll(async () => (await geometry()).headingLeft).toBe(88)
    expect((await geometry()).clearance).toBe('72px')
    // rail 中的按钮在 48px 顶部安全区之下。
    expect((await geometry()).expandTop).toBeGreaterThanOrEqual(48)
  })
})
