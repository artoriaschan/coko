import '../../styles.css'
import type { SessionEntryRecord } from '@coko/protocol'
import { expect, it, onTestFinished } from 'vitest'
import { render } from 'vitest-browser-react'
import { App } from '../../app/app.tsx'
import { createAppearanceStore } from '../../app/appearance-store.ts'
import { createConnectionStore } from '../../app/connection-store.ts'
import { createPreferences } from '../../app/preferences.ts'
import { createSettingsPageStore } from '../../app/settings-page-store.ts'
import { createFixtureChat } from '../../testing/fixture-chat.ts'

const markdown = '## Ready on first display\n\nA **formatted** reply.\n\n- First item\n- Second item'
const entries = (sessionId: string): SessionEntryRecord[] => [
  {
    sessionId,
    seq: 1,
    kind: 'message',
    payloadVersion: 1,
    runId: 'markdown-run',
    createdAt: 1,
    payload: { role: 'assistant', content: [{ type: 'text', text: markdown }], stopReason: 'stop', timestamp: 0 },
  },
]

it('actual App: initial history and switched sessions show formatted Markdown in their first committed body', async () => {
  const firstBodies: boolean[] = []
  const seen = new WeakSet<Element>()
  const observer = new MutationObserver(() => {
    for (const body of document.querySelectorAll('[data-slot="assistant-message-body"]')) {
      if (seen.has(body) || !body.textContent) continue
      seen.add(body)
      firstBodies.push(body.querySelector('.coko-markdown h2') !== null)
    }
  })
  observer.observe(document.body, { childList: true, subtree: true })
  onTestFinished(() => observer.disconnect())
  const fixture = createFixtureChat({ entries: { 's-1': entries('s-1'), 's-2': entries('s-2') } })
  const appearance = createAppearanceStore({ theme: 'light', locale: 'en' })
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
  await expect.poll(() => document.querySelector('.conversation-markdown h2')?.textContent).toBe('Ready on first display')
  expect(firstBodies).toEqual([true])
  const heading = document.querySelector<HTMLElement>('.conversation-markdown h2')!
  const paragraph = document.querySelector<HTMLElement>('.conversation-markdown p')!
  expect(parseFloat(getComputedStyle(heading).fontSize)).toBeGreaterThan(parseFloat(getComputedStyle(paragraph).fontSize))
  fixture.chat.getState().openSession('s-2')
  await expect.poll(() => fixture.chat.getState().conversations['s-2']?.status).toBe('ready')
  await expect.poll(() => firstBodies.length).toBe(2)
  expect(firstBodies).toEqual([true, true])
})
