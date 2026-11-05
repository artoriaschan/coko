import '../../styles.css'
import type { SessionEntryRecord } from '@coko/protocol'
import { expect, it, onTestFinished } from 'vitest'
import { setReducedMotion } from '../../testing/browser-commands.ts'
import { page } from 'vitest/browser'
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
  await panel.getByRole('button', { name: options.locale === 'zh' ? '会话数据诊断' : 'Session diagnostics', exact: true }).click()
  return { ...fixture, panel }
}

it('actual App grouping uses mounted process identities and runtime references with a root breadcrumb', async () => {
  const { panel } = await open([
    entry(1, 'run_start', { trigger: 'submit' }),
    entry(2, 'message', {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'reasoned' },
        { type: 'toolCall', id: 'read-a', name: 'read', arguments: { path: '/test.txt' } },
      ],
      stopReason: 'toolUse',
      timestamp: 0,
    }),
    entry(3, 'message', {
      role: 'toolResult',
      toolCallId: 'read-a',
      toolName: 'read',
      content: [{ type: 'text', text: 'result' }],
      isError: false,
      timestamp: 0,
    }),
    entry(4, 'message', { role: 'assistant', content: [{ type: 'text', text: 'Finished' }], stopReason: 'stop', timestamp: 0 }),
    entry(5, 'run_end', { status: 'completed' }),
  ])
  await panel.getByRole('button', { name: 'Display format', exact: true }).click()
  await page.getByRole('menuitemradio', { name: 'Conversation groups', exact: true }).click()
  const table = panel.getByRole('table')
  await expect.element(table.getByRole('button', { name: 'tool', exact: true })).toBeVisible()
  expect([...table.element().querySelectorAll('th')].map((node) => node.textContent)).toEqual(['Sequence', 'Type', 'Run', 'Data'])
  const group = table.element().querySelector<HTMLElement>('[data-record-key^="process:"]')!
  expect(document.querySelector('[data-slot="process-group"]')?.getAttribute('data-process-group-id')).toBe(group.dataset.recordKey)
  expect(document.querySelector('[data-tool-call-id="read-a"]')?.getAttribute('data-timeline-identity')).toBe('tool:read-a')
  await table.getByRole('button', { name: 'Inspect record tool:read-a', exact: true }).click()
  const details = panel.getByRole('region', { name: 'Record details', exact: true })
  await details.getByRole('button', { name: 'Process group · ' + group.dataset.recordKey, exact: true }).click()
  await expect.poll(() => details.getByRole('navigation', { name: 'Inspection path', exact: true }).element().textContent).toContain('tool:read-a')
  await details.getByRole('button', { name: 'Run · run-a', exact: true }).click()
  await details.getByRole('button', { name: 'Session Entry · 3', exact: true }).click()
  await details.getByText('payload: Object', { exact: true }).click()
  await expect.poll(() => details.element().textContent).toContain('toolResult')
  await details.getByRole('button', { name: 'tool:read-a', exact: true }).click()
  await expect.poll(() => details.element().textContent).toContain('call:')
})

