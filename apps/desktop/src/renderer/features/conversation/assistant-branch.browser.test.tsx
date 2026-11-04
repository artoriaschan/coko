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
  window.getSelection()?.removeAllRanges()
  await page.viewport(1280, 800)
})
const record = (seq: number, kind: string, payload: unknown, runId = 'r1', createdAt = 1_700_000_000_000 + seq): SessionEntryRecord => ({
  sessionId: 's-1',
  seq,
  kind,
  payload,
  runId,
  createdAt,
  payloadVersion: 1,
})
const answer = (seq: number, texts: string[], runId = 'r1') =>
  record(
    seq,
    'message',
    {
      role: 'assistant',
      content: texts.map((text) => ({ type: 'text', text })),
      timestamp: 1,
      stopReason: 'stop',
    },
    runId,
  )
const metered = (seq: number, runId = 'r1') =>
  record(
    seq,
    'model_request',
    {
      requestId: `request-${seq}`,
      runId,
      provider: 'configured-provider',
      model: 'model-with-a-long-name',
      purpose: 'turn',
      startedAt: 1,
      durationMs: 10,
      stopReason: 'stop',
      retries: 0,
      usage: { input: 700, cacheRead: 300, cacheWrite: 100, output: 200, total: 1300 },
      usageReport: { complete: true, known: ['input', 'cacheRead', 'cacheWrite', 'output'] },
      reasoning: 50,
      cost: 0.5,
    },
    runId,
  )
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

it('actual App branches a historical successful reply into an empty new Session while retaining source draft and records', async () => {
  const source = [
    record(1, 'run_start', { trigger: 'submit' }),
    answer(2, ['Earlier reply']),
    metered(3),
    record(4, 'run_end', { status: 'completed' }),
    record(5, 'run_start', { trigger: 'submit' }, 'r2'),
    answer(6, ['Latest reply'], 'r2'),
    record(7, 'run_end', { status: 'completed' }, 'r2'),
  ]
  const fixture = await open(source)
  const sessions = await fixture.api.listSessions()
  const target = { ...sessions[0]!, id: 's-fork', title: 'Assistant branch', updatedAt: 1000 }
  const fork = vi.fn<(...args: unknown[]) => Promise<{ sessionId: string; text: string }>>(async (..._args: unknown[]) => ({ sessionId: target.id, text: '' }))
  Object.assign(fixture.api, { fork, listSessions: async () => [...sessions, target] })
  const composer = page.getByRole('textbox', { name: 'Give Coko a task' })
  await userEvent.click(composer)
  await userEvent.type(composer, 'unsent source draft')
  const old = page.getByRole('article', { name: 'Coko', exact: true }).first()
  await userEvent.hover(old)
  const branch = old.getByRole('button', { name: 'Branch in a new conversation', exact: true })
  await expect.element(branch).toBeVisible()
  const before = fixture.chat.getState().conversations['s-1']!.entries
  await userEvent.click(branch)
  await expect.poll(() => fixture.chat.getState().activeSessionId).toBe('s-fork')
  expect(fork.mock.calls[0]).toEqual(['s-1', 2, undefined, 'assistant-inclusive'])
  await expect.element(composer).toHaveTextContent('')
  expect(fixture.chat.getState().conversations['s-1']!.entries).toEqual(before)
  fixture.chat.getState().openSession('s-1')
  await expect.element(composer).toHaveTextContent('unsent source draft')
})

it('copied history preserves trusted original times and reply actions while source usage stays out of new Session cost', async () => {
  const sent = Date.parse('2026-11-02T09:10:11Z')
  const ended = Date.parse('2026-11-02T09:11:12Z')
  const origin = {
    sessionId: 'source-session',
    seq: 9,
    boundary: 'assistant-inclusive',
    messages: [
      { seq: 2, sourceSeq: 4, createdAt: sent },
      {
        seq: 3,
        sourceSeq: 5,
        createdAt: sent + 1000,
        reply: { runId: 'source-run', endedAt: ended, requests: [{ ...(metered(3).payload as object), runId: 'source-run' }], legacy: [] },
      },
    ],
  }
  await open([
    { ...record(1, 'fork_origin', origin), runId: null },
    { ...record(2, 'message', { role: 'user', content: 'Original input', timestamp: 1 }), runId: null },
    { ...answer(3, ['Copied answer']), runId: null },
  ])
  await expect.element(page.getByRole('button', { name: 'Branch in a new conversation', exact: true })).toBeVisible()
  expect(document.querySelector('[data-slot="user-message"] time')?.getAttribute('datetime')).toBe('2026-11-02T09:10:11.000Z')
  const footer = document.querySelector('[data-slot="assistant-footer"]')!
  expect(footer.querySelector('time')?.getAttribute('datetime')).toBe('2026-11-02T09:11:12.000Z')
  expect(footer.textContent).toContain('1.3K tokens')
  expect(document.querySelector('[data-slot="session-cost"]')).toBeNull()
})

it('legacy copied messages do not display their copy time as an original sending time', async () => {
  await open([
    { ...record(1, 'fork_origin', { sessionId: 'old-source', seq: 10 }), runId: null },
    { ...record(2, 'message', { role: 'user', content: 'Old copied input', timestamp: 1 }), runId: null },
  ])
  await expect.element(page.getByRole('article', { name: 'You', exact: true })).toBeVisible()
  expect(document.querySelector('[data-slot="user-message"] time')).toBeNull()
})

it('failed branch keeps the source Session and unsent draft', async () => {
  const fixture = await open([record(1, 'run_start', { trigger: 'submit' }), answer(2, ['Source reply']), record(3, 'run_end', { status: 'completed' })])
  const fork = vi.fn<() => Promise<never>>(async () => {
    throw new Error('network unavailable')
  })
  Object.assign(fixture.api, { fork })
  const composer = page.getByRole('textbox', { name: 'Give Coko a task' })
  await userEvent.click(composer)
  await userEvent.type(composer, 'keep my draft')
  await userEvent.click(page.getByRole('button', { name: 'Branch in a new conversation', exact: true }))
  expect(fork).toHaveBeenCalledOnce()
  expect(fixture.chat.getState().activeSessionId).toBe('s-1')
  await expect.element(composer).toHaveTextContent('keep my draft')
})

for (const theme of ['light', 'dark'] as const)
  for (const locale of ['en', 'zh'] as const)
    it(`assistant branch stays keyboard reachable at390 in ${theme}/${locale}`, async () => {
      await page.viewport(390, 800)
      await open([record(1, 'run_start', { trigger: 'submit' }), answer(2, ['Final reply']), record(3, 'run_end', { status: 'completed' })], theme, locale)
      const branch = page.getByRole('button', { name: locale === 'en' ? 'Branch in a new conversation' : '在新对话中分支', exact: true })
      await expect.element(branch).toBeVisible()
      branch.element().focus()
      expect(document.activeElement).toBe(branch.element())
      const footer = document.querySelector('[data-slot="assistant-footer"]')!
      expect(Array.from(footer.querySelectorAll('button[data-action]')).map((el) => el.getAttribute('data-action'))).toEqual([
        'copy-message',
        'branch-reply',
        'run-usage',
      ])
      await expect.poll(() => document.querySelector('[data-slot="app-frame-main"]')!.getBoundingClientRect().width).toBe(390)
      const usage = footer.querySelector('[data-action="run-usage"]')!.getBoundingClientRect()
      const time = footer.querySelector('time')!.getBoundingClientRect()
      expect(usage.right).toBeLessThanOrEqual(time.left)
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390)
    })
