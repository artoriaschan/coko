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
import { setBrowserScale } from '../../testing/browser-commands.ts'
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

it('actual App renders loaded Entry rows, Run disclosure, UTC milliseconds, untouched text and expandable complete JSON', async () => {
  const { panel, sent } = await open()
  const table = panel.getByRole('table', { name: 'Session diagnostics', exact: true })
  await expect.element(table).toBeVisible()
  expect([...table.element().querySelectorAll('th')].map((node) => node.textContent)).toEqual(['Sequence', 'Type', 'Run', 'Time (UTC)', 'Data'])
  await table.getByRole('columnheader', { name: 'Sequence', exact: true }).hover()
  await expect.element(page.getByRole('tooltip', { name: 'Sequence', exact: true })).toBeVisible()
  await expect.element(table.getByRole('cell', { name: 'message/user', exact: true })).toBeVisible()
  await expect.element(table.getByRole('cell', { name: '22:13:20.003', exact: true })).toBeVisible()
  await table.getByRole('button', { name: 'Inspect record 3', exact: true }).click()
  await expect.element(panel.getByRole('region', { name: 'Record details', exact: true })).toBeVisible()
  await expect.element(panel.getByText('user literal token and [REDACTED:secret]', { exact: false }).last()).toBeVisible()
  const details = panel.getByRole('region', { name: 'Record details', exact: true })
  await details.getByText('payload: {…}', { exact: true }).click()
  await expect.poll(() => details.element().textContent?.includes('user literal token and [REDACTED:secret]')).toBe(false)
  await details.getByText('payload: {…}', { exact: true }).click()
  await expect.poll(() => details.element().textContent?.includes('user literal token and [REDACTED:secret]')).toBe(true)
  expect(sent.filter((message) => message.type === 'subscribe')).toHaveLength(1)
  await table.getByRole('button', { name: 'Collapse run_start', exact: true }).click()
  await expect.element(table.getByRole('cell', { name: 'message/user', exact: true })).not.toBeInTheDocument()
  await table.getByRole('button', { name: 'Expand run_start', exact: true }).click()
  await expect.element(table.getByRole('cell', { name: 'message/user', exact: true })).toBeVisible()
})

it('actual App virtualizes long history, keeps sticky Run headers and pauses following after a manual fold or upward scroll', async () => {
  const source = [
    entry(1, 'run_start', { trigger: 'submit' }),
    ...Array.from({ length: 100 }, (_, index) => entry(index + 2, 'message', { role: 'user', content: `row ${index}`, timestamp: 0 })),
  ]
  const { panel, sendServer } = await open(source)
  const scroll = panel.element().querySelector<HTMLElement>('[data-slot="diagnostic-scroll"]')!
  const table = panel.getByRole('table')
  await expect.poll(() => scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight).toBeLessThanOrEqual(40)
  expect(table.element().querySelectorAll('tbody tr[data-record-key]').length).toBeLessThan(60)
  scroll.scrollTop = 900
  scroll.dispatchEvent(new Event('scroll', { bubbles: true }))
  await expect
    .poll(() => table.element().querySelector('tr[data-record-key="entry:1"]')?.getBoundingClientRect().top)
    .toBeCloseTo(scroll.getBoundingClientRect().top + 30, 0)
  const offset = scroll.scrollTop
  sendServer({ type: 'entry', sessionId: 's-1', entry: entry(102, 'message', { role: 'user', content: 'new row', timestamp: 0 }) })
  await expect.poll(() => panel.getByRole('status', { name: 'Current row count' }).element().textContent).toBe('102 rows')
  expect(scroll.scrollTop).toBe(offset)
  const header = table.element().querySelector<HTMLTableRowElement>('tr[data-record-key="entry:1"]')!
  const top = header.getBoundingClientRect().top
  await table.getByRole('button', { name: 'Collapse run_start', exact: true }).click()
  await expect.poll(() => table.element().querySelector('tr[data-record-key="entry:1"]')!.getBoundingClientRect().top).toBeCloseTo(top, 0)
  expect(table.element().querySelector('[data-diagnostic-fold-space]')).not.toBeNull()
  sendServer({ type: 'entry', sessionId: 's-1', entry: entry(103, 'message', { role: 'user', content: 'still folded', timestamp: 0 }) })
  await expect.poll(() => panel.getByRole('status', { name: 'Current row count' }).element().textContent).toBe('103 rows')
  await panel.getByRole('button', { name: 'Follow latest', exact: true }).click()
  await expect.poll(() => table.element().querySelector('[data-diagnostic-fold-space]')).toBeNull()
})

