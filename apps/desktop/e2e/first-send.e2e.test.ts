import { mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { launchApp, waitConnected } from './harness.ts'

it('CW-26/41/62：独立新对话的草稿和配置跨切换与重启恢复；首次发送才创建专属目录，成功后清空', async () => {
  const root = await mkdtemp(join(tmpdir(), 'coko-first-send-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const script = join(root, 'faux.json')
  await writeFile(script, JSON.stringify({ responses: [{ content: 'Example reply.' }] }))
  const env = { COKO_FAUX_SCRIPT: script, COKO_CHATS_ROOT: join(root, 'chats') }
  let app = await launchApp(env, { dir: root })
  onTestFinished(() => app.dispose())
  let page = app.window
  await waitConnected(page)
  const editor = () => page.getByRole('textbox', { name: /^(Give Coko a task|向 Coko 布置任务)$/ })
  await page.getByText(/今天我们来做些什么|What shall we work on today/).waitFor()
  expect(await page.evaluate(async () => (await (await fetch('/api/sessions')).json()).sessions)).toHaveLength(0)
  expect(await page.evaluate(async () => (await (await fetch('/api/projects')).json()).projects)).toHaveLength(0)
  await page.evaluate(async () => {
    const result = await window.coko!.saveProvider({
      mode: 'create',
      secret: 'example-draft-key',
      provider: {
        id: 'example',
        name: 'Example Provider',
        api: 'openai-completions',
        baseUrl: 'http://127.0.0.1:9/v1',
        models: [
          {
            id: 'example-model',
            name: 'Example Model',
            contextWindow: 128000,
            maxTokens: 16000,
            input: ['text'],
            reasoning: true,
            thinkingLevels: [{ level: 'off' }, { level: 'high', value: 'high' }],
          },
        ],
      },
    })
    if (!result.ok) throw new Error('Failed provider fixture')
  })
  await page.reload()
  await waitConnected(page)
  await page.locator('[data-model-picker]').click()
  await page.getByRole('menuitem', { name: /^(Choose model:|选择模型：)/ }).click()
  await page.getByRole('menuitemradio', { name: 'Example Model', exact: true }).click()
  await page.getByRole('slider').focus()
  await page.getByRole('slider').press('End')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: /^(Permission mode:|权限模式：)/ }).click()
  await page.getByRole('menuitemradio', { name: /Accept edits|帮我批准/ }).click()
  await editor().fill('Example draft intent')
  await page.getByRole('button', { name: /^(Plugins|插件)$/ }).click()
  await page.getByRole('button', { name: /^(New chat|新对话)$/ }).click()
  await expect.poll(() => editor().textContent()).toBe('Example draft intent')
  await app.dispose()
  app = await launchApp(env, { dir: root })
  page = app.window
  await waitConnected(page)
  await expect.poll(() => editor().textContent()).toBe('Example draft intent')
  expect(await page.locator('[data-model-picker]').getAttribute('data-model')).toBe('example/example-model')
  expect(await page.getByRole('button', { name: /^(Permission mode:|权限模式：)/ }).textContent()).toMatch(/Accept edits|帮我批准/)
  await page.locator('[data-model-picker]').click()
  expect(await page.getByRole('slider').getAttribute('aria-valuetext')).toMatch(/High|高/)
  await page.getByRole('menuitem', { name: /^(Choose model:|选择模型：)/ }).click()
  await page.getByRole('menuitemradio', { name: 'Faux', exact: true }).click()
  await page.keyboard.press('Escape')
  await editor().press('Enter')
  await page.getByRole('article', { name: 'Coko' }).filter({ hasText: 'Example reply.' }).waitFor()
  const facts = await page.evaluate(async () => {
    const sessions = (await (await fetch('/api/sessions')).json()).sessions
    const workspaces = (await (await fetch('/api/workspaces')).json()).workspaces
    return { sessions, workspaces }
  })
  expect(facts.sessions).toHaveLength(1)
  expect(facts.sessions[0]).toMatchObject({ projectId: null, title: 'Example draft intent' })
  const folder = facts.workspaces.find((workspace: { id: string }) => workspace.id === facts.sessions[0].workspaceId).path
  expect((await stat(folder)).isDirectory()).toBe(true)
  expect(await readdir(env.COKO_CHATS_ROOT)).toHaveLength(1)
  await page.getByRole('button', { name: /^(New chat|新对话)$/ }).click()
  await expect.poll(() => editor().textContent()).toBe('')
})

it('首次发送被 Hook 拒绝时窗口提示失败并保留草稿，同草稿修正后只创建一个会话', async () => {
  const root = await mkdtemp(join(tmpdir(), 'coko-first-rejected-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const script = join(root, 'faux.json')
  await writeFile(script, JSON.stringify({ responses: [{ content: 'Accepted after correction.' }] }))
  const app = await launchApp({ COKO_FAUX_SCRIPT: script }, { dir: root })
  onTestFinished(() => app.dispose())
  const page = app.window
  await waitConnected(page)
  expect(
    await page.evaluate(
      async () =>
        (
          await fetch('/api/hooks', {
            method: 'PUT',
            body: JSON.stringify({
              hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'echo rejected >&2; exit 2' }] }] },
              expectedRevision: 0,
            }),
          })
        ).status,
    ),
  ).toBe(200)
  const editor = page.getByRole('textbox', { name: /^(Give Coko a task|向 Coko 布置任务)$/ })
  await editor.fill('Keep this draft')
  await editor.press('Enter')
  await page.locator('[data-sonner-toast][data-type="error"]').waitFor()
  expect(await editor.textContent()).toBe('Keep this draft')
  expect(await page.evaluate(async () => (await (await fetch('/api/sessions')).json()).sessions)).toHaveLength(0)
  expect(await readdir(join(root, 'chats'))).toEqual([])
  expect(await page.evaluate(async () => (await fetch('/api/hooks', { method: 'PUT', body: JSON.stringify({ hooks: {}, expectedRevision: 1 }) })).status)).toBe(
    200,
  )
  await editor.press('Enter')
  await page.getByRole('article', { name: 'Coko' }).filter({ hasText: 'Accepted after correction.' }).waitFor()
  expect(await page.evaluate(async () => (await (await fetch('/api/sessions')).json()).sessions)).toHaveLength(1)
})
