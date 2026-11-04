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

afterEach(async () => {
  vi.restoreAllMocks()
  await page.viewport(1280, 800)
})

const row = (seq: number, kind: string, payload: unknown, createdAt = 1_700_000_000_000 + seq): SessionEntryRecord => ({
  sessionId: 's-1',
  seq,
  kind,
  payload,
  runId: 'ended-run',
  createdAt,
  payloadVersion: 1,
})
const answer = (seq: number, text: string[], stopReason = 'stop') =>
  row(seq, 'message', {
    role: 'assistant',
    content: text.map((text) => ({ type: 'text', text })),
    stopReason,
    timestamp: 1,
  })
const request = (seq: number) =>
  row(seq, 'model_request', {
    runId: 'ended-run',
    requestId: `request-${seq}`,
    provider: 'p',
    model: 'm',
    purpose: 'turn',
    startedAt: 1,
    durationMs: 10,
    retries: 0,
    stopReason: 'aborted',
    usage: { input: 31, output: 7, cacheRead: 0, cacheWrite: 0, total: 38 },
    usageReport: { complete: false, known: ['input', 'output'] },
    cost: 0.5,
  })
async function open(entries: SessionEntryRecord[], theme: 'light' | 'dark' = 'light', locale: 'en' | 'zh' = 'en') {
  const fixture = createFixtureChat({ entries: { 's-1': entries } })
  const appearance = createAppearanceStore({ theme, locale })
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

it('stopped Run gets one footer after its status; copies only the last produced reply and keeps known partial usage', async () => {
  const clipboard = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
  const fixture = await open([
    row(1, 'run_start', { trigger: 'submit' }),
    answer(2, ['Earlier stage']),
    answer(3, ['**Partial**', 'last block'], 'aborted'),
    request(4),
    row(5, 'run_end', { status: 'aborted' }, Date.parse('2026-11-03T15:09:48Z')),
  ])
  await expect.poll(() => document.querySelectorAll('[data-slot="assistant-footer"]').length).toBe(1)
  const footer = document.querySelector('[data-slot="assistant-footer"]')!
  const status = document.querySelector('[data-run-status="aborted"]')!
  expect(status.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(footer.querySelector('time')?.getAttribute('datetime')).toBe('2026-11-03T15:09:48.000Z')
  expect(document.querySelector('[data-slot="run-usage"]')).toBeNull()
  expect(footer.querySelector('[data-action="fork"], [data-action="branch-reply"]')).toBeNull()
  expect(document.querySelectorAll('[data-action="copy-message"]').length).toBe(1)
  await page.getByRole('button', { name: 'Copy message', exact: true }).click()
  expect(clipboard).toHaveBeenCalledWith('**Partial**\n\nlast block')
  await page.getByRole('button', { name: 'Usage for this run', exact: true }).click()
  const card = page.getByRole('dialog', { name: 'Run usage details', exact: true })
  await expect.element(card).toBeVisible()
  expect(card.element().querySelector('[data-usage-part="total"]')?.textContent).toBe('Reported subtotal38')
  expect(card.element().textContent).toContain('Some requests did not report complete usage')
  expect(card.element().textContent).not.toMatch(/\$|Cost|Unpriced/)
  await userEvent.keyboard('{Escape}')
  await expect.element(card).not.toBeInTheDocument()
  fixture.chat.getState().openSession('s-3')
  fixture.chat.getState().openSession('s-1')
  await expect.poll(() => document.querySelectorAll('[data-slot="assistant-footer"]').length).toBe(1)
  expect(document.querySelector('[data-slot="assistant-footer"] time')?.getAttribute('datetime')).toBe('2026-11-03T15:09:48.000Z')
  expect(document.querySelector('[data-slot="assistant-footer"]')?.textContent).toContain('38 tokens')
})

it('failure before any reply or usage keeps an unknown usage entry, no fake zero or copy, and its retry action', async () => {
  await open([
    row(1, 'run_start', { trigger: 'submit' }),
    row(2, 'run_end', { status: 'error', error: { code: 'model_error', message: 'Disconnected before usage' } }),
  ])
  await expect.poll(() => document.querySelectorAll('[data-slot="assistant-footer"]').length).toBe(1)
  const footer = document.querySelector('[data-slot="assistant-footer"]')!
  expect(footer.textContent).toContain('Usage unavailable')
  expect(footer.textContent).not.toMatch(/0 tokens|\$|Unpriced/)
  expect(footer.querySelector('[data-action="copy-message"]')).toBeNull()
  await expect.element(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Usage for this run', exact: true }).click()
  const card = page.getByRole('dialog', { name: 'Run usage details', exact: true })
  await expect.element(card).toBeVisible()
  expect(card.element().querySelector('[data-usage-part="total"] dd')?.textContent).toBe('—')
  await userEvent.keyboard('{Escape}')
  await expect.element(card).not.toBeInTheDocument()
})

it('an unrecorded ending preserves reported usage without inventing a termination time or a retry', async () => {
  const fixture = await open([row(1, 'run_start', { trigger: 'submit' }), answer(2, ['Partial body'], 'aborted'), request(3)])
  fixture.sendServer({
    type: 'progress',
    sessionId: 's-1',
    runId: 'ended-run',
    event: { type: 'run_end', status: 'error', error: { code: 'commit_failed', message: 'lease lost' } },
  })
  await expect.poll(() => document.querySelectorAll('[data-slot="assistant-footer"]').length).toBe(1)
  expect(document.querySelector('[data-slot="assistant-footer"] time')).toBeNull()
  expect(document.querySelector('[data-slot="assistant-footer"]')?.textContent).toContain('38 tokens')
  expect(document.querySelector('[data-run-status="error"]')?.textContent).toContain('lease lost')
  expect(page.getByRole('button', { name: 'Retry', exact: true }).elements().length).toBe(0)
})

it('an empty successful Run with explicitly reported zero keeps real zero separate from unavailable statistics', async () => {
  const measured = request(2)
  await open([
    row(1, 'run_start', { trigger: 'submit' }),
    {
      ...measured,
      payload: {
        ...(measured.payload as Record<string, unknown>),
        stopReason: 'stop',
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        usageReport: { complete: true, known: ['input', 'output', 'cacheRead', 'cacheWrite'] },
      },
    },
    row(3, 'run_end', { status: 'completed' }),
  ])
  await expect.poll(() => document.querySelectorAll('[data-slot="assistant-footer"]').length).toBe(1)
  const footer = document.querySelector('[data-slot="assistant-footer"]')!
  expect(footer.textContent).toContain('0 tokens')
  expect(footer.textContent).not.toMatch(/Incomplete|Usage unavailable/)
  expect(footer.querySelector('[data-action="copy-message"], [data-action="branch-reply"]')).toBeNull()
  await page.getByRole('button', { name: 'Usage for this run', exact: true }).click()
  const card = page.getByRole('dialog', { name: 'Run usage details', exact: true })
  await expect.element(card).toBeVisible()
  expect(card.element().querySelector('[data-usage-part="total"]')?.textContent).toBe('Total0')
  await userEvent.keyboard('{Escape}')
  await expect.element(card).not.toBeInTheDocument()
})

it('stage text followed by an empty failed assistant message has one copy action for the actual produced text', async () => {
  const clipboard = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
  await open([
    row(1, 'run_start', { trigger: 'submit' }),
    answer(2, ['**Produced stage**']),
    answer(3, [], 'error'),
    row(4, 'run_end', { status: 'error', error: { code: 'model_error', message: 'Tool cycle failed' } }),
  ])
  await expect.poll(() => document.querySelectorAll('[data-slot="assistant-footer"]').length).toBe(1)
  expect(document.querySelectorAll('[data-action="copy-message"]').length).toBe(1)
  await page.getByRole('button', { name: 'Copy message', exact: true }).click()
  expect(clipboard).toHaveBeenCalledWith('**Produced stage**')
})

it('interruption keeps Outcome Confirmation available and never displays recovery time as execution end time', async () => {
  await open([
    row(1, 'run_start', { trigger: 'submit' }),
    row(2, 'message', {
      role: 'assistant',
      timestamp: 1,
      stopReason: 'toolUse',
      content: [{ type: 'toolCall', id: 'uncertain', name: 'bash', arguments: { command: 'perform side effect' } }],
    }),
    row(3, 'confirmation_request', { toolCallId: 'uncertain' }),
    row(4, 'run_end', { status: 'interrupted' }, Date.parse('2026-11-04T08:00:00Z')),
  ])
  await expect.poll(() => document.querySelectorAll('[data-slot="assistant-footer"]').length).toBe(1)
  expect(document.querySelector('[data-slot="assistant-footer"] time')).toBeNull()
  expect(document.querySelector('[data-run-status="interrupted"]')).not.toBeNull()
  await expect.element(page.getByRole('button', { name: 'It took effect', exact: true })).toBeVisible()
  await expect.element(page.getByRole('button', { name: 'It did not take effect', exact: true })).toBeVisible()
  expect(document.querySelector('[data-slot="assistant-footer"] [data-action="copy-message"]')).toBeNull()
})

it('a paused Run remains paused with its genuine ending time and cannot become a successful branch', async () => {
  await open([row(1, 'run_start', { trigger: 'submit' }), answer(2, ['Before pausing']), row(3, 'run_end', { status: 'paused' })])
  await expect.poll(() => document.querySelectorAll('[data-slot="assistant-footer"]').length).toBe(1)
  expect(document.querySelector('[data-run-status="paused"]')).not.toBeNull()
  expect(document.querySelector('[data-slot="assistant-footer"] time')?.getAttribute('datetime')).toBe('2023-11-14T22:13:20.003Z')
  expect(document.querySelector('[data-slot="assistant-footer"] [data-action="branch-reply"]')).toBeNull()
})

it.each([
  ['light', 'en'],
  ['dark', 'en'],
  ['light', 'zh'],
  ['dark', 'zh'],
] as const)('%s/%s: no-body failure usage remains keyboard-accessible at 390px', async (theme, locale) => {
  await page.viewport(390, 900)
  await open(
    [row(1, 'run_start', { trigger: 'submit' }), row(2, 'run_end', { status: 'error', error: { code: 'model_error', message: 'Failed without statistics' } })],
    theme,
    locale,
  )
  const trigger = page.getByRole('button', { name: locale === 'en' ? 'Usage for this run' : '本次运行用量', exact: true })
  await expect.element(trigger).toBeVisible()
  trigger.element().focus()
  await userEvent.keyboard('{Enter}')
  const card = page.getByRole('dialog', { name: locale === 'en' ? 'Run usage details' : '本轮用量详情', exact: true })
  await expect.element(card).toBeVisible()
  expect(card.element().querySelector('[data-usage-part="total"] dd')?.textContent).toBe('—')
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
  const bounds = card.element().getBoundingClientRect()
  expect(bounds.left).toBeGreaterThanOrEqual(0)
  expect(bounds.right).toBeLessThanOrEqual(window.innerWidth)
  await userEvent.keyboard('{Escape}')
  await expect.element(card).not.toBeInTheDocument()
  expect(document.activeElement).toBe(trigger.element())
  await userEvent.keyboard('{Tab}')
  expect(document.activeElement).toBe(document.querySelector('[data-slot="assistant-footer"] time'))
})
