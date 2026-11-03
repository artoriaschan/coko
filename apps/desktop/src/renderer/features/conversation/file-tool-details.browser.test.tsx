import '../../styles.css'
import type { SessionEntryRecord } from '@coko/protocol'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
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

it('actual App: read keeps actual offset, raw copy and recovery locator; eight-line preview expands with keyboard', async () => {
  await open([
    call(1, 'read', 'read', { path: 'src/原文.ts', offset: 21, limit: 12 }),
    result(2, 'read', 'one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nten\neleven\ntwelve\n\n[5 more lines in file. Use offset=33 to continue.]'),
  ])
  await page.getByRole('button', { name: /Read/ }).click()
  const card = document.querySelector('[data-file-detail="read"]')!
  expect(card).not.toBeNull()
  expect(card.textContent).toContain('21')
  expect(card.textContent).toContain('32')
  expect(card.textContent).not.toContain('five')
  expect(card.textContent).toContain('Use offset=33 to continue.')
  const expand = page.getByRole('button', { name: 'Show all 12 lines' })
  expand.element().focus()
  await userEvent.keyboard('{Enter}')
  expect(card.textContent).toContain('five')
  await expect.element(page.getByRole('button', { name: 'Copy' })).toBeVisible()
})

it('actual App: write shows original content including empty files; copy has no line numbers and failure remains inspectable', async () => {
  const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
  await open([
    call(1, 'w', 'write', { path: 'new.txt', content: '  original\n原文' }),
    result(2, 'w', 'Successfully wrote to new.txt'),
    call(3, 'empty', 'write', { path: 'empty.txt', content: '' }),
    result(4, 'empty', 'Successfully wrote to empty.txt'),
    call(5, 'failed', 'write', { path: '/unwritable', content: 'never applied' }),
    result(6, 'failed', 'Permission denied', true),
  ])
  const rows = document.querySelectorAll('[data-tool="write"]')
  for (const row of rows) await page.elementLocator(row).getByRole('button').click()
  await page.elementLocator(rows[0]!).getByRole('button', { name: 'Copy', exact: true }).click()
  expect(copy).toHaveBeenCalledWith('  original\n原文')
  expect(rows[1]!.textContent).toContain('Empty file')
  expect(rows[2]!.querySelector('[data-file-detail]')).toBeNull()
  expect(rows[2]!.textContent).toContain('never applied')
  expect(rows[2]!.textContent).toContain('Permission denied')
})

it('actual App: edit preserves actual multi-hunk numbered diff and counts; missing diff keeps full arguments and details', async () => {
  const diff = ' 1 keep\n-2 old\n+2 new\n 3 keep\n 4 keep\n 5 keep\n 6 keep\n 7 keep\n 8 keep\n-9 gone\n+9 final'
  await open([
    call(1, 'e', 'edit', {
      path: 'a.ts',
      edits: [
        { oldText: 'old', newText: 'new' },
        { oldText: 'gone', newText: 'final' },
      ],
    }),
    {
      ...result(2, 'e', 'Successfully replaced 2 block(s) in a.ts.'),
      payload: { ...(result(2, 'e', '').payload as object), details: { diff, patch: '@@ real patch @@' } },
    },
    call(3, 'missing', 'edit', { path: 'b.ts', edits: [{ oldText: 'before', newText: 'after' }] }),
    { ...result(4, 'missing', 'Legacy receipt'), payload: { ...(result(4, 'missing', 'Legacy receipt').payload as object), details: { receipt: 'kept' } } },
  ])
  const rows = document.querySelectorAll('[data-tool="edit"]')
  for (const row of rows) await page.elementLocator(row).getByRole('button').click()
  expect(rows[0]!.textContent).toContain('+2')
  expect(rows[0]!.textContent).toContain('−2')
  expect(rows[0]!.textContent).toContain('+9 final')
  expect(rows[0]!.textContent).not.toContain(' 5 keep')
  await page.getByRole('button', { name: 'Show all 11 lines' }).click()
  expect(rows[0]!.textContent).toContain(' 5 keep')
  expect(rows[1]!.querySelector('[data-file-detail]')).toBeNull()
  expect(rows[1]!.textContent).toContain('before')
  expect(rows[1]!.textContent).toContain('after')
  expect(rows[1]!.textContent).toContain('kept')
})

