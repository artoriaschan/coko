// dock：真实 Electron + 真实 Sidecar（faux）。Todo 卡显示 c/n、当前项、等待提示与 result；Run 中的追加指令出现在 Queue 卡、送达后消失；
// 停止后未送达的追加指令回到输入区（现有行为）、Queue 卡消失；dock 顺序 Todo → Queue（Goal 卡尚未交付，不显示）。
// bash 在 full-access 下运行（不经审批）；命令先写标记文件，标记出现即表示命令正在执行。
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, onTestFinished } from 'vitest'
import { launchApp, stubDirectoryPicker, waitConnected, type LaunchedApp } from './harness.ts'

const apps: LaunchedApp[] = []
afterEach(async () => {
  for (const app of apps.splice(0)) await app.dispose()
})

async function setup(script: unknown) {
  const root = await mkdtemp(join(tmpdir(), 'coko-dock-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const workspace = join(root, 'workspace')
  await mkdir(workspace)
  await writeFile(join(root, 'faux.json'), JSON.stringify(script))
  const app = await launchApp({ COKO_FAUX_SCRIPT: join(root, 'faux.json') }, { dir: root })
  apps.push(app)
  await waitConnected(app.window)
  await stubDirectoryPicker(app.app, [workspace])
  await app.window
    .getByRole('button', { name: /^(Add workspace|添加工作区)$/ })
    .first()
    .click()
  await app.window.getByRole('heading', { level: 1, name: /^(New chat|新对话)$/ }).waitFor()
  await app.window.locator('[data-permission-mode]').click()
  await app.window.locator('[role="menuitemradio"][data-mode="full-access"]').click()
  await expect.poll(() => app.window.locator('[data-permission-mode]').getAttribute('data-permission-mode')).toBe('full-access')
  return { app, workspace }
}

const composer = (app: LaunchedApp) => app.window.getByRole('textbox', { name: /Give Coko a task|向 Coko 布置任务/ })
async function type(app: LaunchedApp, text: string) {
  await composer(app).click()
  await composer(app).fill(text)
  await composer(app).press('Enter')
}
const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  )

const todoWrite = {
  type: 'toolCall',
  name: 'todo_write',
  id: 'td1',
  arguments: {
    items: [
      { content: 'read the spec', status: 'completed', result: 'spec has three parts' },
      { content: 'write the tests', status: 'in_progress' },
      { content: 'implement the card', status: 'pending', blockedBy: ['t2'] },
    ],
  },
}
const sleepCall = (seconds: number) => ({
  type: 'toolCall',
  name: 'bash',
  id: 'b1',
  arguments: { command: 'touch started && sleep ' + seconds + ' && echo slept' },
})
const dockCards = (app: LaunchedApp) =>
  app.window.locator('[data-slot="dock"] > section').evaluateAll((sections) => sections.map((s) => s.getAttribute('data-slot')))

describe('dock', { timeout: 120_000 }, () => {
  it('Todo 卡：c/n、当前项、等待提示与 result；Run 中的追加指令进入 Queue 卡，送达后消失', async () => {
    const { app, workspace } = await setup({ responses: [{ content: [todoWrite] }, { content: [sleepCall(3)] }, { content: 'Noted the README request.' }] })
    await type(app, 'plan and run')
    const todo = app.window.locator('[data-slot="todo-card"]')
    await expect.poll(() => todo.locator('[data-todo-count]').textContent(), { timeout: 30_000 }).toMatch(/1\/3/)
    expect(await todo.locator('[data-todo-current]').textContent()).toBe('write the tests')

    await todo.locator('[data-action="toggle-todo"]').click()
    expect(await todo.locator('[data-todo-item="t3"] [data-todo-waiting]').textContent()).toMatch(/t2/)
    const result = todo.locator('[data-todo-item="t1"] [data-todo-result]')
    expect(await result.isVisible()).toBe(false)
    await todo.locator('[data-todo-item="t1"] summary').click()
    await expect.poll(() => result.isVisible()).toBe(true)
    expect(await result.textContent()).toBe('spec has three parts')

    await expect.poll(() => exists(join(workspace, 'started')), { timeout: 30_000 }).toBe(true)
    await type(app, 'also check the README')
    const queue = app.window.locator('[data-slot="queue-card"]')
    await queue.waitFor({ timeout: 10_000 })
    expect(await queue.locator('[data-queued]').allTextContents()).toEqual(['also check the README'])
    // 顺序 Todo → Queue；Goal 卡尚未交付。
    expect(await dockCards(app)).toEqual(['todo-card', 'queue-card'])
    expect(await app.window.locator('[data-slot="goal-card"]').count()).toBe(0)

    await expect.poll(() => app.window.getByRole('article', { name: 'Coko' }).last().textContent(), { timeout: 30_000 }).toBe('Noted the README request.')
    await expect.poll(() => queue.count(), { timeout: 10_000 }).toBe(0)
    // 未全部完成：下一个 Run 开始后仍显示。
    expect(await todo.isVisible()).toBe(true)
  })

  it('停止后未送达的追加指令回到输入区，Queue 卡消失', async () => {
    const { app, workspace } = await setup({ responses: [{ content: [sleepCall(30)] }, { content: 'should not be used' }] })
    await type(app, 'run the command')
    await expect.poll(() => exists(join(workspace, 'started')), { timeout: 30_000 }).toBe(true)
    await type(app, 'not delivered yet')
    const queue = app.window.locator('[data-slot="queue-card"]')
    await queue.waitFor({ timeout: 10_000 })
    // 没有待办：dock 中只有 Queue 卡。
    expect(await dockCards(app)).toEqual(['queue-card'])

    await app.window.locator('[data-action="stop"]').click()
    await app.window.locator('[data-run-status="aborted"]').waitFor({ timeout: 30_000 })
    await expect.poll(() => composer(app).textContent(), { timeout: 10_000 }).toBe('not delivered yet')
    await expect.poll(() => queue.count(), { timeout: 10_000 }).toBe(0)
  })
})
