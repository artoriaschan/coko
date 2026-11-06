import '../../styles.css'
import type { SessionEntryRecord } from '@coko/protocol'
import { afterEach, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { App } from '../../app/app.tsx'
import { createAppearanceStore } from '../../app/appearance-store.ts'
import { createConnectionStore } from '../../app/connection-store.ts'
import { createPreferences } from '../../app/preferences.ts'
import { createSettingsPageStore } from '../../app/settings-page-store.ts'
import { createFixtureChat } from '../../testing/fixture-chat.ts'
import text from '../../../../tests/fixtures/markdown-table.txt?raw'

afterEach(async () => {
  await page.viewport(1280, 800)
})

it.each(['light', 'dark'] as const)('actual App: %s table rows reflow after a narrow and wide window resize without empty vertical space', async (theme) => {
  await page.viewport(1600, 1000)
  const records: SessionEntryRecord[] = [
    {
      sessionId: 's-1',
      seq: 1,
      kind: 'message',
      payloadVersion: 1,
      runId: 'table-run',
      createdAt: 1,
      payload: { role: 'assistant', content: [{ type: 'text', text }], stopReason: 'stop', timestamp: 0 },
    },
  ]
  const fixture = createFixtureChat({ entries: { 's-1': records } })
  const appearance = createAppearanceStore({ theme, locale: 'zh' })
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
  await expect.poll(() => document.querySelectorAll('[data-streamdown="table-row"]').length).toBe(8)
  const table = document.querySelector<HTMLElement>('[data-streamdown="table"]')!
  const port = table.parentElement!
  const outer = document.querySelector<HTMLElement>('.conversation-message-scroll')!
  for (const width of [390, 1600, 900, 1280, 390, 1600]) {
    outer.scrollTop = outer.scrollHeight
    outer.dispatchEvent(new Event('scroll'))
    await expect.poll(() => table.getBoundingClientRect().bottom < outer.getBoundingClientRect().top).toBe(true)
    await page.viewport(width, 1000)
    outer.scrollTop = 0
    outer.dispatchEvent(new Event('scroll'))
    await expect
      .poll(() => {
        const rows = [...table.querySelectorAll('tr')]
        return rows.every((row) => {
          const ink = Math.max(
            ...[...row.cells].map((cell) => {
              const range = document.createRange()
              range.selectNodeContents(cell)
              return range.getBoundingClientRect().height
            }),
          )
          return row.getBoundingClientRect().height <= ink + 28
        })
      })
      .toBe(true)
    const rows = [...table.querySelectorAll('tr')]
    expect(port.scrollHeight - port.clientHeight).toBeLessThanOrEqual(1)
    expect(table.getBoundingClientRect().height).toBeLessThanOrEqual(rows.reduce((height, row) => height + row.getBoundingClientRect().height, 0) + 2)
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width)
    expect(table.textContent).toContain('ls')
  }
})
