import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { launchApp, waitConnected } from './harness.ts'

it('list categories, project expansion, sort and last session survive real Electron restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'coko-list-restart-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const folders = [join(root, 'one'), join(root, 'two')]
  await Promise.all(folders.map((folder) => mkdir(folder)))
  const first = await launchApp({}, { dir: root })
  onTestFinished(() => first.dispose())
  await waitConnected(first.window)
  const ids = await first.window.evaluate(async (folders) => {
    const ids: string[] = []
    for (const [index, path] of folders.entries()) {
      const ws = (await (await fetch('/api/workspaces', { method: 'POST', body: JSON.stringify({ path }) })).json()) as { id: string }
      const response = await fetch('/api/sessions', {
        method: 'POST',
        body: JSON.stringify({ workspaceId: ws.id, title: index === 0 ? 'Saved session' : 'Recent session' }),
      })
      if (!response.ok) throw new Error(`seed failed ${response.status}`)
      ids.push(((await response.json()) as { id: string }).id)
    }
    return ids
  }, folders)
  await first.window.reload()
  await waitConnected(first.window)
  await first.window.locator(`[data-session-id="${ids[0]}"]`).click()
  await first.window.getByRole('button', { name: 'one', exact: true }).click()
  await first.window.getByRole('heading', { name: /^(项目|Projects)$/ }).hover()
  await first.window.getByRole('button', { name: /^(项目排序|Sort projects)$/ }).click()
  await first.window.getByRole('menuitemradio', { name: /^(按创建时间|By creation time)$/ }).click()
  await first.window.getByRole('button', { name: /^(收起项目分类|Collapse Projects category)$/ }).click()
  await first.window.getByRole('heading', { name: /^(对话|Conversations)$/ }).hover()
  await first.window
    .getByRole('button', { name: /^(拖拽调整对话分类顺序|Drag Conversations category)$/ })
    .dragTo(first.window.getByRole('heading', { name: /^(项目|Projects)$/ }))
  await expect
    .poll(() => first.window.locator('[data-category]').evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-category'))))
    .toEqual(['projects', 'conversations'])
  await first.dispose()
  const restarted = await launchApp({}, { dir: root })
  onTestFinished(() => restarted.dispose())
  const window = restarted.window
  await waitConnected(window)
  await expect.poll(() => window.locator('[data-slot="app-frame-main"] h1').textContent()).toBe('Saved session')
  expect(await window.locator('[data-category]').evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-category')))).toEqual([
    'projects',
    'conversations',
  ])
  await expect.poll(() => window.getByRole('button', { name: /^(展开项目分类|Expand Projects category)$/ }).getAttribute('aria-expanded')).toBe('false')
  await window.getByRole('button', { name: /^(展开项目分类|Expand Projects category)$/ }).click()
  await expect.poll(() => window.getByRole('button', { name: 'one', exact: true }).getAttribute('aria-expanded')).toBe('false')
  await window.getByRole('heading', { name: /^(项目|Projects)$/ }).hover()
  await window.getByRole('button', { name: /^(项目排序|Sort projects)$/ }).click()
  expect(await window.getByRole('menuitemradio', { name: /^(按创建时间|By creation time)$/ }).getAttribute('aria-checked')).toBe('true')
  await window.keyboard.press('Escape')
})

it.each(['deleted', 'archived'])('remembered %s session falls back to new chat after Electron restart', async (state) => {
  const root = await mkdtemp(join(tmpdir(), 'coko-list-missing-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const path = join(root, 'workspace')
  await mkdir(path)
  const first = await launchApp({}, { dir: root })
  onTestFinished(() => first.dispose())
  await waitConnected(first.window)
  const id = await first.window.evaluate(async (path) => {
    const ws = (await (await fetch('/api/workspaces', { method: 'POST', body: JSON.stringify({ path }) })).json()) as { id: string }
    const saved = (await (await fetch('/api/sessions', { method: 'POST', body: JSON.stringify({ workspaceId: ws.id, title: 'Remember me' }) })).json()) as {
      id: string
    }
    await fetch('/api/sessions', { method: 'POST', body: JSON.stringify({ workspaceId: ws.id, title: 'Other session' }) })
    return saved.id
  }, path)
  await first.window.reload()
  await waitConnected(first.window)
  await first.window.locator(`[data-session-id="${id}"]`).click()
  await first.dispose()
  // 将已停写的库构造为会话已删除或已归档；本票尚未提供删除/归档 UI。
  execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import {DatabaseSync} from 'node:sqlite'; const db=new DatabaseSync(process.argv[1]); if(process.argv[3]==='deleted') db.prepare('DELETE FROM session_entries WHERE session_id=?').run(process.argv[2]); db.prepare(process.argv[3]==='deleted'?'DELETE FROM sessions WHERE id=?':'UPDATE sessions SET archived_at=100 WHERE id=?').run(process.argv[2]); db.close();`,
      join(root, 'user-data', 'data', 'coko.db'),
      id,
      state,
    ],
    { stdio: 'pipe' },
  )
  const restarted = await launchApp({}, { dir: root })
  onTestFinished(() => restarted.dispose())
  await waitConnected(restarted.window)
  await expect.poll(() => restarted.window.locator('[data-slot="app-frame-main"] h1').textContent()).toMatch(/^(新对话|New chat)$/)
  expect(await restarted.window.locator(`[data-session-id="${id}"]`).count()).toBe(0)
})