it('actual App keeps details height across rows, clamps keyboard resize, and isolates serialization failures from the table', async () => {
  const bad = entry(6, 'message', {
    role: 'toolResult',
    toolCallId: 'bad',
    toolName: 'custom',
    content: [],
    isError: false,
    timestamp: 0,
    details: {
      toJSON() {
        throw new Error('private serialization failure')
      },
    },
  })
  const { panel } = await open([...records, bad])
  const table = panel.getByRole('table')
  await table.getByRole('button', { name: 'Inspect record 3', exact: true }).click()
  const details = panel.getByRole('region', { name: 'Record details', exact: true })
  const separator = details.getByRole('separator', { name: 'Resize details', exact: true })
  expect(details.element().getBoundingClientRect().height / details.element().parentElement!.getBoundingClientRect().height).toBeCloseTo(0.4, 2)
  await userEvent.dragAndDrop(separator, table.getByRole('columnheader', { name: 'Type Filter types', exact: true }))
  await expect.element(separator).toHaveAttribute('aria-valuenow', '80')
  await separator.click()
  await userEvent.keyboard('{End}')
  await expect.element(separator).toHaveAttribute('aria-valuenow', '80')
  await table.getByRole('button', { name: 'Inspect record 1', exact: true }).click()
  await expect.element(separator).toHaveAttribute('aria-valuenow', '80')
  await separator.click()
  await userEvent.keyboard('{Home}{ArrowUp}')
  await expect.element(separator).toHaveAttribute('aria-valuenow', '20')
  await table.getByRole('button', { name: 'Inspect record 6', exact: true }).click()
  await expect.element(details.getByRole('alert')).toHaveTextContent('Could not serialize this record. Select another record to continue.')
  expect(details.element().textContent).not.toContain('private serialization failure')
  await table.getByRole('button', { name: 'Inspect record 3', exact: true }).click()
  await expect.element(details.getByRole('alert')).not.toBeInTheDocument()
})

it.each([
  { locale: 'en' as const, theme: 'light' as const },
  { locale: 'zh' as const, theme: 'dark' as const },
])('actual App: 390px $locale/$theme keeps controls reachable and overflow local, including archived readonly Sessions', async (options) => {
  const { panel } = await open(records, { ...options, width: 390, archived: true })
  const table = panel.getByRole('table')
  await expect.element(table).toBeVisible()
  await expect.element(panel.getByRole('button', { name: options.locale === 'zh' ? '跟踪最新' : 'Follow latest', exact: true })).toBeVisible()
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390)
  const scroll = panel.element().querySelector<HTMLElement>('[data-slot="diagnostic-scroll"]')!
  expect(scroll.scrollWidth).toBeGreaterThan(scroll.clientWidth)
  scroll.scrollLeft = scroll.scrollWidth
  await expect.poll(() => scroll.scrollLeft).toBeGreaterThan(0)
  expect(panel.element().querySelector('input,textarea,[contenteditable]')).toBeNull()
  await table.getByRole('button', { name: options.locale === 'zh' ? '筛选类型' : 'Filter types', exact: true }).click()
  const popup = page.getByRole('dialog', { name: options.locale === 'zh' ? '筛选类型' : 'Filter types', exact: true })
  await expect.element(page.getByRole('combobox', { name: options.locale === 'zh' ? '类型片段' : 'Type fragment', exact: true })).toHaveFocus()
  expect(popup.element().getBoundingClientRect().left).toBeGreaterThanOrEqual(0)
  expect(popup.element().getBoundingClientRect().right).toBeLessThanOrEqual(390)
  await page.getByRole('button', { name: options.locale === 'zh' ? '取消筛选' : 'Cancel filter', exact: true }).click()
})

it('actual App keeps a filter draft separate, confirms fragments and keyboard candidates, and retains forced-open dim context for new rows', async () => {
  const { panel, sendServer } = await open()
  const table = panel.getByRole('table')
  const trigger = table.getByRole('button', { name: 'Filter types', exact: true })
  await table.getByRole('button', { name: 'Inspect record 3', exact: true }).click()
  await table.getByRole('button', { name: 'Collapse run_start', exact: true }).click()
  await trigger.click()
  const input = page.getByRole('combobox', { name: 'Type fragment', exact: true })
  await expect.element(input).toHaveFocus()
  await input.fill('MESS')
  await expect.element(page.getByRole('option', { name: 'message/user', exact: true })).toBeVisible()
  await expect.element(table.getByRole('cell', { name: 'message/user', exact: true })).not.toBeInTheDocument()
  await userEvent.keyboard('{Escape}')
  await expect.element(trigger).toHaveFocus()
  await trigger.click()
  await expect.element(input).toHaveValue('')
  await input.fill(' **MESS** ')
  await userEvent.keyboard('{Enter}')
  await expect.element(panel.getByRole('status', { name: 'Current row count' })).toHaveTextContent('1 / 3')
  await expect.element(panel.getByRole('region', { name: 'Record details', exact: true })).not.toBeInTheDocument()
  await expect.element(table.getByRole('cell', { name: 'message/user', exact: true })).toBeVisible()
  const context = table.element().querySelector('[data-record-key="entry:1"]')!
  expect(context.getAttribute('data-diagnostic-context')).toBe('')
  await expect.element(table.getByRole('button', { name: 'Collapse run_start', exact: true })).toBeDisabled()
  sendServer({
    type: 'entry',
    sessionId: 's-1',
    entry: entry(6, 'message', { role: 'assistant', content: [{ type: 'text', text: 'new assistant' }], stopReason: 'stop', timestamp: 0 }),
  })
  await expect.element(panel.getByRole('status', { name: 'Current row count' })).toHaveTextContent('2 / 4')
  await trigger.click()
  await input.fill('assistant')
  await expect.element(page.getByRole('option', { name: 'message/assistant', exact: true })).toBeVisible()
  await userEvent.keyboard('{ArrowDown}{Enter}')
  await trigger.click()
  await expect.element(input).toHaveValue('message/assistant')
  await input.fill('run_end')
  await page.getByRole('button', { name: 'Cancel filter', exact: true }).click()
  await trigger.click()
  await expect.element(input).toHaveValue('message/assistant')
  await page.getByRole('button', { name: 'Clear draft', exact: true }).click()
  await page.getByRole('button', { name: 'Apply filter', exact: true }).click()
  await expect.element(panel.getByRole('status', { name: 'Current row count' })).toHaveTextContent('4 rows')
  await expect.element(table.getByRole('cell', { name: 'run_end', exact: true })).toBeVisible()
  await trigger.click()
  await input.fill('run_')
  await page.getByRole('option', { name: 'run_end', exact: true }).click()
  await expect.element(panel.getByRole('status', { name: 'Current row count' })).toHaveTextContent('1 / 4')
})

