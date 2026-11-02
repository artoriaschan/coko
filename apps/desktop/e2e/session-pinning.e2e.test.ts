import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { launchApp, waitConnected } from './harness.ts'

it('project conversation pin survives Electron restart and unpin returns it to the original project', async () => {
  const root = await mkdtemp(join(tmpdir(), 'coko-pin-restart-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const folder = join(root, 'example-project')
  await mkdir(folder)
  const first = await launchApp({}, { dir: root })
  onTestFinished(() => first.dispose())
  await waitConnected(first.window)
  const seed = await first.window.evaluate(async (path) => {
    const workspace = (await (await fetch('/api/workspaces', { method: 'POST', body: JSON.stringify({ path, name: 'Example project' }) })).json()) as {
      id: string
    }
    const response = await fetch('/api/sessions', { method: 'POST', body: JSON.stringify({ workspaceId: workspace.id, title: 'Example pinned conversation' }) })
    if (!response.ok) throw new Error(`seed failed ${response.status}`)
    return (await response.json()) as { id: string; projectId: string }
  }, folder)
  await first.window.reload()
  await waitConnected(first.window)
  await first.window.getByRole('button', { name: 'Example pinned conversation', exact: true }).hover()
  await first.window.getByRole('button', { name: /^(置顶对话|Pin conversation)$/ }).click()
  await expect
    .poll(() =>
      first.window
        .getByRole('region', { name: /^(置顶|Pinned)$/ })
        .locator(`[data-session-id="${seed.id}"]`)
        .count(),
    )
    .toBe(1)
  expect(await first.window.locator(`[data-project-id="${seed.projectId}"] [data-session-id="${seed.id}"]`).count()).toBe(0)
  await first.dispose()
  const restarted = await launchApp({}, { dir: root })
  onTestFinished(() => restarted.dispose())
  const window = restarted.window
  await waitConnected(window)
  const pinned = window.getByRole('region', { name: /^(置顶|Pinned)$/ })
  await expect.poll(() => pinned.locator(`[data-session-id="${seed.id}"]`).count()).toBe(1)
  await pinned.getByRole('button', { name: 'Example pinned conversation', exact: true }).hover()
  const details = window.getByRole('region', { name: /^(对话详情|Conversation details)$/ })
  await expect.poll(() => details.getByText('Example project', { exact: true }).isVisible()).toBe(true)
  await window.getByRole('button', { name: /^(取消置顶对话|Unpin conversation)$/ }).click()
  await expect.poll(() => window.locator(`[data-project-id="${seed.projectId}"] [data-session-id="${seed.id}"]`).count()).toBe(1)
  expect(await window.locator(`[data-session-id="${seed.id}"]`).count()).toBe(1)
  expect(await window.getByRole('heading', { name: /^(置顶|Pinned)$/ }).count()).toBe(0)
})
