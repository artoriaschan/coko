// 回退与分叉：真实 Electron + 真实 Sidecar（faux）。悬停用户消息出现回退动作，确认对话框列出将恢复与删除的文件和
// bash 不追踪说明；执行后输入区为原消息文本、时间线折叠、文件回到之前的内容。用户底栏没有分叉入口，旧用户锚点协议仍兼容。键盘可达。
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, onTestFinished } from 'vitest'
import { createProjectDraft, launchApp, type LaunchedApp } from './harness.ts'

const apps: LaunchedApp[] = []
afterEach(async () => {
  for (const app of apps.splice(0)) await app.dispose()
})

const write = (id: string, path: string, content: string) => ({ type: 'toolCall', name: 'write', id, arguments: { path, content } })

/** 两条消息：第一条改 notes.txt，第二条再改它并新建 extra.txt（accept-edits，不经审批）。 */
async function setup(command = false) {
  const root = await mkdtemp(join(tmpdir(), 'coko-rewind-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const workspace = join(root, 'workspace')
  await mkdir(workspace)
  await writeFile(join(workspace, 'notes.txt'), 'original\n')
  if (command) {
    await mkdir(join(workspace, '.coko', 'commands'), { recursive: true })
    await writeFile(join(workspace, '.coko', 'commands', 'review.md'), 'Review $ARGUMENTS and report findings.')
  }
  const script = {
    responses: [
      { content: [write('w1', 'notes.txt', 'after one\n')] },
      { content: 'First done.' },
      { content: [write('w2', 'notes.txt', 'after two\n'), write('w3', 'extra.txt', 'extra\n')] },
      { content: 'Second done.' },
    ],
  }
  await writeFile(join(root, 'faux.json'), JSON.stringify(script))
  const app = await launchApp({ COKO_FAUX_SCRIPT: join(root, 'faux.json') }, { dir: root })
  apps.push(app)
  await app.window.getByRole('heading', { level: 1, name: /^(New chat|新对话)$/ }).waitFor()
  await createProjectDraft(app, workspace)
  await app.window.getByRole('heading', { level: 1, name: /^(New chat|新对话)$/ }).waitFor()
  await app.window.locator('[data-permission-mode]').click()
  await app.window.locator('[role="menuitemradio"][data-mode="accept-edits"]').click()
  await expect.poll(() => app.window.locator('[data-permission-mode]').getAttribute('data-permission-mode')).toBe('accept-edits')
  await send(app, 'first change')
  await send(app, command ? '/review second change' : 'second change')
  expect(await readFile(join(workspace, 'notes.txt'), 'utf8')).toBe('after two\n')
  return { app, workspace }
}

const composer = (app: LaunchedApp) => app.window.getByRole('textbox', { name: /Give Coko a task|向 Coko 布置任务/ })
const replies = (app: LaunchedApp) => app.window.getByRole('article', { name: 'Coko' })
async function send(app: LaunchedApp, text: string) {
  const before = await replies(app).count()
  await composer(app).click()
  await composer(app).fill(text)
  await composer(app).press('Enter')
  await expect.poll(() => replies(app).count(), { timeout: 30_000 }).toBe(before + 1)
  await app.window.locator('[data-action="send"]').waitFor({ timeout: 30_000 })
}
const userMessage = (app: LaunchedApp, text: string) => app.window.locator('article[data-seq]', { hasText: text })
const opacity = (locator: ReturnType<LaunchedApp['window']['locator']>) => locator.evaluate((el) => getComputedStyle(el).opacity)
const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  )

describe('回退与分叉', () => {
  it('悬停用户消息出现回退动作；确认对话框列出文件与 bash 说明；执行后输入区为原消息、时间线折叠、文件恢复', async () => {
    const { app, workspace } = await setup()
    const second = userMessage(app, 'second change')
    const actions = second.locator('[data-slot="message-actions"]')
    // 未悬停时动作不可见（支持 hover 的窗口），悬停后出现。
    await app.window.mouse.move(0, 0)
    await expect.poll(() => opacity(actions)).toBe('0')
    const cdp = await app.window.context().newCDPSession(app.window)
    try {
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true })
      await expect.poll(() => app.window.evaluate(() => matchMedia('(hover: hover)').matches)).toBe(false)
      await expect.poll(() => opacity(actions)).toBe('1')
    } finally {
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false })
      await cdp.detach()
    }
    await second.hover()
    await expect.poll(() => opacity(actions)).toBe('1')
    const clipboardBefore = await app.app.evaluate(({ clipboard }) => clipboard.readText())
    try {
      await actions.locator('[data-action="copy-message"]').click()
      await expect.poll(() => app.app.evaluate(({ clipboard }) => clipboard.readText())).toBe('second change')
    } finally {
      await app.app.evaluate(({ clipboard }, text) => clipboard.writeText(text), clipboardBefore)
    }
    expect(await second.locator('time').getAttribute('datetime')).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    await actions.locator('[data-action="rewind"]').click()

    const dialog = app.window.locator('[data-slot="rewind-dialog"]')
    await dialog.waitFor()
    expect(await dialog.locator('[data-rewind-mode="both"]').getAttribute('data-state')).toBe('on')
    const restored = dialog.locator('[data-slot="rewind-restored"] li')
    await restored.first().waitFor({ timeout: 15_000 })
    expect(await restored.allTextContents()).toEqual(['notes.txt'])
    expect(await dialog.locator('[data-slot="rewind-deleted"] li').allTextContents()).toEqual(['extra.txt'])
    expect(await dialog.locator('[data-slot="rewind-diverged"]').count()).toBe(0)
    expect(await dialog.locator('[data-slot="rewind-bash-note"]').textContent()).toMatch(/bash/)
    // 对话框打开期间文件未变（dry-run）。
    expect(await readFile(join(workspace, 'notes.txt'), 'utf8')).toBe('after two\n')

    await dialog.locator('[data-action="confirm-rewind"]').click()
    await dialog.waitFor({ state: 'detached', timeout: 15_000 })
    await expect.poll(() => composer(app).textContent(), { timeout: 15_000 }).toBe('second change')
    expect(await readFile(join(workspace, 'notes.txt'), 'utf8')).toBe('after one\n')
    expect(await exists(join(workspace, 'extra.txt'))).toBe(false)
    // 被回退的区间折叠：第二条消息与回复收进 rewound，默认收起；第一条仍可回退。
    const rewound = app.window.locator('[data-slot="rewound"]')
    await rewound.waitFor()
    expect(await rewound.getAttribute('open')).toBeNull()
    expect(await rewound.locator('[data-slot="user-bubble"]').allTextContents()).toEqual(['second change'])
    expect(await rewound.locator('[data-action="rewind"]').count()).toBe(0)
    expect(await replies(app).filter({ visible: true }).locator('[data-slot="assistant-message-body"]').allTextContents()).toEqual(['First done.'])
    await rewound.locator('summary').click()
    expect(await rewound.getByRole('article', { name: 'Coko' }).locator('[data-slot="assistant-message-body"]').allTextContents()).toEqual(['Second done.'])
  })

  it('键盘：Tab 到消息后动作出现并可触发；Esc 关闭对话框不回退', async () => {
    const { app, workspace } = await setup()
    const first = userMessage(app, 'first change')
    await app.window.mouse.move(0, 0)
    await first.focus()
    const actions = first.locator('[data-slot="message-actions"]')
    await expect.poll(() => opacity(actions)).toBe('1')
    await app.window.keyboard.press('Tab')
    expect(await app.window.evaluate(() => document.activeElement?.tagName)).toBe('TIME')
    await app.window.keyboard.press('Tab')
    expect(await app.window.evaluate(() => document.activeElement?.getAttribute('data-action'))).toBe('copy-message')
    await app.window.keyboard.press('Tab')
    expect(await app.window.evaluate(() => document.activeElement?.getAttribute('data-action'))).toBe('rewind')
    await app.window.keyboard.press('Enter')
    const dialog = app.window.locator('[data-slot="rewind-dialog"]')
    await dialog.waitFor()
    await dialog.locator('[data-slot="rewind-restored"] li').first().waitFor({ timeout: 15_000 })
    await app.window.keyboard.press('Escape')
    await dialog.waitFor({ state: 'detached' })
    expect(await readFile(join(workspace, 'notes.txt'), 'utf8')).toBe('after two\n')
    expect(await app.window.locator('[data-slot="rewound"]').count()).toBe(0)
  })

  it('用户底栏没有分叉，旧用户锚点分叉协议仍保留上下文且不改变源文件或记录', async () => {
    const { app, workspace } = await setup()
    const source = await app.window.locator('[data-session-id][aria-current="page"]').getAttribute('data-session-id')
    const second = userMessage(app, 'second change')
    expect(await second.locator('[data-action="fork"]').count()).toBe(0)
    const before = await app.window.evaluate(async (id) => (await (await fetch(`/api/sessions/${id}`)).json()).entries, source)
    const targetSeq = Number(await second.getAttribute('data-seq'))
    const fork = await app.window.evaluate(
      async ({ source, targetSeq }) => {
        const response = await fetch(`/api/sessions/${source}/fork`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targetSeq, title: 'Legacy fork' }),
        })
        return { status: response.status, body: await response.json() }
      },
      { source, targetSeq },
    )
    expect(fork.status).toBe(201)
    expect(fork.body.text).toBe('second change')
    const entries = await app.window.evaluate(async (id) => (await (await fetch(`/api/sessions/${id}`)).json()).entries, fork.body.sessionId)
    expect(entries[0]).toMatchObject({ kind: 'fork_origin', payload: { sessionId: source, seq: targetSeq } })
    expect(entries.filter((entry: { kind: string; payload: { role?: string } }) => entry.kind === 'message' && entry.payload.role === 'user')).toHaveLength(1)
    expect(await app.window.evaluate(async (id) => (await (await fetch(`/api/sessions/${id}`)).json()).entries, source)).toEqual(before)
    expect(await readFile(join(workspace, 'notes.txt'), 'utf8')).toBe('after two\n')
    expect(await readFile(join(workspace, 'extra.txt'), 'utf8')).toBe('extra\n')
  })

  it('命令回退保留原始调用与现有草稿，旧条目原样保留且文件按真实 Checkpoint 恢复', async () => {
    const { app, workspace } = await setup(true)
    const original = await app.window.locator('[data-session-id][aria-current="page"]').getAttribute('data-session-id')
    const before = await app.window.evaluate(async (id) => (await (await fetch(`/api/sessions/${id}`)).json()).entries, original)
    await composer(app).fill('unsent draft')
    const command = app.window.locator('article[data-seq]', { hasText: '/review' })
    await command.hover()
    await command.locator('[data-action="rewind"]').click()
    const dialog = app.window.locator('[data-slot="rewind-dialog"]')
    await expect.poll(() => dialog.locator('[data-action="confirm-rewind"]').isEnabled()).toBe(true)
    await dialog.locator('[data-action="confirm-rewind"]').click()
    await dialog.waitFor({ state: 'detached' })
    await expect.poll(() => composer(app).innerText()).toBe('/review second change\nunsent draft')
    const after = await app.window.evaluate(async (id) => (await (await fetch(`/api/sessions/${id}`)).json()).entries, original)
    expect(after.slice(0, before.length)).toEqual(before)
    expect(after.at(-1)).toMatchObject({ kind: 'rewind', payload: { targetSeq: Number(await command.getAttribute('data-seq')) } })
    expect(await readFile(join(workspace, 'notes.txt'), 'utf8')).toBe('after one\n')
    expect(await exists(join(workspace, 'extra.txt'))).toBe(false)
  })
})