it('actual App runtime details are lazy, getter-free, paged, cycle-aware and refreshed only on publication', async () => {
  let reads = 0,
    enumerations = 0
  const shared = { leaf: 'shared value' }
  const runtime: Record<string, unknown> = {
    list: Array.from({ length: 120 }, (_, index) => index),
    left: shared,
    right: shared,
    unreadable: new Proxy(
      {},
      {
        ownKeys() {
          throw new Error('private detail')
        },
      },
    ),
  }
  Object.defineProperty(runtime, 'secret', {
    enumerable: true,
    get() {
      reads++
      return 'must not execute'
    },
  })
  const inspected = new Proxy(runtime, {
    ownKeys(value) {
      enumerations++
      return Reflect.ownKeys(value)
    },
  })
  runtime.self = inspected
  const { panel, sendServer } = await open([
    entry(1, 'run_start', { trigger: 'submit' }),
    entry(2, 'message', {
      role: 'assistant',
      content: [{ type: 'toolCall', id: 'runtime', name: 'read', arguments: { path: '/test.txt', runtime: inspected } }],
      stopReason: 'toolUse',
      timestamp: 0,
    }),
  ])
  await panel.getByRole('button', { name: 'Display format', exact: true }).click()
  await page.getByRole('menuitemradio', { name: 'Conversation groups', exact: true }).click()
  await panel.getByRole('button', { name: 'Inspect record tool:runtime', exact: true }).click()
  const details = panel.getByRole('region', { name: 'Record details', exact: true })
  expect(enumerations).toBe(0)
  await details.getByText('call: Object', { exact: true }).click()
  await details.getByText('arguments: Object', { exact: true }).click()
  await details.getByText('runtime: Object', { exact: true }).click()
  await expect.poll(() => details.element().textContent).toContain('[Getter/Setter]')
  await expect.poll(() => details.element().textContent).toContain('↩ $.call.arguments.runtime')
  expect(reads).toBe(0)
  expect(enumerations).toBe(1)
  await details.getByText('unreadable: Object', { exact: true }).click()
  await expect.element(details.getByRole('alert')).toHaveTextContent('unreadable: Could not inspect this value')
  expect(details.element().textContent).not.toContain('private detail')
  await details.getByText('list: Array(120)', { exact: true }).click()
  await expect.poll(() => details.element().textContent).toContain('48: 48')
  expect(details.element().textContent).not.toContain('49: 49')
  await details.getByRole('button', { name: 'Show more', exact: true }).click()
  await expect.poll(() => details.element().textContent).toContain('98: 98')
  expect(details.element().textContent).not.toContain('99: 99')
  expect(enumerations).toBe(1)
  runtime.published = 'fresh publication'
  sendServer({ type: 'entry', sessionId: 's-1', entry: entry(3, 'message', { role: 'user', content: 'next input', timestamp: 0 }) })
  await expect.poll(() => details.element().textContent).toContain('fresh publication')
  expect(enumerations).toBe(2)
  expect(reads).toBe(0)
})

it('actual App keeps selected live identity and expanded fields on settlement, and highlights only changed projection rows', async () => {
  const { panel, sendServer } = await open([entry(1, 'run_start', { trigger: 'submit' })])
  sendServer({ type: 'progress', sessionId: 's-1', runId: 'run-a', event: { type: 'run_start' } })
  sendServer({ type: 'progress', sessionId: 's-1', runId: 'run-a', event: { type: 'assistant_delta', kind: 'text', contentIndex: 0, delta: 'live answer' } })
  await panel.getByRole('button', { name: 'Display format', exact: true }).click()
  await page.getByRole('menuitemradio', { name: 'Conversation groups', exact: true }).click()
  await panel.getByRole('button', { name: 'text', exact: true }).click()
  const table = panel.getByRole('table')
  const selected = table.element().querySelector<HTMLTableRowElement>('[aria-selected="true"]')!
  const identity = selected.dataset.recordKey!
  expect(document.querySelector('article[data-timeline-identity]')?.getAttribute('data-timeline-identity')).toBe(identity)
  const details = panel.getByRole('region', { name: 'Record details', exact: true })
  await details.getByText('source: Object', { exact: true }).click()
  sendServer({
    type: 'entry',
    sessionId: 's-1',
    entry: entry(2, 'message', { role: 'assistant', content: [{ type: 'text', text: 'live answer complete' }], stopReason: 'stop', timestamp: 0 }),
  })
  await expect.poll(() => selected.textContent).toContain('live answer complete')
  expect(table.element().querySelector('[aria-selected="true"]')).toBe(selected)
  await expect.poll(() => details.element().textContent).toContain('contentIndex: 0')
  expect(selected.dataset.diagnosticUpdated).toBe('true')
  await expect.poll(() => selected.dataset.diagnosticUpdated).toBeUndefined()
  sendServer({ type: 'entry', sessionId: 's-1', entry: entry(3, 'message', { role: 'user', content: 'unrelated new row', timestamp: 0 }) })
  await expect.element(table.getByRole('button', { name: 'user', exact: true })).toBeVisible()
  expect(selected.dataset.diagnosticUpdated).toBeUndefined()
})

