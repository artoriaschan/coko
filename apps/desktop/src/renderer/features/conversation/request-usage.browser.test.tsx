import '../../styles.css'
import { expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import type { SessionEntryRecord } from '@coko/protocol'
import { App } from '../../app/app.tsx'
import { createAppearanceStore } from '../../app/appearance-store.ts'
import { createConnectionStore } from '../../app/connection-store.ts'
import { createPreferences } from '../../app/preferences.ts'
import { createSettingsPageStore } from '../../app/settings-page-store.ts'
import { createFixtureChat } from '../../testing/fixture-chat.ts'

const entry = (seq: number, kind: string, payload: unknown, runId: string | null): SessionEntryRecord => ({
  sessionId: 's-1',
  seq,
  kind,
  payload,
  payloadVersion: 1,
  runId,
  createdAt: 1_700_000_000_000 + seq,
})
const legacyUsage = {
  input: 70,
  output: 20,
  cacheRead: 30,
  cacheWrite: 0,
  totalTokens: 120,
  reasoning: 7,
  cacheWrite1h: 0,
  cost: { input: 0.1, output: 0.1, cacheRead: 0.1, cacheWrite: 0, total: 0.3 },
}
const reply = (seq: number, runId: string, usage = legacyUsage) =>
  entry(
    seq,
    'message',
    { role: 'assistant', content: [{ type: 'text', text: 'Reported answer' }], stopReason: 'stop', timestamp: 1, usage, provider: 'p', model: 'm' },
    runId,
  )
const request = (seq: number, runId: string, input: number, output: number, known: string[], complete: boolean) =>
  entry(
    seq,
    'model_request',
    {
      requestId: 'request-' + runId,
      runId,
      provider: 'p',
      model: 'm',
      purpose: 'turn',
      stopReason: 'stop',
      startedAt: 1,
      durationMs: 2,
      retries: 0,
      usage: { input, output, cacheRead: 0, cacheWrite: 0, total: input + output },
      usageReport: { known, complete },
      cost: 0.3,
    },
    runId,
  )
async function open(entries: SessionEntryRecord[]) {
  const fixture = createFixtureChat({ entries: { 's-1': entries } })
  const appearance = createAppearanceStore({ locale: 'en', theme: 'light' })
  const preferences = createPreferences({ appearance, settings: fixture.settings, onConflict() {}, onFailure() {} })
  await render(
    <div style={{ width: 1200, height: 900 }}>
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
  fixture.chat.getState().openSession('s-1')
  return fixture
}
const row = (runId: string) => document.querySelector(`[data-slot="assistant-footer"][data-run-id="${runId}"]`)!

it('actual App renders canonical usage once, accepts legacy extensions, and replay does not duplicate cost or tokens', async () => {
  const canonical = request(3, 'complete', 100, 20, ['input', 'output', 'cacheRead', 'cacheWrite'], true)
  const entries = [
    entry(1, 'run_start', { trigger: 'submit' }, 'complete'),
    reply(2, 'complete', { ...legacyUsage, input: 100, cacheRead: 0 }),
    canonical,
    entry(4, 'run_end', { status: 'completed' }, 'complete'),
    entry(5, 'run_start', { trigger: 'submit' }, 'legacy'),
    reply(6, 'legacy'),
    entry(7, 'run_end', { status: 'completed' }, 'legacy'),
    { ...reply(8, 'copied'), runId: null },
    reply(9, 'invalid', { ...legacyUsage, input: -1 }),
    entry(10, 'run_end', { status: 'completed' }, 'invalid'),
  ]
  const fixture = await open(entries)
  await expect.poll(() => row('complete')?.getAttribute('data-tokens')).toBe('120')
  expect(row('complete').textContent).toContain('120 tok')
  expect(row('complete').getAttribute('data-complete')).toBe('true')
  expect(row('legacy').textContent).toContain('120 tok')
  expect(row('legacy').getAttribute('data-complete')).toBe('false')
  expect(row('invalid').textContent).toContain('Usage unavailable')
  expect(row('invalid').textContent).not.toContain('0 tok')
  expect(document.querySelector('[data-slot="session-cost"]')).toBeNull()
  fixture.sendServer({ type: 'entry', sessionId: 's-1', entry: canonical })
  expect(row('complete').getAttribute('data-tokens')).toBe('120')
  expect(document.querySelector('[data-slot="session-cost"]')).toBeNull()
  const usage = row('legacy').querySelector<HTMLButtonElement>('button[data-action="run-usage"]')!
  usage.focus()
  await userEvent.click(usage)
  const details = page.getByRole('dialog', { name: 'Turn usage', exact: true })
  await expect.element(details).toBeVisible()
  expect(details.element().querySelector('[data-usage-part="reasoning"]')?.textContent).toContain('7')
  await userEvent.keyboard('{Escape}')
  await expect.element(details).not.toBeInTheDocument()
})

it('actual App distinguishes reported zero from missing and partial reports', async () => {
  const entries: SessionEntryRecord[] = []
  for (const [index, runId] of ['zero', 'unknown', 'partial'].entries()) {
    const start = index * 4 + 1
    entries.push(
      entry(start, 'run_start', { trigger: 'submit' }, runId),
      reply(start + 1, runId, runId === 'zero' ? { ...legacyUsage, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 } : legacyUsage),
      request(
        start + 2,
        runId,
        0,
        runId === 'partial' ? 9 : 0,
        runId === 'zero' ? ['input', 'output', 'cacheRead', 'cacheWrite'] : runId === 'partial' ? ['output', 'cacheRead', 'cacheWrite'] : [],
        runId === 'zero',
      ),
      entry(start + 3, 'run_end', { status: 'completed' }, runId),
    )
  }
  await open(entries)
  await expect.poll(() => row('zero')?.textContent).toContain('0 tok')
  expect(row('zero').getAttribute('data-complete')).toBe('true')
  expect(row('unknown').textContent).toContain('Usage unavailable')
  expect(row('unknown').textContent).not.toContain('0 tok')
  expect(row('unknown').getAttribute('data-complete')).toBe('false')
  expect(row('partial').textContent).toContain('9 tok')
  expect(row('partial').getAttribute('data-complete')).toBe('false')
})

it('actual App marks interrupted and unrecorded endings incomplete even when earlier requests reported fully', async () => {
  const fixture = await open([
    entry(1, 'run_start', { trigger: 'submit' }, 'interrupted'),
    reply(2, 'interrupted'),
    request(3, 'interrupted', 100, 20, ['input', 'output', 'cacheRead', 'cacheWrite'], true),
    entry(4, 'run_end', { status: 'interrupted' }, 'interrupted'),
    entry(5, 'run_start', { trigger: 'submit' }, 'unrecorded'),
    reply(6, 'unrecorded'),
    request(7, 'unrecorded', 100, 20, ['input', 'output', 'cacheRead', 'cacheWrite'], true),
  ])
  await expect.poll(() => row('interrupted')?.textContent).toContain('120 tok')
  expect(row('interrupted').getAttribute('data-complete')).toBe('false')
  const action = row('interrupted').querySelector<HTMLButtonElement>('button[data-action="run-usage"]')!
  action.focus()
  await userEvent.click(action)
  const details = page.getByRole('dialog', { name: 'Turn usage', exact: true })
  await expect.element(details).toBeVisible()
  expect(details.element().querySelector('dd[data-usage-part="input"]')?.textContent).toBe('≥ 100')
  expect(details.element().querySelector('dd[data-usage-part="cacheRead"]')).toBeNull()
  await userEvent.keyboard('{Escape}')
  await expect.element(details).not.toBeInTheDocument()
  fixture.sendServer({
    type: 'progress',
    sessionId: 's-1',
    runId: 'unrecorded',
    event: { type: 'run_end', status: 'error', error: { code: 'commit_failed', message: 'lease lost' } },
  })
  await expect.poll(() => row('unrecorded')?.textContent).toContain('120 tok')
  expect(row('unrecorded').getAttribute('data-complete')).toBe('false')
  expect(row('unrecorded').querySelector('time')).toBeNull()
})

it('actual App respects report metadata in message-only fallback instead of inventing reported buckets', async () => {
  const entries = [
    entry(1, 'run_start', { trigger: 'submit' }, 'unknown-fallback'),
    entry(
      2,
      'message',
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'Unknown fallback' }],
        stopReason: 'stop',
        timestamp: 1,
        usage: { ...legacyUsage, report: { known: [], complete: false } },
      },
      'unknown-fallback',
    ),
    entry(3, 'run_end', { status: 'interrupted' }, 'unknown-fallback'),
    entry(4, 'run_start', { trigger: 'submit' }, 'partial-fallback'),
    entry(
      5,
      'message',
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'Partial fallback' }],
        stopReason: 'stop',
        timestamp: 1,
        usage: { ...legacyUsage, input: 7, output: 99, totalTokens: 136, report: { known: ['input'], complete: false } },
      },
      'partial-fallback',
    ),
    entry(6, 'run_end', { status: 'interrupted' }, 'partial-fallback'),
    entry(7, 'run_start', { trigger: 'submit' }, 'zero-fallback'),
    entry(
      8,
      'message',
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'Measured zero' }],
        stopReason: 'stop',
        timestamp: 1,
        usage: {
          ...legacyUsage,
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          reasoning: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          report: { known: ['input', 'output', 'cacheRead', 'cacheWrite'], complete: true },
        },
      },
      'zero-fallback',
    ),
    entry(9, 'run_end', { status: 'completed' }, 'zero-fallback'),
    entry(10, 'run_start', { trigger: 'submit' }, 'legacy-zero-reasoning'),
    entry(
      11,
      'message',
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'Legacy optional zero' }],
        stopReason: 'stop',
        timestamp: 1,
        usage: { ...legacyUsage, reasoning: 0 },
      },
      'legacy-zero-reasoning',
    ),
    entry(12, 'run_end', { status: 'completed' }, 'legacy-zero-reasoning'),
  ]
  await open(entries)
  await expect.poll(() => row('unknown-fallback')?.textContent).toContain('Usage unavailable')
  expect(row('unknown-fallback').textContent).not.toContain('0 tok')
  expect(row('partial-fallback').textContent).toContain('7 tok')
  expect(row('partial-fallback').getAttribute('data-complete')).toBe('false')
  expect(row('zero-fallback').textContent).toContain('0 tok')
  expect(row('zero-fallback').getAttribute('data-complete')).toBe('true')
  const action = row('partial-fallback').querySelector<HTMLButtonElement>('button[data-action="run-usage"]')!
  action.focus()
  await userEvent.click(action)
  const details = page.getByRole('dialog', { name: 'Turn usage', exact: true })
  await expect.element(details).toBeVisible()
  expect(details.element().querySelector('[data-usage-part="total"]')?.textContent).toBe('7')
  expect(details.element().querySelector('dd[data-usage-part="output"]')?.textContent).toBe('—')
  expect(details.element().querySelector('dd[data-usage-part="cacheRead"]')).toBeNull()
  expect(details.element().querySelector('[data-usage-part="reasoning"]')).toBeNull()
  await userEvent.keyboard('{Escape}')
  await expect.element(details).not.toBeInTheDocument()
  for (const [runId, expected] of [
    ['zero-fallback', '0'],
    ['legacy-zero-reasoning', undefined],
  ] as const) {
    const usage = row(runId).querySelector<HTMLButtonElement>('button[data-action="run-usage"]')!
    usage.focus()
    await userEvent.click(usage)
    await expect.element(details).toBeVisible()
    const reasoning = details.element().querySelector('[data-usage-part="reasoning"]')
    expect(reasoning === null).toBe(expected === undefined)
    expect(reasoning?.textContent ?? '').toContain(expected ?? '')
    await userEvent.keyboard('{Escape}')
    await expect.element(details).not.toBeInTheDocument()
  }
})
