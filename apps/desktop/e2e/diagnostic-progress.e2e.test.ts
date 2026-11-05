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
  // Selection must reveal the real, settled tool through the existing Run/group/tool disclosures.
  const timelineTool = page.locator('[data-main-timeline-session] [data-tool-call-id="diagnostic-tool"]')
  const runControl = page.locator('[data-main-timeline-session] [data-slot="run-process-control"]')
  if ((await runControl.getAttribute('aria-expanded')) === 'true') await runControl.click()
  await expect.poll(() => timelineTool.evaluate((element) => element.closest('[hidden]') !== null)).toBe(true)
  await row(tool.seq)
    .getByRole('button', { name: new RegExp(`^(Inspect record|查看记录) ${tool.seq}$`) })
    .click()
  await expect.poll(() => timelineTool.evaluate((element) => element.closest('[hidden]') === null)).toBe(true)
  await expect.poll(() => timelineTool.locator('[aria-expanded="true"]').count()).toBeGreaterThan(0)
  await expect
    .poll(() =>
      timelineTool.evaluate((element) => {
        const rect = element.getBoundingClientRect()
        const port = element.closest('[data-main-timeline-session]')!.getBoundingClientRect()
        return rect.height > 0 && rect.bottom > port.top && rect.top < port.bottom
      }),
    )
    .toBe(true)
  await expect.poll(() => page.locator('[data-slot="timeline-highlight"]').count()).toBe(1)
  // Complete the new keyboard picker through the packaged renderer with the same DOM identity map.
  await panel.getByRole('button', { name: /^(Display format|展示形式)$/ }).click()
  await page.getByRole('menuitemradio', { name: /^(Conversation groups|对话分组)$/ }).click()
  const inspectTool = table.getByRole('button', { name: /^(Inspect record|查看记录) tool:diagnostic-tool$/ })
  await inspectTool.click()
  const details = panel.getByRole('region', { name: /^(Record details|记录详情)$/ })
  await details.getByRole('button', { name: /^Run · / }).click()
  const toolTrigger = timelineTool.locator('button[aria-expanded]').first()
  const expandedBefore = await toolTrigger.getAttribute('aria-expanded')
  const picker = panel.getByRole('button', { name: /^(Pick from timeline|瞄准)$/ })
  await picker.focus()
  await picker.press('Enter')
  await expect.poll(() => page.locator('[data-slot="timeline-mask"]').count()).toBe(1)
  await picker.press('Home')
  const seen: string[] = []
  for (let index = 0; index < 30; index++) {
    const current = await panel.locator('[data-picker-current]').getAttribute('data-picker-current')
    if (current) seen.push(current)
    if (current === 'tool:diagnostic-tool') break
    await picker.press('ArrowDown')
  }
  expect(seen).toContain('tool:diagnostic-tool')
  await picker.press('Enter')
  await expect.poll(() => page.locator('[data-slot="timeline-mask"]').count()).toBe(0)
  await expect.poll(() => details.getByRole('navigation').textContent()).toBe('tool:diagnostic-tool')
  expect(await toolTrigger.getAttribute('aria-expanded')).toBe(expandedBefore)
  await panel.getByRole('button', { name: /^(Filter types|筛选类型)$/ }).hover()
  await expect.poll(() => page.getByRole('tooltip').textContent()).toMatch(/Filter types|筛选类型/)
  await page.reload()
  await waitConnected(page)
  await panel.getByRole('table').waitFor()
  expect(await panel.locator('tr[data-record-key^="progress:"]').count()).toBe(0)
})
