import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { launchApp, waitConnected } from './harness.ts'

it('search opens the identical existing pinned project Session without creating a conversation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'coko-search-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const folder = join(root, 'project')
  await mkdir(folder)
  const launched = await launchApp({}, { dir: root })
  onTestFinished(() => launched.dispose())
  const page = launched.window
  await waitConnected(page)
  const before = await page.evaluate(async (path) => {
    const post = async (route: string, body: unknown) => {
      const response = await fetch(route, { method: 'POST', body: JSON.stringify(body) })
      if (!response.ok) throw new Error(`seed failed ${response.status}`)
      return response.json()
    }
    const workspace = await post('/api/workspaces', { path, name: 'Search project' })
    const target = await post('/api/sessions', { workspaceId: workspace.id, title: 'Example conversation target' })
    await post('/api/sessions', { workspaceId: workspace.id, title: 'Example conversation other' })
    const pinned = await fetch(`/api/sessions/${target.id}/pin`, { method: 'PUT', body: JSON.stringify({ pinned: true }) })
    if (!pinned.ok) throw new Error(`pin failed ${pinned.status}`)
    return { target: await pinned.json(), sessions: (await (await fetch('/api/sessions')).json()).sessions }
  }, folder)
  await page.reload()
  await waitConnected(page)
  await page.getByRole('button', { name: 'Example conversation other', exact: true }).click()
  await page.getByRole('button', { name: /^(Search|搜索)$/ }).click()
  const dialog = page.getByRole('dialog', { name: /^(Search conversations|搜索对话)$/ })
  await dialog.getByRole('combobox').fill('  TARGET  ')
  await dialog.getByRole('combobox').press('Enter')
  await dialog.waitFor({ state: 'detached' })
  await expect.poll(() => page.locator(`[data-session-id="${before.target.id}"]`).getAttribute('aria-current')).toBe('page')
  const after = await page.evaluate(async () => (await (await fetch('/api/sessions')).json()).sessions)
  expect(after).toEqual(before.sessions)
  expect(after.find((session: { id: string }) => session.id === before.target.id)).toEqual(before.target)
})
