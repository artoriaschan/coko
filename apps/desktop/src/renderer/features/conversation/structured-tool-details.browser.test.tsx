import '../../styles.css'
import type { SessionEntryRecord } from '@coko/protocol'
import { afterEach, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { App } from '../../app/app.tsx'
import { createAppearanceStore } from '../../app/appearance-store.ts'
import { createConnectionStore } from '../../app/connection-store.ts'
import { createPreferences } from '../../app/preferences.ts'
import { createSettingsPageStore } from '../../app/settings-page-store.ts'
import { createFixtureChat } from '../../testing/fixture-chat.ts'

const entry = (seq: number, payload: unknown): SessionEntryRecord => ({
  sessionId: 's-1',
  seq,
  kind: 'message',
  payloadVersion: 1,
  payload,
  runId: 'run-1',
  createdAt: seq,
})
const call = (seq: number, id: string, name: string, args: unknown) =>
  entry(seq, { role: 'assistant', content: [{ type: 'toolCall', id, name, arguments: args }], stopReason: 'toolUse', timestamp: 0 })
const result = (seq: number, id: string, text: string, details?: unknown, isError = false) =>
  entry(seq, { role: 'toolResult', toolCallId: id, toolName: 'custom', content: [{ type: 'text', text }], details, isError, timestamp: 0 })

const viewport = { width: window.innerWidth, height: window.innerHeight }
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
  for (const control of document.querySelectorAll(
    '[data-slot="run-process-control"][aria-expanded="false"]:not(:disabled), [data-slot="process-group-header"][aria-expanded="false"]',
  ))
    await page.elementLocator(control).click()
}

it('actual App: search retains raw results, caps at eight lines, expands by keyboard and copies the whole original output', async () => {
  const original = 'src/a.ts:7: original\nsecond\nthird\nfourth\nfifth\nsixth\nseventh\neighth\nninth\ntenth\neleventh\ntwelfth'
  const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
  await open([call(1, 'g', 'grep', { pattern: 'original', path: 'src', context: 2 }), result(2, 'g', original, { linesTruncated: true })])
  await page
    .elementLocator(document.querySelector('[data-slot="tool-card"]')!)
    .getByRole('button', { name: /Search/ })
    .click()
  const card = document.querySelector('[data-search-detail]')!
  expect(card).not.toBeNull()
  expect(card.textContent).toContain('src/a.ts:7: original')
  expect(card.textContent).not.toContain('fifth')
  expect(card.textContent).not.toMatch(/12 (?:matches|paths)/)
  const expand = page.getByRole('button', { name: 'Expand 4 more result lines' })
  expand.element().focus()
  await userEvent.keyboard('{Enter}')
  expect(card.textContent).toContain('fifth')
  const collapse = page.getByRole('button', { name: 'Collapse results', exact: true })
  collapse.element().focus()
  await userEvent.keyboard(' ')
  await expect.element(expand).toHaveFocus()
  expect(card.textContent).not.toContain('fifth')
  await page.elementLocator(card).getByRole('button', { name: 'Copy', exact: true }).click()
  expect(copy).toHaveBeenCalledWith(original)
  await page.getByText('Input / output', { exact: true }).click()
  expect(document.querySelector('.tool-io-card')!.textContent).toContain('"context": 2')
  expect(document.querySelector('.tool-io-card')!.textContent).toContain('"linesTruncated": true')
})

it('actual App: LSP distinguishes request fields from returned locations, preserves actual counts and opens the existing Trace view', async () => {
  await open([
    call(1, 'l', 'lsp', { operation: 'references', file_path: 'request.ts', line: 3, character: 7 }),
    result(2, 'l', 'returned.ts:19:2 original result', { count: 2, total: 4, truncated: true }),
  ])
  await page.getByRole('button', { name: /Find references/ }).click()
  const card = document.querySelector('[data-structured-detail="lsp"]')!
  expect(card).not.toBeNull()
  expect(card.textContent).toContain('Request')
  expect(card.textContent).toContain('request.ts')
  expect(card.querySelector('[data-lsp-count]')!.textContent).toBe('Showing 2 of 4')
  expect(card.textContent).toContain('returned.ts:19:2 original result')
  expect(card.querySelector('a, button')).toBeNull()
  await page.getByRole('button', { name: 'Inspect', exact: true }).click()
  await expect.element(page.getByRole('tab', { name: 'Trajectory', exact: true })).toHaveAttribute('aria-selected', 'true')
})

