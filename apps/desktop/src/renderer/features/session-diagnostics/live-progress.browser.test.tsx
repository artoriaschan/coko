import '../../styles.css'
import type { SessionEntryRecord } from '@coko/protocol'
import { expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { App } from '../../app/app.tsx'
import { createAppearanceStore } from '../../app/appearance-store.ts'
import { createConnectionStore } from '../../app/connection-store.ts'
import { createPreferences } from '../../app/preferences.ts'
import { createSettingsPageStore } from '../../app/settings-page-store.ts'
import { createFixtureChat, fixtureSessions } from '../../testing/fixture-chat.ts'

const entry = (seq: number, kind: string, payload: unknown, runId: string | null = 'run-a'): SessionEntryRecord => ({
  sessionId: 's-1',
  seq,
  kind,
  payloadVersion: 1,
  createdAt: 1_700_000_000_000 + seq,
  runId: runId ?? null,
  payload,
})
const records = [
  entry(1, 'run_start', { trigger: 'submit' }),
  entry(3, 'message', { role: 'user', content: 'user literal token and [REDACTED:secret]', timestamp: 0 }),
  entry(5, 'run_end', { status: 'completed' }),
]
async function open(entries = records, options: { width?: number; locale?: 'en' | 'zh'; theme?: 'light' | 'dark'; archived?: boolean } = {}) {
  await page.viewport(options.width ?? 1280, 800)
  const fixture = createFixtureChat({
    entries: { 's-1': entries },
    ...(options.archived ? { sessions: fixtureSessions.map((session) => (session.id === 's-1' ? { ...session, archivedAt: 1 } : session)) } : {}),
  })
  fixture.backend.externalWrite('developer', { sessionDiagnostics: true })
  await fixture.settings.getState().load()
  const appearance = createAppearanceStore({ locale: options.locale ?? 'en', theme: options.theme ?? 'light' })
  const preferences = createPreferences({ appearance, settings: fixture.settings, onConflict() {}, onFailure() {} })
  const settingsPage = createSettingsPageStore()
  await render(
    <div style={{ width: '100vw', height: '100vh' }}>
      <App
        store={appearance}
        connection={createConnectionStore()}
        chat={fixture.chat}
        settings={fixture.settings}
        preferences={preferences}
        settingsPage={settingsPage}
        pickDirectory={async () => null}
      />
    </div>,
  )
  if (options.archived) {
    settingsPage.open('archived')
    await page.getByRole('button', { name: options.locale === 'zh' ? '打开对话' : 'Open conversation', exact: true }).click()
  }
  await expect.poll(() => fixture.chat.getState().conversations['s-1']?.status).toBe('ready')
  await page.getByRole('button', { name: options.locale === 'zh' ? '打开侧边栏' : 'Open sidebar', exact: true }).click()
  const panel = page.getByRole('region', { name: options.locale === 'zh' ? '侧边栏' : 'Sidebar', exact: true })
  fixture.sendServer({
    type: 'progress',
    sessionId: 's-1',
    runId: 'run-a',
    event: { type: 'assistant_delta', contentIndex: 5, kind: 'text', delta: 'before diagnostic tab', offset: 0 },
  })
  await panel.getByRole('button', { name: options.locale === 'zh' ? '会话数据诊断' : 'Session diagnostics', exact: true }).click()
  return { ...fixture, panel }
}

it('actual App replays Run progress through real stores, transfers blocks and tools, retains hidden tabs and clears closed or switched Sessions', async () => {
  const { panel, sendServer, sent } = await open([entry(1, 'run_start', { trigger: 'submit' })])
  const progress = (event: import('@coko/protocol').ProgressEvent, runId = 'run-a') => sendServer({ type: 'progress', sessionId: 's-1', runId, event })
  const table = panel.getByRole('table')
  expect(table.element().textContent).not.toContain('before diagnostic tab')
  progress({ type: 'assistant_delta', contentIndex: 0, kind: 'thinking', delta: 'Think ', offset: 0 })
  progress({ type: 'assistant_delta', contentIndex: 1, kind: 'toolcall', delta: '{"command":', offset: 0 })
  progress({ type: 'assistant_delta', contentIndex: 0, kind: 'thinking', delta: 'carefully', offset: 6 })
  progress({ type: 'assistant_delta', contentIndex: 1, kind: 'toolcall', delta: '"pwd"}', offset: 11 })
  await expect.element(table.getByRole('button', { name: 'assistant_delta/thinking', exact: true })).toBeVisible()
  await table.getByRole('button', { name: 'Collapse assistant_delta/thinking', exact: true }).click()
  await expect.element(table.getByText('Think carefully', { exact: true })).toBeVisible()
  await table.getByRole('button', { name: 'Collapse assistant_delta/toolcall', exact: true }).click()
  await expect.element(table.getByText('{"command":"pwd"}', { exact: true })).toBeVisible()
  const liveRows = [...table.element().querySelectorAll('tr[data-record-key^="progress:"]')]
  expect(liveRows.length).toBeGreaterThan(2)
  expect(liveRows.every((row) => row.children[3]?.textContent === '')).toBe(true)
  progress({ type: 'lsp_update', servers: [] })
  expect(table.element().textContent).not.toContain('lsp_update')
  sendServer({
    type: 'entry',
    sessionId: 's-1',
    entry: entry(2, 'message', {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'Think carefully' },
        { type: 'toolCall', id: 't1', name: 'bash', arguments: { command: 'pwd' } },
      ],
      stopReason: 'toolUse',
      timestamp: 0,
    }),
  })
  await expect.element(table.getByRole('button', { name: 'Expand message/assistant', exact: true })).toBeVisible()
  await expect.element(table.getByRole('button', { name: 'assistant_delta/thinking', exact: true })).not.toBeInTheDocument()
  await table.getByRole('button', { name: 'Expand message/assistant', exact: true }).click()
  await expect.element(table.getByText('Think carefully', { exact: true })).toBeVisible()
  progress({ type: 'tool_start', toolCallId: 't1', toolName: 'bash', args: { command: 'pwd' } })
  progress({ type: 'tool_update', toolCallId: 't1', toolName: 'bash', partialResult: 'pwd output' })
  await expect.element(table.getByRole('button', { name: 'tool_update', exact: true })).toBeVisible()
  sendServer({
    type: 'entry',
    sessionId: 's-1',
    entry: entry(3, 'message', {
      role: 'toolResult',
      toolCallId: 't1',
      toolName: 'bash',
      content: [{ type: 'text', text: 'pwd output' }],
      isError: false,
      timestamp: 0,
    }),
  })
  progress({ type: 'tool_end', toolCallId: 't1', toolName: 'bash', result: 'pwd output', isError: false })
  await expect.element(table.getByRole('button', { name: 'Expand message/toolResult', exact: true })).toBeVisible()
  progress({ type: 'retry', attempt: 1, maxRetries: 2, delayMs: 1, errorMessage: 'transient' })
  await expect.element(table.getByRole('button', { name: 'retry', exact: true })).toBeVisible()
  await panel.getByRole('button', { name: 'New tab', exact: true }).click()
  await panel.getByRole('button', { name: 'Plan', exact: true }).click()
  progress({ type: 'context_usage', tokens: 7, contextWindow: 100 })
  await panel.getByRole('tab', { name: 'Session diagnostics', exact: true }).click()
  await expect.element(table.getByRole('button', { name: 'context_usage', exact: true })).toBeVisible()
  await panel.getByRole('button', { name: 'Collapse sidebar', exact: true }).click()
  progress({ type: 'context_usage', tokens: 8, contextWindow: 100 })
  await page.getByRole('button', { name: 'Open sidebar', exact: true }).click()
  await expect.poll(() => table.element().querySelectorAll('tr[data-record-key^="progress:"]').length).toBeGreaterThan(3)
  await page.getByRole('button', { name: 'Sidecar startup handshake', exact: true }).click()
  await page.getByRole('button', { name: '设计 token 与三栏骨架', exact: true }).click()
  await expect.element(table.getByRole('button', { name: 'retry', exact: true })).not.toBeInTheDocument()
  progress({ type: 'retry', attempt: 1, maxRetries: 2, delayMs: 1, errorMessage: 'new transient' })
  await expect.element(table.getByRole('button', { name: 'retry', exact: true })).toBeVisible()
  await panel.getByRole('button', { name: 'Close Session diagnostics', exact: true }).click()
  progress({ type: 'context_usage', tokens: 9, contextWindow: 100 })
  await panel.getByRole('button', { name: 'New tab', exact: true }).click()
  await panel.getByRole('button', { name: 'Session diagnostics', exact: true }).click()
  await expect.element(table.getByRole('button', { name: 'context_usage', exact: true })).not.toBeInTheDocument()
  expect(table.element().querySelectorAll('tr[data-record-key^="progress:"]').length).toBe(0)
  expect(sent.filter((message) => message.type === 'subscribe')).toHaveLength(2)
})

