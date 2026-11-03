import '../../styles.css'
import type { SessionEntryRecord } from '@coko/protocol'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { App } from '../../app/app.tsx'
import { createAppearanceStore } from '../../app/appearance-store.ts'
import { createConnectionStore } from '../../app/connection-store.ts'
import { createPreferences } from '../../app/preferences.ts'
import { createSettingsPageStore } from '../../app/settings-page-store.ts'
import { createFixtureChat } from '../../testing/fixture-chat.ts'

const entry = (seq: number, kind: string, payload: unknown): SessionEntryRecord => ({
  sessionId: 's-1',
  seq,
  kind,
  payloadVersion: 1,
  payload,
  runId: 'run-1',
  createdAt: seq,
})
const call = (seq: number, id: string, name: string, args: unknown) =>
  entry(seq, 'message', { role: 'assistant', content: [{ type: 'toolCall', id, name, arguments: args }], stopReason: 'toolUse', timestamp: 0 })
const result = (seq: number, id: string, text: string, isError = false) =>
  entry(seq, 'message', { role: 'toolResult', toolCallId: id, toolName: 'custom', content: [{ type: 'text', text }], isError, timestamp: 0 })

let viewport = { width: 0, height: 0 }
beforeEach(() => {
  viewport = { width: window.innerWidth, height: window.innerHeight }
})
afterEach(async () => {
  await page.viewport(viewport.width, viewport.height)
})

async function open(entries: SessionEntryRecord[], theme: 'light' | 'dark' = 'light', locale: 'zh' | 'en' = 'en') {
  const fixture = createFixtureChat({ entries: { 's-1': entries } })
  const appearance = createAppearanceStore({ theme, locale })
  const preferences = createPreferences({ appearance, settings: fixture.settings, onConflict: () => {}, onFailure: () => {} })
  await render(
    <div style={{ width: '100vw', height: '100vh' }}>
      <App
        store={appearance}
        connection={createConnectionStore()}
        chat={fixture.chat}
        settings={fixture.settings}
        preferences={preferences}
        settingsPage={createSettingsPageStore()}
        pickDirectory={async () => null}
      />
    </div>,
  )
  await expect.poll(() => fixture.chat.getState().conversations['s-1']?.status).toBe('ready')
  return fixture
}

it('actual App: commands, edits and failures start collapsed; generic input/output and Inspect remain reachable with the keyboard', async () => {
  await open([
    entry(1, 'run_start', { trigger: 'submit' }),
    call(2, 'b', 'bash', { command: 'echo sample' }),
    result(3, 'b', 'sample'),
    call(4, 'e', 'edit', { path: 'src/file.ts' }),
    result(5, 'e', 'no such file', true),
    call(6, 'm', 'mcp__sample__query', { query: 'unchanged 原文', enabled: false }),
    result(7, 'm', 'real output'),
    entry(8, 'run_end', { status: 'completed' }),
  ])
  await page.getByRole('button', { name: 'Work steps', exact: true }).click()
  await page.getByRole('button', { name: 'Ran commands, modified files, called tools', exact: true }).click()
  const rows = document.querySelectorAll('[data-slot="tool-card"]')
  expect(rows).toHaveLength(3)
  for (const row of rows) {
    expect(row.querySelector('button')!.getAttribute('aria-expanded')).toBe('false')
    expect(row.querySelector('[data-slot="tool-card-body"]')).toBeNull()
    expect(row.querySelector('button')!.getBoundingClientRect().height).toBe(24)
  }
  const header = rows[2]!.querySelector<HTMLButtonElement>('button')!
  header.focus()
  await userEvent.keyboard('{Enter}')
  await expect.element(page.getByText('real output', { exact: true })).toBeVisible()
  expect(rows[2]!.textContent).toContain('"query": "unchanged 原文"')
  expect(rows[2]!.textContent).toContain('"enabled": false')
  await page.getByRole('button', { name: 'Inspect', exact: true }).click()
  await expect.element(page.getByRole('tab', { name: 'Trace', exact: true })).toHaveAttribute('aria-selected', 'true')
})