it('actual App anchors the editor through viewport changes, browser zoom and table scroll; outside/IME cancel and confirmation resets scroll and folding', async () => {
  const source = [
    entry(1, 'run_start', { trigger: 'submit' }),
    ...Array.from({ length: 100 }, (_, index) => entry(index + 2, 'message', { role: 'user', content: `row ${index}`, timestamp: 0 })),
  ]
  const { panel, sendServer } = await open(source)
  const table = panel.getByRole('table')
  const scroll = panel.element().querySelector<HTMLElement>('[data-slot="diagnostic-scroll"]')!
  await expect.poll(() => scroll.scrollTop).toBeGreaterThan(0)
  await table.getByRole('button', { name: 'Collapse run_start', exact: true }).click()
  expect(table.element().querySelector('[data-diagnostic-fold-space]')).not.toBeNull()
  const trigger = table.getByRole('button', { name: 'Filter types', exact: true })
  await trigger.click()
  const input = page.getByRole('combobox', { name: 'Type fragment', exact: true })
  const popup = page.getByRole('dialog', { name: 'Filter types', exact: true })
  await expect.element(input).toHaveFocus()
  const anchored = () => {
    const button = trigger.element().getBoundingClientRect()
    const content = popup.element().getBoundingClientRect()
    return (
      button.left >= content.left - 1 &&
      button.right <= content.right + 1 &&
      content.left >= 0 &&
      content.right <= window.innerWidth &&
      Math.abs(content.top - button.bottom - 6) < 2
    )
  }
  await expect.poll(anchored).toBe(true)
  expect(await setBrowserScale(1.25)).toBe(1.25)
  try {
    await expect.poll(anchored).toBe(true)
    await page.viewport(1100, 720)
    await expect.poll(anchored).toBe(true)
    scroll.scrollTop = 50
    scroll.dispatchEvent(new Event('scroll', { bubbles: true }))
    await expect.poll(anchored).toBe(true)
    await input.fill('message')
    input.element().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, isComposing: true }))
    await expect.element(popup).toBeVisible()
    await expect.element(panel.getByRole('status', { name: 'Current row count' })).toHaveTextContent('101 rows')
    await panel.getByRole('button', { name: 'Follow latest', exact: true }).click()
    await expect.element(popup).not.toBeInTheDocument()
    await trigger.click()
    await expect.element(input).toHaveValue('')
    await input.fill('message')
    await page.getByRole('button', { name: 'Apply filter', exact: true }).click()
    await expect.poll(() => scroll.scrollTop).toBe(0)
    expect(table.element().querySelector('[data-diagnostic-fold-space]')).toBeNull()
    await expect.element(panel.getByRole('status', { name: 'Current row count' })).toHaveTextContent('100 / 101')
    await trigger.click()
    await input.fill('run')
    await expect.element(page.getByRole('option', { name: 'run_start', exact: true })).toBeVisible()
    sendServer({ type: 'entry', sessionId: 's-1', entry: entry(102, 'run_end', { status: 'completed' }) })
    await expect.element(page.getByRole('option', { name: 'run_end', exact: true })).toBeVisible()
    await input.fill('no-such-type')
    await expect.element(page.getByRole('option')).not.toBeInTheDocument()
    await input.fill('run')
    await expect.element(page.getByRole('option', { name: 'run_start', exact: true })).toBeVisible()
    await userEvent.keyboard('{ArrowUp}{ArrowDown}{Enter}')
    await expect.element(panel.getByRole('status', { name: 'Current row count' })).toHaveTextContent('1 / 102')
    await trigger.click()
    await expect.element(input).toHaveValue('run_end')
    await userEvent.keyboard('{Escape}')
  } finally {
    await setBrowserScale(1)
  }
})