it('actual App preserves manually collapsed JSON branches through live updates and resets them only for a different record', async () => {
  const { panel, sendServer } = await open([entry(1, 'run_start', { trigger: 'submit' })])
  const delta = (text: string, offset: number) =>
    sendServer({
      type: 'progress',
      sessionId: 's-1',
      runId: 'run-a',
      event: { type: 'assistant_delta', contentIndex: 0, kind: 'thinking', delta: text, offset },
    })
  delta('First', 0)
  await panel.getByRole('button', { name: 'assistant_delta/thinking', exact: true }).click()
  const details = panel.getByRole('region', { name: 'Record details', exact: true })
  const root = details.element().querySelector<HTMLDetailsElement>('details')!
  await page.elementLocator(root.querySelector('summary')!).click()
  await expect.poll(() => root.open).toBe(false)
  const handle = details.getByRole('separator')
  await handle.click()
  await userEvent.keyboard('{End}')
  delta(' second', 5)
  await expect.element(panel.getByRole('button', { name: 'Inspect record group:1', exact: true })).toBeVisible()
  await expect.poll(() => details.element().querySelector('details')).toBe(root)
  expect(root.open).toBe(false)
  await expect.element(handle).toHaveAttribute('aria-valuenow', '80')
  await panel.getByRole('button', { name: 'Inspect record 1', exact: true }).click()
  await expect.poll(() => details.element().querySelector<HTMLDetailsElement>('details')?.open).toBe(true)
  await expect.element(handle).toHaveAttribute('aria-valuenow', '80')
})
