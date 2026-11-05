import '../../styles.css'
import { afterEach, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { App } from '../../app/app.tsx'
import { createAppearanceStore } from '../../app/appearance-store.ts'
import { createConnectionStore } from '../../app/connection-store.ts'
import { createPreferences } from '../../app/preferences.ts'
import { createSettingsPageStore } from '../../app/settings-page-store.ts'
import { createTraceStore, type TraceBackend, type SessionExportFile } from '../../stores/trace-store.ts'
import { createFixtureChat, fixtureSessions } from '../../testing/fixture-chat.ts'
import { TraceStoreProvider } from '../right-panel/trace-tab.tsx'
import { toast } from '@coko/ui'

const viewport = { width: innerWidth, height: innerHeight }
afterEach(async () => {
  toast.dismiss()
  await page.viewport(viewport.width, viewport.height)
})

async function open(exportFile: TraceBackend['export'], archived = false) {
  const fixture = createFixtureChat({
    sessions: fixtureSessions.map((session) => (session.id === 's-1' && archived ? { ...session, archivedAt: 1 } : session)),
  })
  const appearance = createAppearanceStore({ locale: 'en', theme: 'light' })
  const preferences = createPreferences({ appearance, settings: fixture.settings, onConflict() {}, onFailure() {} })
  const trace = createTraceStore({
    trace: async () => ({ runs: [], totals: { runs: 0, requests: 0, toolCalls: 0, tokens: 0, cost: 0, durationMs: 0 } }),
    export: exportFile,
  })
  await render(
    <div style={{ width: '100vw', height: '100vh' }}>
      <TraceStoreProvider store={trace}>
        <App
          store={appearance}
          connection={createConnectionStore()}
          chat={fixture.chat}
          settings={fixture.settings}
          preferences={preferences}
          settingsPage={createSettingsPageStore()}
          pickDirectory={async () => null}
        />
      </TraceStoreProvider>
    </div>,
  )
  if (archived) fixture.chat.getState().openSession('s-1')
  await expect.poll(() => fixture.chat.getState().conversations['s-1']?.status).toBe('ready')
  return { fixture, trace }
}

it('More is persistent in an archived 390px Session; keyboard menu downloads JSONL and restores focus', async () => {
  await page.viewport(390, 800)
  const exports: string[] = []
  await open(async (id) => {
    exports.push(id)
    return { filename: `coko-session-${id}.ndjson`, text: '{"type":"header"}\n' }
  }, true)
  const more = page.getByRole('button', { name: 'More', exact: true })
  await expect.element(more).toBeVisible()
  const trigger = more.element()
  const right = page.getByRole('button', { name: 'Open sidebar', exact: true })
  expect(more.element().getBoundingClientRect().right).toBeLessThanOrEqual(right.element().getBoundingClientRect().left)
  more.element().focus()
  await userEvent.keyboard('{Enter}')
  await expect.element(page.getByRole('menuitem', { name: 'Download session', exact: true })).toBeVisible()
  expect(document.querySelectorAll('[role=menuitem]').length).toBe(1)
  await userEvent.keyboard('{Escape}')
  await expect.poll(() => document.activeElement).toBe(trigger)
  await userEvent.keyboard('{Enter}')
  const clicked: string[] = []
  const original = HTMLAnchorElement.prototype.click
  HTMLAnchorElement.prototype.click = function () {
    clicked.push(this.download)
  }
  try {
    await userEvent.keyboard('{ArrowDown}{Enter}')
    await expect.poll(() => clicked).toEqual(['coko-session-s-1.jsonl'])
  } finally {
    HTMLAnchorElement.prototype.click = original
  }
  expect(exports).toEqual(['s-1'])
  await expect.element(page.getByText('Exported coko-session-s-1.jsonl')).toBeVisible()
  await expect.poll(() => document.activeElement).toBe(trigger)
})

it('header download and Trace share the Session export lock', async () => {
  let resolve!: (file: SessionExportFile) => void
  let requests = 0
  const { trace } = await open(async () => {
    requests++
    return new Promise<SessionExportFile>((done) => {
      resolve = done
    })
  })
  const more = page.getByRole('button', { name: 'More', exact: true })
  await more.click()
  await page.getByRole('menuitem', { name: 'Download session', exact: true }).click()
  await expect.poll(() => requests).toBe(1)
  expect(await trace.getState().exportSession('s-1')).toBeUndefined()
  await expect.poll(() => document.querySelector('[role=menu]')).toBeNull()
  await page.getByRole('button', { name: 'Open sidebar', exact: true }).click()
  await page.getByRole('button', { name: 'Trace', exact: true }).click()
  await expect.element(page.getByRole('button', { name: 'Exporting…', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).last().click()
  await more.click()
  await expect.element(page.getByRole('menuitem', { name: 'Download session', exact: true })).toBeDisabled()
  await userEvent.keyboard('{Escape}')
  const original = HTMLAnchorElement.prototype.click
  HTMLAnchorElement.prototype.click = function () {}
  try {
    resolve({ filename: 'coko-session-s-1.ndjson', text: '' })
    await expect.poll(() => trace.getState().exporting['s-1']).toBe(false)
  } finally {
    HTMLAnchorElement.prototype.click = original
  }
  expect(requests).toBe(1)
  await expect.poll(() => document.querySelector('[role=menu]')).toBeNull()
})

it('a download failure reports its reason in the application Toast and allows retry', async () => {
  let failed = true
  await open(async () => {
    if (failed) throw new Error('offline')
    return { filename: 'coko-session-s-1.ndjson', text: '{"type":"header"}\n' }
  })
  const more = page.getByRole('button', { name: 'More', exact: true })
  more.element().focus()
  await userEvent.keyboard('{Enter}')
  await page.getByRole('menuitem', { name: 'Download session', exact: true }).click()
  await expect.element(page.getByText('Couldn’t export the session: offline')).toBeVisible()
  failed = false
  await expect.poll(() => document.querySelector('[role=menu]')).toBeNull()
  more.element().focus()
  await userEvent.keyboard('{Enter}')
  const item = page.getByRole('menuitem', { name: 'Download session', exact: true })
  await expect.element(item).toBeEnabled()
  await userEvent.keyboard('{Escape}')
})
