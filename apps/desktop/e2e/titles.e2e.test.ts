import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { launchApp, waitConnected } from './harness.ts'

it('first-send title is replaced in the real Electron list and details after its independent request completes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'coko-title-e2e-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const script = join(root, 'faux.json')
  await writeFile(script, JSON.stringify({ responses: [{ match: 'COKO_SESSION_TITLE', content: 'Calendar planning', delayMs: 1000 }, { content: 'Ready.' }] }))
  const app = await launchApp({ COKO_FAUX_SCRIPT: script, COKO_TEST_CLOCK: '1' }, { dir: root })
  onTestFinished(() => app.dispose())
  const page = app.window
  await waitConnected(page)
  await page.getByRole('textbox', { name: /Give Coko a task|向 Coko 布置任务/ }).fill('Build my calendar')
  await page.getByRole('button', { name: /^(Send|发送)$/ }).click()
  const row = page.getByRole('button', { name: 'Build my calendar', exact: true })
  await row.waitFor()
  await row.hover()
  const details = page.getByRole('region', { name: /Conversation details|对话详情/ })
  await details.getByText('Build my calendar', { exact: true }).waitFor()
  await page.evaluate(async () => {
    await fetch('/api/test/clock', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ advanceMs: 1000 }) })
  })
  await page.getByRole('button', { name: 'Calendar planning', exact: true }).waitFor()
  await details.getByText('Calendar planning', { exact: true }).waitFor()
  const response = await page.evaluate(async () => (await (await fetch('/api/sessions')).json()).sessions[0])
  expect(response.title).toBe('Calendar planning')
  await page.screenshot({ path: '/tmp/coko-title-e2e.png' })
})
