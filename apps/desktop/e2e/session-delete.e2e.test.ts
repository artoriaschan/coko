import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { launchApp, waitConnected } from './harness.ts'

it('deleting a parent through Electron removes its child after restart and preserves project source files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'coko-delete-restart-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const folder = join(root, 'project')
  await mkdir(folder)
  await writeFile(join(folder, 'source.txt'), 'unchanged source')
  const script = join(root, 'faux.json')
  await writeFile(
    script,
    JSON.stringify({
      responses: [
        {
          match: 'PARENT-DELETE',
          content: [{ type: 'toolCall', name: 'agent', id: 'a', arguments: { description: 'child', prompt: 'CHILD-DELETE', subagent_type: 'general' } }],
        },
        { match: 'CHILD-DELETE', content: 'Child done.' },
        { match: 'PARENT-DELETE', content: 'Done.' },
      ],
    }),
  )
  const first = await launchApp({ COKO_FAUX_SCRIPT: script }, { dir: root })
  onTestFinished(() => first.dispose())
  await waitConnected(first.window)
  const parentId = await first.window.evaluate(async (path) => {
    const post = async (route: string, body: unknown) => {
      const response = await fetch(route, { method: 'POST', body: JSON.stringify(body) })
      if (!response.ok) throw new Error(`seed failed ${response.status}`)
      return (await response.json()) as { id: string }
    }
    const workspace = await post('/api/workspaces', { path, name: 'Delete project' })
    const parent = await post('/api/sessions', { workspaceId: workspace.id, title: 'Delete parent' })
    const response = await fetch(`/api/sessions/${parent.id}/messages`, { method: 'POST', body: JSON.stringify({ text: 'PARENT-DELETE' }) })
    if (!response.ok) throw new Error(`submit failed ${response.status}`)
    return parent.id
  }, folder)
  const childId = await first.window.evaluate(async (id) => {
    const read = async () =>
      (await (await fetch(`/api/sessions/${id}`)).json()) as { session: { running: boolean }; entries: { kind: string; payload: { agentId?: string } }[] }
    let detail = await read()
    while (detail.session.running || !detail.entries.some((entry) => entry.kind === 'agent_end')) {
      await new Promise((resolve) => setTimeout(resolve, 30))
      detail = await read()
    }
    return detail.entries.find((entry) => entry.kind === 'agent_start')!.payload.agentId!
  }, parentId)
  const ids = [parentId, childId]
  expect(await first.window.evaluate(async (id) => (await fetch(`/api/sessions/${id}`)).status, childId)).toBe(200)
  await first.window.reload()
  await waitConnected(first.window)
  const row = first.window.getByRole('button', { name: 'Delete parent', exact: true })
  await row.click()
  await expect.poll(() => row.getAttribute('aria-current')).toBe('page')
  await row.click({ button: 'right', position: { x: 45, y: 16 } })
  await first.window.getByRole('menuitem', { name: /^(删除对话|Delete conversation)$/ }).click()
  const dialog = first.window.getByRole('alertdialog', { name: /^(要删除对话吗？|Delete conversation\?)$/ })
  await expect.poll(() => dialog.getByRole('button', { name: /^(取消|Cancel)$/ }).evaluate((element) => document.activeElement === element)).toBe(true)
  await dialog.getByRole('button', { name: /^(删除|Delete)$/ }).click()
  await expect.poll(() => first.window.locator('[data-session-id]').count()).toBe(0)
  await expect.poll(() => first.window.getByRole('heading', { name: /^(新对话|New chat)$/ }).isVisible()).toBe(true)
  await first.dispose()
  const second = await launchApp({}, { dir: root })
  onTestFinished(() => second.dispose())
  await waitConnected(second.window)
  expect(await second.window.locator('[data-session-id]').count()).toBe(0)
  expect(await second.window.evaluate(async (targets) => Promise.all(targets.map(async (id) => (await fetch(`/api/sessions/${id}`)).status)), ids)).toEqual([
    404, 404,
  ])
  expect(await readFile(join(folder, 'source.txt'), 'utf8')).toBe('unchanged source')
})
