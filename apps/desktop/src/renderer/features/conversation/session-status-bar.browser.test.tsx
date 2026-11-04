import '../../styles.css'
import type { SessionEntryRecord } from '@coko/protocol'
import { afterEach, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { App } from '../../app/app.tsx'
import { createAppearanceStore } from '../../app/appearance-store.ts'
import { createConnectionStore } from '../../app/connection-store.ts'
import { createPreferences } from '../../app/preferences.ts'
import { createSettingsPageStore } from '../../app/settings-page-store.ts'
import { createFixtureChat, fixtureSessions } from '../../testing/fixture-chat.ts'

const request = (seq: number, purpose = 'turn', extra = {}): SessionEntryRecord => ({
  sessionId: 's-1',
  seq,
  kind: 'model_request',
  payloadVersion: 1,
  runId: 'run-1',
  createdAt: seq,
  payload: {
    runId: 'run-1',
    requestId: `r-${seq}`,
    provider: 'p',
    model: 'm',
    startedAt: 1,
    durationMs: 100,
    retries: 0,
    purpose,
    stopReason: 'stop',
    usage: { input: 100, output: 200, cacheRead: 900, cacheWrite: 0, total: 1200 },
    usageReport: { complete: true, known: ['input', 'output', 'cacheRead', 'cacheWrite'] },
    cost: 0,
    ...extra,
  },
})
const viewport = { width: innerWidth, height: innerHeight }
afterEach(async () => {
  await page.viewport(viewport.width, viewport.height)
})
async function open(entries: SessionEntryRecord[], sessions = fixtureSessions) {
  const fixture = createFixtureChat({ entries: { 's-1': entries }, sessions })
  const appearance = createAppearanceStore({ locale: 'en', theme: 'light' })
  const preferences = createPreferences({ appearance, settings: fixture.settings, onConflict() {}, onFailure() {} })
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
it('actual App keeps a 22px status row and shows reported Session token usage in a keyboard-accessible card', async () => {
  await page.viewport(1000, 800)
  const fixture = await open([])
  const bar = document.querySelector<HTMLElement>('[data-slot=session-status-bar]')!
  expect(bar).not.toBeNull()
  expect(bar.getBoundingClientRect().height).toBe(22)
  const composer = document.querySelector<HTMLElement>('[data-slot=composer]')!
  const bottom = composer.getBoundingClientRect().bottom
  expect(bar.getBoundingClientRect().top - bottom).toBe(4)
  expect(bar.parentElement!.getBoundingClientRect().bottom - bottom).toBe(30)
  fixture.sendServer({ type: 'entry', sessionId: 's-1', entry: request(1) })
  const pill = page.getByRole('button', { name: 'Token usage: 1,200 tok · Cache hit 90%', exact: true })
  await expect.element(pill).toBeVisible()
  expect(composer.getBoundingClientRect().bottom).toBe(bottom)
  pill.element().focus()
  await userEvent.keyboard('{Enter}')
  const card = page.getByRole('dialog', { name: 'Token usage', exact: true })
  await expect.element(card).toBeVisible()
  expect(card.element().querySelector('[data-usage-part=total]')?.textContent).toBe('1,200')
  expect(card.element().textContent).not.toMatch(/Unpriced|\$/)
  await userEvent.keyboard('{Escape}')
  await expect.element(card).not.toBeInTheDocument()
  expect(document.activeElement).toBe(pill.element())
})

it('actual App sums committed main, compaction and title requests once, ignores streaming and retains a card at the viewport edge', async () => {
  await page.viewport(390, 700)
  const entries = [request(1), request(2, 'compaction'), request(3, 'title'), { ...request(4), kind: 'run_end', payload: { status: 'completed' } }]
  const fixture = await open(entries)
  const pill = page.getByRole('button', { name: 'Token usage: 3,600 tok · Cache hit 90%', exact: true })
  await expect.element(pill).toBeVisible()
  fixture.sendServer({
    type: 'progress',
    sessionId: 's-1',
    runId: 'run-1',
    event: { type: 'assistant_delta', kind: 'text', contentIndex: 0, delta: 'Still generating' },
  })
  fixture.sendServer({ type: 'entry', sessionId: 's-1', entry: entries[0]! })
  await pill.click()
  const card = page.getByRole('dialog', { name: 'Token usage', exact: true })
  await expect.element(card).toBeVisible()
  const box = card.element().getBoundingClientRect()
  expect(box.left).toBeGreaterThanOrEqual(0)
  expect(box.right).toBeLessThanOrEqual(390)
  expect(box.bottom).toBeLessThanOrEqual(700)
  expect(card.element().querySelector('[data-usage-part=total]')?.textContent).toBe('3,600')
  expect(card.element().textContent).not.toContain('Some requests')
  await page.getByRole('heading', { level: 1 }).click()
  await expect.element(card).not.toBeInTheDocument()
  expect(document.activeElement).toBe(pill.element())
  fixture.chat.getState().openSession('s-3')
  fixture.chat.getState().openSession('s-1')
  await expect.element(pill).toBeVisible()
})

it.each(['approval', 'confirmation', 'archived', 'removed'] as const)('actual App keeps the same status row through %s takeover', async (state) => {
  const fixture = await open([request(1)])
  const bar = document.querySelector('[data-slot=session-status-bar]')!
  if (state === 'archived') {
    await fixture.chat.getState().archiveSession('s-1')
    fixture.chat.getState().openSession('s-1')
  } else if (state === 'removed') {
    const list = fixture.chat.lists.getState()
    fixture.chat.lists.setState({
      sessions: list.sessions.map((session) =>
        session.id === 's-1' ? { ...session, worktree: { id: 'removed', name: 'removed', branch: 'coko/removed', status: 'removed' } } : session,
      ),
    })
  } else {
    if (state === 'approval') fixture.sendServer({ type: 'progress', sessionId: 's-1', runId: 'run-1', event: { type: 'run_start' } })
    fixture.sendServer({
      type: 'entry',
      sessionId: 's-1',
      entry: {
        ...request(2),
        kind: state === 'approval' ? 'approval_request' : 'confirmation_request',
        payload:
          state === 'approval'
            ? { requestId: 'req', toolCallId: 'call', toolName: 'custom', kind: 'tool', subject: 'protected', suggestions: [] }
            : { toolCallId: 'call' },
      },
    })
  }
  await expect.element(page.getByRole('button', { name: 'Token usage: 1,200 tok · Cache hit 90%', exact: true })).toBeVisible()
  expect(document.querySelector('[data-slot=session-status-bar]')).toBe(bar)
  expect(document.querySelector<HTMLElement>('[data-slot=composer]')!.checkVisibility()).toBe(false)
})

it('actual App marks missing buckets, omits cache rate without input and leaves the new conversation without a status row', async () => {
  await open([
    request(1, 'turn', { usage: { input: 0, output: 80, cacheRead: 0, cacheWrite: 0, total: 80 }, usageReport: { complete: false, known: ['output'] } }),
  ])
  const pill = page.getByRole('button', { name: 'Token usage: 80 tok', exact: true })
  await pill.click()
  await expect.element(page.getByText('Some requests did not report complete usage; counts below reflect what was reported.', { exact: true })).toBeVisible()
  await userEvent.keyboard('{Escape}')
  await page.getByRole('button', { name: 'New chat', exact: true }).click()
  expect(document.querySelector('[data-slot=session-status-bar]')).toBeNull()
})
