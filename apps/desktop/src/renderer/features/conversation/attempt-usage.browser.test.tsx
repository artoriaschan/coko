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

it('actual App shows all actual attempts once and labels the subtotal incomplete after replay and reopening', async () => {
  const row = (seq: number, kind: string, payload: unknown, runId: string | null = 'attempt-run'): SessionEntryRecord => ({
    sessionId: 's-1',
    seq,
    kind,
    payload,
    payloadVersion: 1,
    runId,
    createdAt: 1_700_000_000_000 + seq,
  })
  const usage = { input: 20, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 25, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }
  const request = (seq: number, requestId: string, input: number, output: number, complete: boolean) =>
    row(seq, 'model_request', {
      runId: 'attempt-run',
      requestId,
      provider: 'p',
      model: 'm',
      startedAt: 1,
      durationMs: 1,
      retries: complete ? 1 : 0,
      purpose: 'turn',
      stopReason: complete ? 'stop' : 'error',
      usage: { input, output, cacheRead: 0, cacheWrite: 0, total: input + output },
      usageReport: { complete, known: ['input', 'output', 'cacheRead', 'cacheWrite'] },
      cost: 0,
    })
  const first = request(3, 'failed', 11, 3, false)
  const second = request(4, 'retried', 20, 5, true)
  const entries = [
    row(1, 'run_start', { trigger: 'submit' }),
    row(2, 'message', {
      role: 'assistant',
      content: [{ type: 'text', text: 'Recovered answer' }],
      stopReason: 'stop',
      timestamp: 1,
      provider: 'p',
      model: 'm',
      usage,
    }),
    first,
    second,
    row(5, 'run_end', { status: 'completed' }),
    row(
      6,
      'message',
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'Copied historical answer' }],
        stopReason: 'stop',
        timestamp: 1,
        usage: { ...usage, input: 999, totalTokens: 1004 },
      },
      null,
    ),
  ]
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
  await expect.element(page.getByText('39 tokens', { exact: true })).toBeVisible()
  await expect.element(page.getByText('Incomplete', { exact: true })).toBeVisible()
  expect(document.querySelector('[data-slot="session-cost"]')?.getAttribute('data-tokens')).toBe('39')
  fixture.sendServer({ type: 'entry', sessionId: 's-1', entry: first })
  fixture.sendServer({ type: 'entry', sessionId: 's-1', entry: second })
  expect(document.querySelector('[data-slot="session-cost"]')?.getAttribute('data-tokens')).toBe('39')
  fixture.chat.getState().openSession('s-3')
  fixture.chat.getState().openSession('s-1')
  await expect.element(page.getByText('39 tokens', { exact: true })).toBeVisible()
  expect(document.querySelector('[data-slot="session-cost"]')?.getAttribute('data-tokens')).toBe('39')
})

it('actual App keeps failed compaction usage visible when no assistant message exists', async () => {
  const row = (seq: number, kind: string, payload: unknown): SessionEntryRecord => ({
    sessionId: 's-1',
    seq,
    kind,
    payload,
    payloadVersion: 1,
    runId: 'compact-run',
    createdAt: 1_700_000_000_000 + seq,
  })
  const entries = [
    row(1, 'run_start', { trigger: 'compact' }),
    row(2, 'model_request', {
      runId: 'compact-run',
      requestId: 'failed-summary',
      provider: 'p',
      model: 'm',
      startedAt: 1,
      durationMs: 1,
      retries: 0,
      purpose: 'compaction',
      stopReason: 'error',
      usage: { input: 30, output: 7, cacheRead: 0, cacheWrite: 0, total: 37 },
      usageReport: { complete: false, known: ['input', 'output', 'cacheRead', 'cacheWrite'] },
      cost: 0,
    }),
    row(3, 'run_end', { status: 'error', error: { code: 'model_error', message: 'Summary failed' } }),
  ]
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
  await expect.element(page.getByText('37 tokens', { exact: true })).toBeVisible()
  await expect.element(page.getByText('Incomplete', { exact: true })).toBeVisible()
  expect(document.querySelectorAll('[data-slot="assistant-footer"]').length).toBe(1)
  expect(document.querySelector('[data-slot="run-usage"]')).toBeNull()
  expect(document.querySelector('[data-slot="assistant-footer"] [data-action="copy-message"]')).toBeNull()
})