it.each([
  ['light', 'en'],
  ['light', 'zh'],
  ['dark', 'en'],
  ['dark', 'zh'],
] as const)('actual App: %s/%s keeps long generic input/output and failure readable at 390px', async (theme, locale) => {
  await page.viewport(390, 800)
  await open(
    [
      entry(1, 'run_start', { trigger: 'submit' }),
      call(2, 'unknown', 'mcp__sample__' + 'long_name_'.repeat(20), { source: '目录/'.repeat(60), text: '原文 preserved' }),
      result(3, 'unknown', 'Failure: ' + 'long_error_'.repeat(80), true),
      entry(4, 'run_end', { status: 'error' }),
    ],
    theme,
    locale,
  )
  await page.getByRole('button', { name: locale === 'en' ? 'Called tools' : '已调用工具', exact: true }).click()
  const row = document.querySelector<HTMLElement>('[data-slot="tool-card"]')!
  await page.elementLocator(row).getByRole('button').click()
  const card = row.querySelector<HTMLElement>('.tool-io-card')!
  const input = row.querySelector<HTMLElement>('.tool-io-text')!
  expect(card.scrollWidth).toBeLessThanOrEqual(card.clientWidth)
  expect(input.textContent).toContain('原文 preserved')
  expect(getComputedStyle(input).color).not.toBe(getComputedStyle(card).backgroundColor)
  expect(row.getBoundingClientRect().right).toBeLessThanOrEqual(window.innerWidth)
  expect(row.querySelector('[role="status"]')?.textContent).toBe(locale === 'en' ? 'Failed' : '失败')
  expect(row.querySelector('.tool-io-label')?.textContent).toBe(locale === 'en' ? 'IN' : '输入')
})

it('actual App: streaming settlement keeps one call, expanded content, selection and scroll; identical arguments do not merge different calls', async () => {
  const fixture = await open([entry(1, 'run_start', { trigger: 'submit' })])
  const args = { query: 'select this unchanged input' }
  const progress = (event: Parameters<typeof fixture.sendServer>[0] & { type: 'progress' }) => fixture.sendServer(event)
  progress({ type: 'progress', sessionId: 's-1', runId: 'run-1', event: { type: 'tool_start', toolCallId: 'one', toolName: 'custom', args } })
  progress({
    type: 'progress',
    sessionId: 's-1',
    runId: 'run-1',
    event: { type: 'tool_update', toolCallId: 'one', toolName: 'custom', partialResult: { content: [{ type: 'text', text: 'line\n'.repeat(60) }] } },
  })
  const header = page.getByRole('button', { name: /Tool call/ })
  await header.click()
  const body = document.querySelector('[data-slot="tool-card-body"]')!
  const input = body.querySelector('.tool-io-text')!
  const scroll = body.querySelectorAll<HTMLElement>('.tool-io-section')[1]!
  scroll.scrollTop = 80
  const range = document.createRange()
  range.selectNodeContents(input)
  window.getSelection()!.removeAllRanges()
  window.getSelection()!.addRange(range)
  const selected = window.getSelection()!.toString()
  fixture.sendServer({ type: 'entry', sessionId: 's-1', entry: call(2, 'one', 'custom', args) })
  fixture.sendServer({
    type: 'entry',
    sessionId: 's-1',
    entry: {
      ...result(3, 'one', 'line\n'.repeat(60)),
      payload: { ...(result(3, 'one', 'line\n'.repeat(60)).payload as object), details: { receipt: 'actual-detail' } },
    },
  })
  await expect.poll(() => body.textContent).toContain('actual-detail')
  expect(document.querySelector('[data-slot="tool-card-body"]')).toBe(body)
  expect(scroll.scrollTop).toBe(80)
  expect(window.getSelection()!.toString()).toBe(selected)
  expect(header.element().getAttribute('aria-expanded')).toBe('true')
  progress({ type: 'progress', sessionId: 's-1', runId: 'run-1', event: { type: 'tool_start', toolCallId: 'two', toolName: 'custom', args } })
  await expect.poll(() => document.querySelectorAll('[data-slot="tool-card"]').length).toBe(2)
  expect(document.querySelectorAll('[data-slot="tool-card-body"]')).toHaveLength(1)
  fixture.sendServer({ type: 'entry', sessionId: 's-1', entry: call(4, 'two', 'custom', args) })
  fixture.sendServer({ type: 'entry', sessionId: 's-1', entry: entry(5, 'run_end', { status: 'interrupted' }) })
  await expect.element(page.getByRole('status').filter({ hasText: 'No recorded result' })).toBeVisible()
})
