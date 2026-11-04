// A list member that has never been opened receives global lifecycle broadcasts from the real Sidecar.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { launchApp, waitConnected } from './harness.ts'

it('updates an unopened Session while its background Subagent waits for approval and clears after cancellation', { timeout: 90000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'coko-status-e2e-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const workspace = join(root, 'workspace')
  await mkdir(workspace)
  const script = join(root, 'faux.json')
  await writeFile(
    script,
    JSON.stringify({
      responses: [
        {
          match: 'ROOT',
          content: [
            {
              type: 'toolCall',
              id: 'a',
              name: 'agent',
              arguments: { description: 'background writer', prompt: 'CHILD write', subagent_type: 'general', run_in_background: true },
            },
          ],
        },
        { match: 'CHILD', content: [{ type: 'toolCall', id: 'w', name: 'write', arguments: { path: 'out.txt', content: 'x' } }] },
        { match: 'ROOT', content: 'dispatched' },
      ],
    }),
  )
  const app = await launchApp({ COKO_FAUX_SCRIPT: script }, { dir: root })
  onTestFinished(() => app.dispose())
  const win = app.window
  await waitConnected(win)
  const ids = await win.evaluate(async (path) => {
    const post = async (route: string, body: unknown) =>
      (await fetch(route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json()
    const ws = await post('/api/workspaces', { path })
    const background = await post('/api/sessions', { workspaceId: ws.id, title: 'Unopened work' })
    const viewing = await post('/api/sessions', { workspaceId: ws.id, title: 'Viewing idle' })
    localStorage.setItem('coko.workbench.lists.v1', JSON.stringify({ categoryOrder: ['conversations', 'projects'], lastSessionId: viewing.id }))
    return { background: background.id as string, viewing: viewing.id as string }
  }, workspace)
  await win.reload()
  await waitConnected(win)
  await win.getByRole('heading', { name: 'Viewing idle', exact: true }).waitFor()
  const row = win.locator(`[data-session-id="${ids.background}"]`).locator('..')
  await win.getByRole('heading', { name: /^(Projects|项目)$/ }).hover()
  await win.evaluate(async (id) => {
    const response = await fetch(`/api/sessions/${id}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'ROOT delegate' }),
    })
    if (response.status !== 202) throw new Error(await response.text())
  }, ids.background)
  const indicator = row.getByRole('img', { name: /^(Running in background|后台运行中)$/ })
  await expect.poll(() => indicator.isVisible(), { timeout: 30000 }).toBe(true)
  expect(await win.getByRole('heading', { name: 'Viewing idle', exact: true }).count()).toBe(1)
  await win.evaluate(async (id) => {
    const children = (await (await fetch(`/api/sessions/${id}/agents`)).json()) as { agentId: string }[]
    const response = await fetch(`/api/sessions/${id}/agents/${children[0]!.agentId}/cancel`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    if (response.status !== 204) throw new Error(await response.text())
  }, ids.background)
  await expect.poll(() => row.locator('[data-sidebar-activity]').count(), { timeout: 30000 }).toBe(0)
})
