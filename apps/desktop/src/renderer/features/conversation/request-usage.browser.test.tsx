import '../../styles.css'
import { expect, it } from 'vitest'
import { page } from 'vitest/browser'
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
    reply(2, 'complete'),
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
  expect(row('complete').textContent).toContain('120 tokens')
  expect(row('complete').textContent).not.toContain('Incomplete')
  expect(row('legacy').textContent).toContain('120 tokens')
  expect(row('legacy').textContent).toContain('Incomplete')
  expect(row('invalid').textContent).toContain('Usage unavailable')
  expect(row('invalid').textContent).not.toContain('0 tokens')
  await expect.element(page.getByRole('button', { name: 'Session cost: $0.60' })).toBeVisible()
  expect(document.querySelector('[data-slot="session-cost"]')?.getAttribute('data-tokens')).toBe('240')
  fixture.sendServer({ type: 'entry', sessionId: 's-1', entry: canonical })
  expect(row('complete').getAttribute('data-tokens')).toBe('120')
  expect(document.querySelector('[data-slot="session-cost"]')?.getAttribute('data-tokens')).toBe('240')
})

it('actual App distinguishes reported zero from missing and partial reports', async () => {
  const entries: SessionEntryRecord[] = []
  for (const [index, runId] of ['zero', 'unknown', 'partial'].entries()) {
    const start = index * 4 + 1
    entries.push(
      entry(start, 'run_start', { trigger: 'submit' }, runId),
      reply(start + 1, runId),
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
  await expect.poll(() => row('zero')?.textContent).toContain('0 tokens')
  expect(row('zero').textContent).not.toContain('Incomplete')
  expect(row('unknown').textContent).toContain('Usage unavailable')
  expect(row('unknown').textContent).not.toContain('0 tokens')
  expect(row('unknown').textContent).toContain('Incomplete')
  expect(row('partial').textContent).toContain('9 tokens')
  expect(row('partial').textContent).toContain('Incomplete')
})