it('actual App does not animate grouping updates under reduced motion', async () => {
  await setReducedMotion(true)
  onTestFinished(() => setReducedMotion(false))
  const { panel, sendServer } = await open([entry(1, 'run_start', { trigger: 'submit' })])
  await panel.getByRole('button', { name: 'Display format', exact: true }).click()
  await page.getByRole('menuitemradio', { name: 'Conversation groups', exact: true }).click()
  sendServer({ type: 'entry', sessionId: 's-1', entry: entry(2, 'message', { role: 'user', content: 'new input', timestamp: 0 }) })
  const table = panel.getByRole('table')
  await expect.element(table.getByRole('button', { name: 'user', exact: true })).toBeVisible()
  const row = table.element().querySelector<HTMLTableRowElement>('[data-record-key="2"]')!
  expect(row.hasAttribute('data-diagnostic-updated')).toBe(false)
  expect(row.getAnimations()).toHaveLength(0)
})

it('actual App omits null-rendered Plan and ending seats while preserving the real process boundaries', async () => {
  const { panel } = await open([
    entry(1, 'run_start', { trigger: 'submit' }),
    entry(2, 'message', {
      role: 'assistant',
      content: [{ type: 'toolCall', id: 'before', name: 'read', arguments: { path: '/a' } }],
      stopReason: 'toolUse',
      timestamp: 0,
    }),
    entry(3, 'plan', { planId: 'plan-a', revision: 1, markdown: '# Draft', status: 'proposed' }, null),
    entry(4, 'message', {
      role: 'assistant',
      content: [{ type: 'toolCall', id: 'after', name: 'read', arguments: { path: '/b' } }],
      stopReason: 'toolUse',
      timestamp: 0,
    }),
    entry(5, 'plan', { planId: 'plan-a', revision: 1, markdown: '# Draft', status: 'rejected', feedback: 'revise' }, null),
    entry(6, 'message', { role: 'assistant', content: [{ type: 'text', text: 'Final response' }], stopReason: 'stop', timestamp: 0 }),
    entry(7, 'run_end', { status: 'completed' }),
  ])
  await panel.getByRole('button', { name: 'Display format', exact: true }).click()
  await page.getByRole('menuitemradio', { name: 'Conversation groups', exact: true }).click()
  const table = panel.getByRole('table')
  await expect.element(table.getByRole('button', { name: 'plan', exact: true })).toBeVisible()
  expect(table.element().querySelectorAll('[data-record-key^="process:"]')).toHaveLength(2)
  expect(table.element().querySelector('[data-record-key="3"]')).toBeNull()
  expect(table.element().querySelector('[data-record-key="5"]')).not.toBeNull()
  expect(document.querySelector('[data-slot="plan-card"]')?.getAttribute('data-timeline-identity')).toBe('5')
  expect(table.element().querySelector('[data-record-key="usage:7"]')).toBeNull()
  expect(table.element().querySelectorAll('[data-record-key]')).toHaveLength(6)
})

