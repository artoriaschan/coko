import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { launchApp, waitConnected } from './harness.ts'

it('a project conversation renamed through its real context menu retains its title after Electron restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'coko-rename-restart-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const folder = join(root, 'example-project')
  await mkdir(folder)
  const first = await launchApp({}, { dir: root })
  onTestFinished(() => first.dispose())
  await waitConnected(first.window)
  const id = await first.window.evaluate(async (path) => {
    const workspace = (await (await fetch('/api/workspaces', { method: 'POST', body: JSON.stringify({ path, name: 'Example project' }) })).json()) as {
      id: string
    }
    const response = await fetch('/api/sessions', { method: 'POST', body: JSON.stringify({ workspaceId: workspace.id, title: 'Original conversation' }) })
    if (!response.ok) throw new Error(`seed failed ${response.status}`)
    return ((await response.json()) as { id: string }).id
  }, folder)
  await first.window.reload()
  await waitConnected(first.window)
  await first.window.getByRole('button', { name: 'Original conversation', exact: true }).click({ button: 'right', position: { x: 45, y: 16 } })
  const menu = first.window.getByRole('menu', { name: /^(对话操作|Conversation actions)$/ })
  await expect.poll(() => menu.isVisible()).toBe(true)
  await menu.getByRole('menuitem', { name: /^(重命名|Rename)$/ }).click()
  const input = first.window.getByRole('textbox', { name: /^(对话标题|Conversation title)$/ })
  await expect
    .poll(() => input.evaluate((element: HTMLInputElement) => [element.selectionStart, element.selectionEnd]))
    .toEqual([0, 'Original conversation'.length])
  await input.fill('Renamed example conversation')
  await input.press('Enter')
  await expect.poll(() => first.window.getByRole('button', { name: 'Renamed example conversation', exact: true }).isVisible()).toBe(true)
  await expect
    .poll(() =>
      first.window.evaluate(async (sessionId) => {
        const response = await fetch(`/api/sessions/${sessionId}`)
        return ((await response.json()) as { session: { title: string } }).session.title
      }, id),
    )
    .toBe('Renamed example conversation')
  await first.dispose()
  const restarted = await launchApp({}, { dir: root })
  onTestFinished(() => restarted.dispose())
  const window = restarted.window
  await waitConnected(window)
  const row = window.getByRole('button', { name: 'Renamed example conversation', exact: true })
  await expect.poll(() => row.isVisible()).toBe(true)
  expect(await window.locator(`[data-session-id="${id}"]`).count()).toBe(1)
  await row.hover()
  const details = window.getByRole('region', { name: /^(对话详情|Conversation details)$/ })
  await expect.poll(() => details.getByText('Renamed example conversation', { exact: true }).isVisible()).toBe(true)
  await expect.poll(() => details.getByText('Example project', { exact: true }).isVisible()).toBe(true)
})