it.each(['light', 'dark'] as const)('actual App: %s file details keep long paths, local scrolling and keyboard actions at 390px', async (theme) => {
  await page.viewport(390, 800)
  await open([call(1, 'r', 'read', { path: '目录/'.repeat(20) + 'long.ts' }), result(2, 'r', 'const unchanged = "' + 'x'.repeat(250) + '";')], theme)
  await page.getByRole('button', { name: /Read/ }).click()
  const card = document.querySelector<HTMLElement>('[data-file-detail]')!
  const code = card.querySelector<HTMLElement>('[role="region"]')!
  expect(card.getBoundingClientRect().right).toBeLessThanOrEqual(390)
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390)
  expect(code.scrollWidth).toBeGreaterThan(code.clientWidth)
  const wrap = page.getByRole('button', { name: 'Wrap lines' })
  wrap.element().focus()
  await userEvent.keyboard('{Enter}')
  expect(code.scrollWidth).toBeLessThanOrEqual(code.clientWidth)
  expect(getComputedStyle(card).backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
})

it('actual App: a settled live read keeps its disclosure, selection and scrolling when persisted', async () => {
  const fixture = await open([])
  const args = { path: 'live.txt' }
  const value = { content: [{ type: 'text' as const, text: 'a very long original line '.repeat(50) }], isError: false }
  fixture.sendServer({ type: 'progress', sessionId: 's-1', runId: 'run-1', event: { type: 'tool_start', toolCallId: 'live', toolName: 'read', args } })
  fixture.sendServer({
    type: 'progress',
    sessionId: 's-1',
    runId: 'run-1',
    event: { type: 'tool_end', toolCallId: 'live', toolName: 'read', result: value, isError: false },
  })
  await page.getByRole('button', { name: /Read/ }).click()
  const body = document.querySelector('[data-slot="tool-card-body"]')!
  const code = body.querySelector<HTMLElement>('[role="region"]')!
  const text = code.querySelector('[data-user-content]')!
  const range = document.createRange()
  range.selectNodeContents(text)
  window.getSelection()!.removeAllRanges()
  window.getSelection()!.addRange(range)
  const selected = window.getSelection()!.toString()
  code.scrollLeft = 100
  fixture.sendServer({ type: 'entry', sessionId: 's-1', entry: call(1, 'live', 'read', args) })
  fixture.sendServer({ type: 'entry', sessionId: 's-1', entry: result(2, 'live', value.content[0]!.text) })
  await expect.poll(() => fixture.chat.getState().conversations['s-1']?.entries.length).toBe(2)
  expect(document.querySelector('[data-slot="tool-card-body"]')).toBe(body)
  expect(window.getSelection()!.toString()).toBe(selected)
  expect(code.scrollLeft).toBe(100)
})

