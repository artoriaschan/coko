import '../../styles.css'
import { expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { Value } from 'typebox/value'
import { sumUsage } from './session-cost.tsx'
import { SessionEntry, type SessionEntryRecord } from '@coko/protocol'
import { App } from '../../app/app.tsx'
import { createAppearanceStore } from '../../app/appearance-store.ts'
import { createConnectionStore } from '../../app/connection-store.ts'
import { createPreferences } from '../../app/preferences.ts'
import { createSettingsPageStore } from '../../app/settings-page-store.ts'
import { createFixtureChat } from '../../testing/fixture-chat.ts'

it('session costs include detached title usage exactly once while Run costs exclude it', async () => {
  const base = { sessionId: 's-1', payloadVersion: 1, createdAt: 1 }
  const usage = {
    input: 100,
    output: 50,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 150,
    cost: { input: 0.5, output: 0.5, cacheRead: 0, cacheWrite: 0, total: 1 },
  }
  const request = { provider: 'faux', model: 'faux-1', startedAt: 1, durationMs: 1, stopReason: 'stop', retries: 0 }
  const entries: SessionEntryRecord[] = [
    {
      ...base,
      seq: 1,
      kind: 'message',
      runId: 'run-1',
      payload: { role: 'assistant', content: [{ type: 'text', text: 'Done' }], provider: 'faux', model: 'faux-1', usage, timestamp: 1, stopReason: 'stop' },
    },
    {
      ...base,
      seq: 2,
      kind: 'model_request',
      runId: 'run-1',
      payload: { ...request, runId: 'run-1', purpose: 'turn', usage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, total: 150 }, cost: 1 },
    },
    {
      ...base,
      seq: 3,
      kind: 'model_request',
      runId: null,
      payload: { ...request, runId: null, purpose: 'title', usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, total: 15 }, cost: 0.25 },
    },
  ]
  const fixture = createFixtureChat({ entries: { 's-1': entries } })
  const store = createAppearanceStore({ locale: 'en', theme: 'light' })
  const preferences = createPreferences({ appearance: store, settings: fixture.settings, onConflict() {}, onFailure() {} })
  await render(
    <div style={{ width: 1200, height: 900 }}>
      <App
        store={store}
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
  const typed = entries.filter((entry): entry is SessionEntry => Value.Check(SessionEntry, entry))
  expect(sumUsage(typed, () => true, 'run-1').cost.total).toBe(1)
  const session = sumUsage(typed, () => true)
  expect(session.cost.total).toBe(1.25)
  expect(session.input + session.output + session.cacheRead + session.cacheWrite).toBe(165)
  expect(document.querySelector('[data-slot="session-cost"]')).toBeNull()
})