it('actual App reference reveal clears only an excluded filter, opens parents and keeps the original breadcrumb', async () => {
  const { panel } = await open([
    entry(1, 'run_start', { trigger: 'submit' }),
    entry(2, 'message', {
      role: 'assistant',
      content: [{ type: 'toolCall', id: 'ref', name: 'read', arguments: { path: '/ref' } }],
      stopReason: 'toolUse',
      timestamp: 0,
    }),
  ])
  await panel.getByRole('button', { name: 'Display format', exact: true }).click()
  await page.getByRole('menuitemradio', { name: 'Conversation groups', exact: true }).click()
  const table = panel.getByRole('table')
  const filter = panel.getByRole('button', { name: 'Filter types', exact: true })
  const apply = async (query: string) => {
    await filter.click()
    await page.getByRole('combobox', { name: 'Type fragment', exact: true }).fill(query)
    await page.getByRole('button', { name: 'Apply filter', exact: true }).click()
  }
  await apply('process')
  await expect.element(table.getByRole('button', { name: 'tool', exact: true })).not.toBeInTheDocument()
  await table.getByRole('button', { name: 'process', exact: true }).click()
  const details = panel.getByRole('region', { name: 'Record details', exact: true })
  const root = details.getByRole('navigation', { name: 'Inspection path', exact: true }).element().textContent!
  await details.getByRole('button', { name: 'Timeline row · tool:ref', exact: true }).click()
  await expect.element(panel.getByRole('status', { name: 'Current row count' })).toHaveTextContent('2 rows')
  await expect.element(table.getByRole('button', { name: 'tool', exact: true })).toBeVisible()
  const revealed = table.element().querySelector<HTMLElement>('[data-record-key="tool:ref"]')!
  await expect.poll(() => revealed.getAnimations().some((animation) => animation.effect?.getTiming().duration === 700)).toBe(true)
  expect(table.element().querySelector('[aria-selected="true"]')?.getAttribute('data-record-key')).toBe(root)
  await table.getByRole('button', { name: 'Collapse process', exact: true }).click()
  await expect.element(table.getByRole('button', { name: 'tool', exact: true })).not.toBeInTheDocument()
  await details.getByRole('button', { name: 'Process group · ' + root, exact: true }).click()
  await details.getByRole('button', { name: 'Timeline row · tool:ref', exact: true }).click()
  await expect.element(table.getByRole('button', { name: 'tool', exact: true })).toBeVisible()
  await expect.element(table.getByRole('button', { name: 'Collapse process', exact: true })).toHaveAttribute('aria-expanded', 'true')
  await details.getByRole('button', { name: root, exact: true }).first().click()
  expect(details.getByRole('navigation', { name: 'Inspection path', exact: true }).element().querySelectorAll('button')).toHaveLength(1)
  await apply('tool')
  await table.getByRole('button', { name: 'tool', exact: true }).click()
  await details.getByRole('button', { name: 'Process group · ' + root, exact: true }).click()
  // A retained context row must not clear the confirmed filter.
  await expect.element(panel.getByRole('status', { name: 'Current row count' })).toHaveTextContent('1 / 2')
  expect(details.getByRole('navigation', { name: 'Inspection path', exact: true }).element().querySelector('button')?.textContent).toBe('tool:ref')
})

it('actual App reference reveal scrolls a virtualized member below its sticky ancestors', async () => {
  const { panel } = await open([
    entry(1, 'run_start', { trigger: 'submit' }),
    entry(2, 'message', {
      role: 'assistant',
      content: Array.from({ length: 80 }, (_, index) => ({ type: 'toolCall', id: `far-${index}`, name: 'read', arguments: { path: `/file-${index}` } })),
      stopReason: 'toolUse',
      timestamp: 0,
    }),
  ])
  await panel.getByRole('button', { name: 'Display format', exact: true }).click()
  await page.getByRole('menuitemradio', { name: 'Conversation groups', exact: true }).click()
  const table = panel.getByRole('table')
  await table.getByRole('button', { name: 'Collapse process', exact: true }).click()
  await table.getByRole('button', { name: 'process', exact: true }).click()
  const details = panel.getByRole('region', { name: 'Record details', exact: true })
  expect(table.element().querySelector('[data-record-key="tool:far-79"]')).toBeNull()
  await details.getByRole('button', { name: 'Timeline row · tool:far-79', exact: true }).click()
  const scroll = panel.element().querySelector<HTMLElement>('[data-slot="diagnostic-scroll"]')!
  await expect.poll(() => table.element().querySelector('[data-record-key="tool:far-79"]')).not.toBeNull()
  const row = table.element().querySelector<HTMLElement>('[data-record-key="tool:far-79"]')!
  await expect.poll(() => scroll.scrollTop).toBeGreaterThan(1000)
  await expect.poll(() => row.getBoundingClientRect().top - scroll.getBoundingClientRect().top).toBeGreaterThanOrEqual(59)
  expect(row.getBoundingClientRect().bottom).toBeLessThanOrEqual(scroll.getBoundingClientRect().bottom + 1)
  expect(table.element().querySelectorAll('[data-record-key]').length).toBeLessThan(60)
})
