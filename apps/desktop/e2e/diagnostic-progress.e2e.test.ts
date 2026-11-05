// Actual Electron + Sidecar + Pi stream. Only faux model latency/output and clock are controlled.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { launchApp, waitConnected } from './harness.ts'

it('diagnostic progress captures a real faux Run before streaming and settles assistant, tool and late run_end frames', { timeout: 120_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'coko-diagnostic-progress-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const workspace = join(root, 'workspace')
  await mkdir(workspace)
  const requestLog = join(root, 'requests.jsonl')
  const script = join(root, 'faux.json')
  const command = `node -e ${JSON.stringify("const fs=require('fs'); const check=()=>{if(fs.existsSync('release')){watcher.close(); console.log('finished output'); process.exit(0)}}; const watcher=fs.watch('.',check); console.log('live tool output'); check()")}`
  await writeFile(
    script,
    JSON.stringify({
      requestLog,
      tokensPerSecond: 40,
      responses: [
        { match: 'COKO_SESSION_TITLE', content: 'Diagnostic progress' },
        {
          delayMs: 1000,
          content: [
            { type: 'thinking', thinking: 'Considering the command carefully. '.repeat(8) },
            { type: 'text', text: 'The tool will wait at a file barrier until the diagnostic rows are inspected.' },
            { type: 'toolCall', id: 'diagnostic-tool', name: 'bash', arguments: { command } },
          ],
        },
        { content: 'Diagnostic Run completed.' },
      ],
    }),
  )
  const app = await launchApp({ COKO_FAUX_SCRIPT: script, COKO_TEST_CLOCK: '1' }, { dir: root })
  onTestFinished(() => app.dispose())
  const page = app.window
  await waitConnected(page)
  const sessionId = await page.evaluate(async (path) => {
    const post = async (route: string, body: unknown) => {
      const result = await fetch(route, { method: 'POST', body: JSON.stringify(body) })
      if (!result.ok) throw new Error(`seed ${route}: ${result.status}`)
      return result.json()
    }
    const workspace = await post('/api/workspaces', { path, name: 'Diagnostics' })
    const session = await post('/api/sessions', { workspaceId: workspace.id, title: 'Diagnostic progress', model: { providerId: 'faux', modelId: 'faux-1' } })
    return session.id as string
  }, workspace)
  await page.reload()
  await waitConnected(page)
  await page.getByRole('button', { name: 'Diagnostic progress', exact: true }).click()
  await page.getByRole('button', { name: /^(Settings|设置)$/ }).click()
  const settings = page.getByRole('region', { name: /^(Settings|设置)$/ })
  await settings.getByRole('switch', { name: /^(Session diagnostics|会话数据诊断)$/ }).click()
  await expect.poll(() => settings.getByRole('switch', { name: /^(Session diagnostics|会话数据诊断)$/ }).isChecked()).toBe(true)
  await settings.getByRole('button', { name: /^(Back to app|返回应用)$/ }).click()
  await page.getByRole('button', { name: /^(Open sidebar|打开侧边栏)$/ }).click()
  const panel = page.getByRole('region', { name: /^(Sidebar|侧边栏)$/ })
  await panel.getByRole('button', { name: /^(Session diagnostics|会话数据诊断)$/ }).click()
  const table = panel.getByRole('table')
  await table.waitFor()
  await page.locator('[data-permission-mode]').click()
  await page.locator('[role="menuitemradio"][data-mode="full-access"]').click()
  await page.getByRole('button', { name: /^(Turn on anyway|仍要开启)$/ }).click()
  const composer = page.getByRole('textbox', { name: /Give Coko a task|向 Coko 布置任务/ })
  await composer.fill('Run diagnostic barrier')
  await composer.press('Enter')
  // The model timer is armed before this log is written: no sleeps or subscription races.
  await expect.poll(async () => (await readFile(requestLog, 'utf8').catch(() => '')).includes('Run diagnostic barrier')).toBe(true)
  await page.evaluate(async () => {
    const response = await fetch('/api/test/clock', { method: 'POST', body: JSON.stringify({ advanceMs: 1000 }) })
    if (!response.ok) throw new Error('clock advance failed')
  })
  await table.getByRole('button', { name: 'assistant_delta/thinking', exact: true }).waitFor()
  await table.getByRole('button', { name: /^(Collapse|收起) assistant_delta\/thinking$/ }).click()
  await expect.poll(() => table.textContent()).toContain('Considering')
  await table.getByRole('button', { name: 'tool_update', exact: true }).waitFor({ timeout: 45_000 })
  const toolHeader = table.locator('tr[data-record-key]').filter({ has: page.getByRole('button', { name: 'tool', exact: true }) })
  expect(await toolHeader.count()).toBe(1)
  expect(await table.locator('tr[data-record-key^="progress:"]').evaluateAll((rows) => rows.every((row) => row.children[3]?.textContent === ''))).toBe(true)
  await writeFile(join(workspace, 'release'), '1')
  await page.locator('[data-action="send"]').waitFor({ timeout: 30_000 })
  const entries = await page.evaluate(
    async (id) => (await (await fetch(`/api/sessions/${id}`)).json()).entries as import('@coko/protocol').SessionEntryRecord[],
    sessionId,
  )
  const assistant = entries.find((entry) => entry.kind === 'message' && (entry.payload as { role?: string }).role === 'assistant')!
  const tool = entries.find((entry) => entry.kind === 'message' && (entry.payload as { role?: string }).role === 'toolResult')!
  const end = entries.find((entry) => entry.kind === 'run_end')!
  const row = (seq: number) => table.locator(`tr[data-record-key="entry:${seq}"]`)
  expect(
    await row(assistant.seq)
      .getByRole('button', { name: /^(Expand|展开) message\/assistant$/ })
      .count(),
  ).toBe(1)
  expect(
    await row(tool.seq)
      .getByRole('button', { name: /^(Expand|展开) message\/toolResult$/ })
      .count(),
  ).toBe(1)
  await row(end.seq)
    .getByRole('button', { name: /^(Expand|展开) run_end$/ })
    .click()
  await table
    .locator('tr[data-record-key^="progress:group:"]')
    .filter({ has: page.getByRole('button', { name: 'run_end', exact: true }) })
    .waitFor()
  await page.reload()
  await waitConnected(page)
  await panel.getByRole('table').waitFor()
  expect(await panel.locator('tr[data-record-key^="progress:"]').count()).toBe(0)
})
