import '../../styles.css'
import type { Session, SessionEntryRecord } from '@coko/protocol'
import { afterEach, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { App } from '../../app/app.tsx'
import { createAppearanceStore } from '../../app/appearance-store.ts'
import { createConnectionStore } from '../../app/connection-store.ts'
import { createPreferences } from '../../app/preferences.ts'
import { createSettingsPageStore } from '../../app/settings-page-store.ts'
import { createFixtureChat, fixtureSessions } from '../../testing/fixture-chat.ts'

const entry = (seq: number, kind: string, payload: unknown, runId: string | null = 'old-run'): SessionEntryRecord => ({
  sessionId: 's-1',
  seq,
  kind,
  payloadVersion: 1,
  payload,
  runId,
  createdAt: seq * 1000,
})
const user = (seq: number, text: string) => entry(seq, 'message', { role: 'user', content: text, timestamp: 0 })
const call = (seq: number, id: string, runId: string | null = 'old-run') =>
  entry(
    seq,
    'message',
    {
      role: 'assistant',
      content: [{ type: 'toolCall', id, name: 'custom', arguments: { query: id } }],
      stopReason: 'toolUse',
      timestamp: 0,
    },
    runId,
  )
const result = (seq: number, id: string, runId: string | null = 'old-run') =>
  entry(
    seq,
    'message',
    {
      role: 'toolResult',
      toolCallId: id,
      toolName: 'custom',
      content: [{ type: 'text', text: `retained ${id}` }],
      isError: false,
      timestamp: 0,
    },
    runId,
  )

afterEach(async () => {
  vi.restoreAllMocks()
  await page.viewport(1280, 800)
})

async function open(entries: SessionEntryRecord[], patch: Partial<Session> = {}, theme: 'light' | 'dark' = 'light') {
  const fixture = createFixtureChat({ entries: { 's-1': entries }, sessions: [{ ...fixtureSessions[0]!, ...patch }] })
  const appearance = createAppearanceStore({ theme, locale: 'en' })
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
  await expect.poll(() => fixture.chat.getState().conversations['s-1']?.status).toBe('ready')
  return fixture
}

it('actual App: a removed worktree keeps history inspectable while rewind, fork and retry cannot execute', async () => {
  const fixture = await open(
    [
      user(1, 'Historical request'),
      call(2, 'removed'),
      result(3, 'removed'),
      entry(4, 'run_end', { status: 'error', error: { code: 'model-error', message: 'Recorded failure' } }),
    ],
    { worktree: { id: 'wt-removed', name: 'removed', branch: 'coko/removed', status: 'removed' } },
  )
  const rewind = vi.spyOn(fixture.api, 'rewind')
  const fork = vi.spyOn(fixture.api, 'fork')
  await expect.element(page.getByRole('button', { name: 'Rewind to here', exact: true })).toBeDisabled()
  expect(document.querySelector('[data-slot="user-message"] [data-action="fork"]')).toBeNull()
  expect(document.querySelector('[data-run-status="error"] button')).toBeNull()
  await page.getByRole('button', { name: 'Called tools', exact: true }).click()
  await page.getByRole('button', { name: 'Tool call custom', exact: true }).click()
  await expect.element(page.getByText('retained removed', { exact: true })).toBeVisible()
  await expect.element(page.getByRole('button', { name: 'Copy message', exact: true })).toBeEnabled()
  expect(rewind).not.toHaveBeenCalled()
  expect(fork).not.toHaveBeenCalled()
})

it('actual App: a paused removed-worktree Session cannot resume through the historical Run banner', async () => {
  await open([user(1, 'Paused request'), call(2, 'paused'), result(3, 'paused'), entry(4, 'run_end', { status: 'paused' })], {
    worktree: { id: 'wt-removed', name: 'removed', branch: 'coko/removed', status: 'removed' },
  })
  await expect.element(page.getByText('Paused request', { exact: true })).toBeVisible()
  expect(document.querySelector('[data-action="continue"]')).toBeNull()
})

it('actual App: nested rewound history retains compaction, historical folding and harmless inspection without joining the active Run', async () => {
  await open([
    entry(1, 'run_start', { trigger: 'submit' }, 'earlier-run'),
    { ...user(2, 'Earlier checkpoint'), runId: 'earlier-run' },
    entry(3, 'run_end', { status: 'completed' }, 'earlier-run'),
    entry(4, 'run_start', { trigger: 'submit' }),
    user(5, 'Original checkpoint'),
    call(6, 'old'),
    result(7, 'old'),
    {
      ...entry(
        8,
        'compaction',
        { summary: 'Immutable compacted summary', trigger: 'manual', firstKeptSeq: 5, tokensBefore: 200, tokensAfter: 100, readFiles: [], modifiedFiles: [] },
        null,
      ),
      payloadVersion: 2,
    },
    entry(9, 'run_end', { status: 'completed' }),
    entry(10, 'rewind', { targetSeq: 5 }, null),
    entry(11, 'run_start', { trigger: 'submit' }, 'second-run'),
    { ...user(12, 'Replacement checkpoint'), runId: 'second-run' },
    call(13, 'second', 'second-run'),
    result(14, 'second', 'second-run'),
    entry(15, 'run_end', { status: 'error' }, 'second-run'),
    entry(16, 'rewind', { targetSeq: 2 }, null),
    entry(17, 'run_start', { trigger: 'submit' }, 'current-run'),
    { ...user(18, 'Active checkpoint'), runId: 'current-run' },
    call(19, 'active', 'current-run'),
    result(20, 'active', 'current-run'),
    entry(21, 'run_end', { status: 'completed' }, 'current-run'),
  ])
  const outer = document.querySelector<HTMLDetailsElement>('[data-slot="rewound"]')!
  await userEvent.click(outer.querySelector('summary')!)
  const inner = outer.querySelector<HTMLDetailsElement>('[data-slot="rewound"]')!
  await userEvent.click(inner.querySelector('summary')!)
  const history = page.elementLocator(inner)
  await expect.element(history.getByRole('button', { name: 'Work steps', exact: true })).toHaveAttribute('aria-expanded', 'false')
  await history.getByRole('button', { name: 'Work steps', exact: true }).click()
  await history.getByRole('button', { name: 'Called tools', exact: true }).click()
  await history.getByRole('button', { name: 'Tool call custom', exact: true }).click()
  await expect.element(history.getByText('retained old', { exact: true })).toBeVisible()
  await expect.element(history.getByRole('button', { name: 'Inspect', exact: true })).toBeEnabled()
  await userEvent.click(inner.querySelector('[data-slot="compaction-divider"] summary')!)
  await expect.element(history.getByText('Immutable compacted summary', { exact: true })).toBeVisible()
  expect(outer.querySelector('[data-action="rewind"], [data-action="fork"], [data-run-status="error"] button')).toBeNull()
  expect(inner.querySelector('[data-tool-call-id="active"]')).toBeNull()
  await expect.element(page.getByText('Active checkpoint', { exact: true })).toBeVisible()
})

it('actual App: old entries without Run attribution remain independent and missing starts never fabricate a duration', async () => {
  const records = [
    call(1, 'unattributed', null),
    result(2, 'unattributed', null),
    call(3, 'missing-start'),
    result(4, 'missing-start'),
    entry(5, 'run_end', { status: 'completed' }),
  ]
  const raw = JSON.stringify(records)
  const fixture = await open(records)
  expect(document.querySelectorAll('[data-slot="process-group"]')).toHaveLength(1)
  expect(document.querySelector('.conversation-process-duration')).toBeNull()
  await page.getByRole('button', { name: 'Tool call custom', exact: true }).first().click()
  await expect.element(page.getByText('retained unattributed', { exact: true })).toBeVisible()
  expect(JSON.stringify(records)).toBe(raw)
  fixture.chat.getState().resumeDraft()
  await expect.element(page.getByRole('heading', { name: 'New chat', exact: true })).toBeInTheDocument()
  fixture.chat.getState().openSession('s-1')
  await expect.poll(() => fixture.chat.getState().conversations['s-1']?.status).toBe('ready')
  await page.getByRole('button', { name: 'Tool call custom', exact: true }).first().click()
  await expect.element(page.getByText('retained unattributed', { exact: true })).toBeVisible()
  expect(document.querySelector('.conversation-process-duration')).toBeNull()
})

it('actual App: revealing an earlier Steering boundary updates folding while existing messages and open tool identity survive', async () => {
  const fixture = await open([
    entry(1, 'run_start', { trigger: 'submit' }),
    user(2, 'Opening input'),
    call(4, 'existing'),
    result(5, 'existing'),
    call(8, 'later'),
    result(9, 'later'),
    entry(10, 'run_end', { status: 'completed' }),
  ])
  await page.getByRole('button', { name: 'Work steps', exact: true }).click()
  await page.getByRole('button', { name: 'Called tools', exact: true }).click()
  await page.getByRole('button', { name: 'Tool call custom', exact: true }).first().click()
  const message = document.querySelector('[data-seq="2"]')
  const tool = document.querySelector('[data-tool="custom"]')
  // There is no paging API. A controlled earlier snapshot exercises the existing projection seam.
  const conversation = fixture.chat.getState().conversations['s-1']!
  const steering = {
    ...conversation.entries.find((record) => record.seq === 2)!,
    kind: 'message' as const,
    seq: 6,
    payload: { role: 'user' as const, content: 'Earlier delivered Steering', timestamp: 0 },
  }
  fixture.chat.setState({
    conversations: {
      ...fixture.chat.getState().conversations,
      's-1': { ...conversation, entries: [...conversation.entries, steering].sort((a, b) => a.seq - b.seq) },
    },
  })
  await expect.element(page.getByRole('button', { name: 'Work steps', exact: true })).toBeDisabled()
  await expect.element(page.getByText('Earlier delivered Steering', { exact: true })).toBeVisible()
  expect(document.querySelector('[data-seq="2"]')).toBe(message)
  expect(document.querySelector('[data-tool="custom"]')).toBe(tool)
  await expect.element(page.getByText('retained existing', { exact: true })).toBeVisible()
  expect(document.querySelectorAll('[data-slot="process-group"]')).toHaveLength(2)
})

it.each(['running', 'approval', 'confirmation', 'archived'] as const)(
  'actual App: %s restricts checkpoint actions while history remains readable',
  async (restriction) => {
    const fixture = await open([user(1, 'Read-only checkpoint'), call(2, 'restricted'), result(3, 'restricted'), entry(4, 'run_end', { status: 'error' })])
    if (restriction === 'archived') {
      await fixture.chat.getState().archiveSession('s-1')
      fixture.chat.getState().openSession('s-1')
    } else if (restriction === 'running') fixture.sendServer({ type: 'progress', sessionId: 's-1', runId: 'old-run', event: { type: 'run_start' } })
    else {
      if (restriction === 'approval') fixture.sendServer({ type: 'progress', sessionId: 's-1', runId: 'approval-run', event: { type: 'run_start' } })
      fixture.sendServer({
        type: 'entry',
        sessionId: 's-1',
        entry:
          restriction === 'confirmation'
            ? entry(5, 'confirmation_request', { toolCallId: 'restricted' })
            : entry(
                5,
                'approval_request',
                { requestId: 'request', toolCallId: 'restricted', toolName: 'custom', kind: 'tool', subject: 'restricted', suggestions: [] },
                'approval-run',
              ),
      })
    }
    await expect.element(page.getByRole('button', { name: 'Rewind to here', exact: true })).toBeDisabled()
    expect(document.querySelector('[data-slot="user-message"] [data-action="fork"]')).toBeNull()
    expect(document.querySelector('[data-run-status="error"] button')).toBeNull()
    await expect.element(page.getByText('Read-only checkpoint', { exact: true })).toBeVisible()
    await expect.element(page.getByRole('button', { name: 'Copy message', exact: true })).toBeEnabled()
  },
)

it('actual App: a Run starting while rewind confirmation is open closes the forbidden action', async () => {
  const fixture = await open([user(1, 'Checkpoint')])
  const rewind = vi.spyOn(fixture.api, 'rewind')
  await page.getByRole('button', { name: 'Rewind to here', exact: true }).click()
  await expect.poll(() => document.querySelector('[data-slot="rewind-dialog"]') !== null).toBe(true)
  fixture.sendServer({ type: 'progress', sessionId: 's-1', runId: 'new-run', event: { type: 'run_start' } })
  await expect.poll(() => document.querySelector('[data-slot="rewind-dialog"]')).toBeNull()
  expect(rewind.mock.calls.every(([, request]) => request.dryRun === true)).toBe(true)
})