it.each(['light', 'dark'] as const)(
  'actual App: %s known file suffixes supply reference syntax and mutation language labels without inventing file facts',
  async (theme) => {
    const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
    await open(
      [
        call(1, 'known', 'read', { path: 'src/original.TS' }),
        result(2, 'known', 'export const greeting = "original";'),
        call(3, 'unknown', 'read', { path: 'README.unknown' }),
        result(4, 'unknown', 'unclassified original'),
        call(5, 'mutation', 'edit', { path: 'src/original.ts', edits: [{ oldText: 'old', newText: 'new' }] }),
        { ...result(6, 'mutation', 'Recorded edit'), payload: { ...(result(6, 'mutation', '').payload as object), details: { diff: '-1 old\n+1 new' } } },
      ],
      theme,
    )
    const rows = document.querySelectorAll('[data-slot="tool-card"]')
    for (const row of rows) await page.elementLocator(row).getByRole('button').click()
    expect(rows[0]!.querySelector('.file-detail-language')!.textContent).toBe('ts')
    await expect.poll(() => rows[0]!.querySelectorAll('[data-file-token]').length).toBeGreaterThan(1)
    const keyword = [...rows[0]!.querySelectorAll<HTMLElement>('[data-file-token]')].find((token) => token.textContent === 'export')!
    expect(getComputedStyle(keyword).color).toBe(theme === 'light' ? 'rgb(214, 51, 108)' : 'rgb(250, 162, 193)')
    expect(getComputedStyle(rows[0]!.querySelector('.file-detail-code')!).fontFamily.startsWith('"SF Mono"')).toBe(true)
    expect(rows[0]!.querySelector('.file-detail-code [data-user-content]')!.textContent).toBe('export const greeting = "original";')
    await page.elementLocator(rows[0]!).getByRole('button', { name: 'Copy', exact: true }).click()
    expect(copy).toHaveBeenCalledWith('export const greeting = "original";')
    expect(rows[1]!.querySelector('.file-detail-language')!.textContent).toBe('code')
    expect(rows[1]!.querySelector('[data-file-token]')).toBeNull()
    expect(rows[2]!.querySelector('.file-detail-language')!.textContent).toBe('typescript')
    // The actual numbered diff is retained; a suffix is no basis for reconstructing a whole file.
    expect(rows[2]!.querySelector('.file-detail-code')!.textContent).toBe('-1 old+1 new')
  },
)

it('actual App: selecting the initial read text survives lazy syntax coloring and committed settlement without remounting its body', async () => {
  const fixture = await open([entry(1, 'run_start', { trigger: 'submit' })])
  fixture.sendServer({ type: 'progress', sessionId: 's-1', runId: 'run-1', event: { type: 'run_start' } })
  const args = { path: 'original.py' }
  const raw = 'def original(value):\n    return "original"\n' + 'long_original_value = 1234567890; '.repeat(40)
  fixture.sendServer({ type: 'progress', sessionId: 's-1', runId: 'run-1', event: { type: 'tool_start', toolCallId: 'lazy', toolName: 'read', args } })
  await page.getByRole('button', { name: /Read/ }).click()
  let initialCode: HTMLElement | null = null
  let selectedBeforeColoring = false
  // Act on the actual plain-text DOM before the asynchronous grammar finishes;
  // the model boundary is controlled, the highlighter and DOM are real.
  const observer = new MutationObserver(() => {
    if (initialCode) return
    const code = document.querySelector<HTMLElement>('.file-detail-code')
    const source = code?.querySelector('[data-user-content]')
    if (!code || !source) return
    initialCode = code
    selectedBeforeColoring = code.querySelector('[data-file-token]') === null
    const range = document.createRange()
    range.selectNodeContents(source)
    getSelection()!.removeAllRanges()
    getSelection()!.addRange(range)
    code.scrollLeft = 100
  })
  observer.observe(document.body, { childList: true, subtree: true })
  try {
    fixture.sendServer({
      type: 'progress',
      sessionId: 's-1',
      runId: 'run-1',
      event: { type: 'tool_end', toolCallId: 'lazy', toolName: 'read', result: { content: [{ type: 'text', text: raw }] }, isError: false },
    })
    await expect.poll(() => document.querySelectorAll('[data-file-token]').length).toBeGreaterThan(1)
    expect(selectedBeforeColoring).toBe(true)
    expect(getSelection()!.toString()).toBe('def original(value):')
    const body = document.querySelector('[data-slot="tool-card-body"]')!
    fixture.sendServer({ type: 'entry', sessionId: 's-1', entry: call(2, 'lazy', 'read', args) })
    fixture.sendServer({ type: 'entry', sessionId: 's-1', entry: result(3, 'lazy', raw) })
    await expect.poll(() => fixture.chat.getState().conversations['s-1']?.entries.length).toBe(3)
    expect(document.querySelector('[data-slot="tool-card-body"]')).toBe(body)
    expect(document.querySelector('.file-detail-code')).toBe(initialCode)
    expect(getSelection()!.toString()).toBe('def original(value):')
    expect(document.querySelector<HTMLElement>('.file-detail-code')!.scrollLeft).toBe(100)
  } finally {
    observer.disconnect()
  }
})