it('actual App: Memory shows the recorded saved entry, keeps original arguments and receipts, and never retries a failed operation', async () => {
  await open([
    call(1, 'm', 'memory_write', { content: '  requested raw  ', scope: 'workspace' }),
    result(2, 'm', 'Remembered (id: m-1, scope: workspace).', {
      action: 'created',
      memory: { id: 'm-1', scope: 'workspace', content: 'stored original 原文', updatedAt: 100, source: 'model' },
    }),
    call(3, 'deleted', 'memory_delete', { id: 'm-1' }),
    result(4, 'deleted', 'Deleted memory m-1.', { action: 'deleted', memory: { id: 'm-1', scope: 'workspace', content: 'stored original 原文' } }),
    call(5, 'failed', 'memory_delete', { id: 'missing' }),
    result(6, 'failed', 'Memory entry missing not found', undefined, true),
    call(7, 'list', 'memory_list', { query: 'literal query' }),
    result(8, 'list', 'No memories match "literal query".'),
  ])
  const rows = document.querySelectorAll('[data-slot="tool-card"]')
  for (const row of rows) await page.elementLocator(row).getByRole('button').click()
  expect(rows[0]!.querySelector('[data-structured-detail]')!.textContent).toContain('stored original 原文')
  expect(rows[0]!.querySelector('[data-structured-detail]')!.textContent).not.toContain('requested raw')
  await page.elementLocator(rows[0]!).getByText('Input / output', { exact: true }).click()
  expect(rows[0]!.textContent).toContain('  requested raw  ')
  expect(rows[0]!.textContent).toContain('"updatedAt": 100')
  expect(rows[1]!.querySelector('[data-structured-detail]')!.textContent).toContain('deleted')
  expect(rows[2]!.querySelector('[data-structured-detail]')).toBeNull()
  expect(rows[2]!.textContent).toContain('Memory entry missing not found')
  expect(rows[3]!.textContent).toContain('No memories match "literal query".')
  expect(rows[2]!.querySelectorAll('button')).toHaveLength(2) // disclosure and existing Inspect only
})

it('actual App: empty, failed and unrecognized results retain complete truthful input/output without fabricated counts or links', async () => {
  await open([
    call(1, 'empty', 'grep', { pattern: 'empty' }),
    result(2, 'empty', 'No matches found'),
    call(3, 'find', 'find', { pattern: '*.ts' }),
    result(4, 'find', ''),
    call(5, 'failed', 'grep', { pattern: '[' }),
    result(6, 'failed', 'Invalid regular expression: [', undefined, true),
    call(7, 'unknown', 'mcp__custom__lookup', { query: 'untouched 原文', enabled: false }),
    result(8, 'unknown', 'original output', { nested: { items: [], value: 0 } }),
    call(9, 'missing', 'lsp', { operation: 'hover' }),
    result(10, 'missing', 'unstructured hover', { count: -1, total: 2 }),
  ])
  const rows = document.querySelectorAll('[data-slot="tool-card"]')
  for (const row of rows) await page.elementLocator(row).getByRole('button').click()
  expect(rows[0]!.textContent).toContain('No matches found')
  expect(rows[0]!.textContent).not.toMatch(/0 matches/)
  expect(rows[1]!.querySelector('.search-detail-empty')!.textContent).toBe('No output')
  expect(rows[2]!.querySelector('[data-search-detail]')).toBeNull()
  expect(rows[2]!.textContent).toContain('"pattern": "["')
  expect(rows[3]!.textContent).toContain('"enabled": false')
  expect(rows[3]!.textContent).toContain('"items": []')
  expect(rows[3]!.textContent).toContain('original output')
  expect(rows[4]!.querySelector('[data-lsp-count]')).toBeNull()
  expect(rows[4]!.textContent).toContain('unstructured hover')
  expect(document.querySelectorAll('[data-search-detail] a, [data-structured-detail] a')).toHaveLength(0)
})

it.each([
  ['light', 'en'],
  ['light', 'zh'],
  ['dark', 'en'],
  ['dark', 'zh'],
] as const)('actual App: %s/%s keeps long search and structured fields accessible at 390px', async (theme, locale) => {
  await page.viewport(390, 850)
  await open(
    [
      call(1, 'g', 'grep', { pattern: 'unchanged' }),
      result(2, 'g', '目录/'.repeat(60) + ':99: ' + 'original '.repeat(80)),
      call(3, 'l', 'lsp', { operation: 'hover', file_path: '目录/'.repeat(60) + 'request.ts', line: 5, character: 2 }),
      result(4, 'l', 'model '.repeat(80), { count: 1, total: 1 }),
    ],
    theme,
    locale,
  )
  const rows = document.querySelectorAll('[data-slot="tool-card"]')
  for (const row of rows) await page.elementLocator(row).getByRole('button').click()
  const search = rows[0]!.querySelector<HTMLElement>('.search-detail-body')!
  expect(search.scrollWidth).toBeGreaterThan(search.clientWidth)
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390)
  expect(rows[1]!.getBoundingClientRect().right).toBeLessThanOrEqual(390)
  const copy = page.elementLocator(rows[0]!).getByRole('button', { name: locale === 'en' ? 'Copy' : '复制', exact: true })
  copy.element().focus()
  await expect.element(copy).toHaveFocus()
  const raw = page.elementLocator(rows[1]!).getByText(locale === 'en' ? 'Input / output' : '输入 / 输出', { exact: true })
  raw.element().focus()
  await userEvent.keyboard('{Enter}')
  expect(rows[1]!.querySelector('.structured-original')!.getAttribute('open')).not.toBeNull()
  expect(rows[1]!.querySelector('.tool-io-card')!.textContent).toContain('"character": 2')
})

it('actual App: clipboard failure reports failure and leaves results and disclosure available', async () => {
  vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('clipboard unavailable'))
  await open([call(1, 'f', 'find', { pattern: '*.ts' }), result(2, 'f', 'src/original.ts')])
  await page.getByRole('button', { name: /Find files/ }).click()
  await page.getByRole('button', { name: 'Copy', exact: true }).click()
  await expect.element(page.getByText('Could not copy', { exact: true })).toBeVisible()
  expect(document.querySelector('[data-search-detail]')!.textContent).toContain('src/original.ts')
  expect(document.querySelector('[data-slot="tool-card"] button')!.getAttribute('aria-expanded')).toBe('true')
})
