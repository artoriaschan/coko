import '../../styles.css'
import type { SessionEntryRecord } from '@coko/protocol'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { App } from '../../app/app.tsx'
import { createAppearanceStore } from '../../app/appearance-store.ts'
import { createConnectionStore } from '../../app/connection-store.ts'
import { createPreferences } from '../../app/preferences.ts'
import { createSettingsPageStore } from '../../app/settings-page-store.ts'
import { createAgentsStore } from '../../stores/agents-store.ts'
import { AgentsStoreProvider } from './agents-button.tsx'
import { createFixtureChat } from '../../testing/fixture-chat.ts'

const entry = (seq: number, kind: string, payload: unknown): SessionEntryRecord => ({
  sessionId: 's-1',
  seq,
  kind,
  payloadVersion: 1,
  payload,
  runId: 'run-1',
  createdAt: seq,
})
const call = (seq: number, id: string, name: string, args: unknown) =>
  entry(seq, 'message', { role: 'assistant', content: [{ type: 'toolCall', id, name, arguments: args }], stopReason: 'toolUse', timestamp: 0 })
const result = (seq: number, id: string, text: string, isError = false) =>
  entry(seq, 'message', { role: 'toolResult', toolCallId: id, toolName: 'custom', content: [{ type: 'text', text }], isError, timestamp: 0 })

let viewport = { width: 0, height: 0 }
beforeEach(() => {
  viewport = { width: window.innerWidth, height: window.innerHeight }
})
afterEach(async () => {
  vi.restoreAllMocks()
  await page.viewport(viewport.width, viewport.height)
})

async function open(
  entries: SessionEntryRecord[],
  theme: 'light' | 'dark' = 'light',
  locale: 'zh' | 'en' = 'en',
  children?: { entries: Record<string, SessionEntryRecord[]>; agents: ReturnType<typeof createAgentsStore> },
) {
  const fixture = createFixtureChat({ entries: { 's-1': entries, ...children?.entries } })
  const appearance = createAppearanceStore({ theme, locale })
  const preferences = createPreferences({ appearance, settings: fixture.settings, onConflict: () => {}, onFailure: () => {} })
  const connection = createConnectionStore()
  const app = (
    <App
      store={appearance}
      connection={connection}
      chat={fixture.chat}
      settings={fixture.settings}
      preferences={preferences}
      settingsPage={createSettingsPageStore()}
      pickDirectory={async () => null}
    />
  )
  await render(
    <div style={{ width: '100vw', height: '100vh' }}>{children ? <AgentsStoreProvider store={children.agents}>{app}</AgentsStoreProvider> : app}</div>,
  )
  await expect.poll(() => fixture.chat.getState().conversations['s-1']?.status).toBe('ready')
  return { ...fixture, connection }
}

it('actual App: agent details are manual and retain complete original input and output through live completion', async () => {
  const agents = createAgentsStore({
    list: async () => [],
    cancel: async () => {},
    definitions: async () => ({ definitions: [], diagnostics: [] }),
    answer: async () => {},
  })
  const fixture = await open(
    [
      entry(1, 'run_start', { trigger: 'submit' }),
      call(2, 'agent-call', 'agent', { description: 'Inspect source', prompt: 'FULL ORIGINAL PROMPT', model: 'provider/model', isolation: 'worktree' }),
      entry(3, 'agent_start', { agentId: 'child-a', toolCallId: 'agent-call', agentType: 'explore', description: 'Inspect source', background: false }),
    ],
    'light',
    'en',
    { agents, entries: {} },
  )
  fixture.sendServer({ type: 'progress', sessionId: 's-1', runId: 'run-1', event: { type: 'run_start' } })
  const control = page.getByRole('button', { name: /Subagent explore/ }).first()
  await expect.element(control).toHaveAttribute('aria-expanded', 'false')
  await control.click()
  await expect.element(page.getByText('Starting…', { exact: true })).toBeVisible()
  const row = document.querySelector('[data-tool="agent"]')!
  await page.getByText('Input / output', { exact: true }).click()
  expect(row.textContent).toContain('FULL ORIGINAL PROMPT')
  expect(row.textContent).toContain('provider/model')
  fixture.sendServer({ type: 'entry', sessionId: 's-1', entry: result(4, 'agent-call', '<agent-result status="completed">REAL CHILD RESULT</agent-result>') })
  fixture.sendServer({
    type: 'entry',
    sessionId: 's-1',
    entry: entry(5, 'agent_end', {
      agentId: 'child-a',
      status: 'failed',
      usage: { turns: 1, toolCalls: 0, tokens: 12, cost: 0, durationMs: 50 },
      resultChars: 17,
    }),
  })
  await expect.poll(() => row.getAttribute('data-status')).toBe('error')
  expect(document.querySelector('[data-tool="agent"]')).toBe(row)
  expect(control.element().getAttribute('aria-expanded')).toBe('true')
  expect(row.textContent).toContain('<agent-result status="completed">REAL CHILD RESULT</agent-result>')
  await page.getByRole('button', { name: 'View subagent Inspect source in the panel' }).click()
  expect(agents.getState().selected['s-1']).toBe('child-a')
})

it('actual App: host team delivery retains its full body outside folding and metadata never becomes a user bubble', async () => {
  await open([
    entry(1, 'run_start', { trigger: 'submit' }),
    call(2, 'before', 'custom', {}),
    result(3, 'before', 'first output'),
    entry(4, 'team_message', { messageId: 'm-1', from: 'alice', to: 'lead', summary: 'Review findings' }),
    entry(5, 'message', {
      role: 'user',
      content: '<team-message from="alice" message-id="m-1">\nFULL DELIVERED BODY\n<unsafe>literal text</unsafe>\n</team-message>',
      timestamp: 0,
    }),
    call(6, 'after', 'custom', {}),
    result(7, 'after', 'second output'),
    entry(8, 'run_end', { status: 'completed' }),
  ])
  await expect.element(page.getByRole('button', { name: 'Work steps', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'alice to lead', exact: true }).click()
  await expect.poll(() => document.querySelector('[data-slot="team-message-body"]')?.textContent).toBe('FULL DELIVERED BODY\n<unsafe>literal text</unsafe>')
  expect(document.querySelectorAll('[data-slot="user-message"]')).toHaveLength(0)
  expect(document.querySelector('unsafe')).toBeNull()
  expect(
    [...document.querySelector('[data-slot="process-timeline"]')!.children]
      .filter((el) => el.matches('[data-slot="process-seat"], [data-slot="team-message"]'))
      .map((el) => el.getAttribute('data-slot')),
  ).toEqual(['process-seat', 'team-message', 'process-seat'])
})

it('actual App: child timelines use their own agent facts and preserve Session isolation with colliding Run and call identities', async () => {
  await page.viewport(1280, 900)
  const child = [
    entry(1, 'run_start', { trigger: 'subagent' }),
    call(2, 'same-call', 'read', { path: 'child-only.ts' }),
    result(5, 'same-call', 'CHILD RESULT', true),
    entry(6, 'run_end', { status: 'error' }),
  ].map((r) => ({ ...r, sessionId: 'child-a' }))
  const agents = createAgentsStore({
    list: async (id) =>
      id === 's-1' ? [{ agentId: 'child-a', agentType: 'general', description: 'Parent dispatch', status: 'completed', background: false, startedAt: 1 }] : [],
    cancel: async () => {},
    definitions: async () => ({ definitions: [], diagnostics: [] }),
    answer: async () => {},
  })
  const fixture = await open(
    [
      entry(1, 'run_start', { trigger: 'submit' }),
      call(2, 'same-call', 'agent', { description: 'Parent dispatch', prompt: 'PARENT PARAMS' }),
      entry(3, 'agent_start', { agentId: 'child-a', toolCallId: 'same-call', agentType: 'general', description: 'Parent dispatch', background: false }),
      entry(4, 'agent_end', { agentId: 'child-a', status: 'completed', usage: { turns: 1, toolCalls: 0, tokens: 1, cost: 0, durationMs: 1 }, resultChars: 0 }),
      result(5, 'same-call', 'PARENT RESULT'),
      entry(6, 'run_end', { status: 'completed' }),
    ],
    'light',
    'en',
    { agents, entries: { 'child-a': child } },
  )
  await page.getByRole('button', { name: 'Work steps', exact: true }).click()
  await page.getByRole('button', { name: 'Coordinated subagents', exact: true }).click()
  await page
    .getByRole('button', { name: /Subagent general/ })
    .first()
    .click()
  agents.getState().open('s-1', 'child-a')
  await expect.poll(() => document.querySelector('[data-slot="agent-timeline"]') !== null).toBe(true)
  const panel = page.elementLocator(document.querySelector('[data-slot="agent-timeline"]')!)
  await panel.getByRole('button', { name: 'Read files', exact: true }).click()
  const childControl = panel.getByRole('button', { name: 'Read CHILD RESULT', exact: true }).first()
  await expect.element(childControl).toHaveAttribute('aria-expanded', 'false')
  await childControl.click()
  expect(document.querySelector('[data-slot="agent-timeline"] [data-slot="agent-card"]')).toBeNull()
  expect(document.querySelector('[data-slot="agent-timeline"] [data-tool="read"]')?.getAttribute('data-status')).toBe('error')
  expect(document.querySelector('[data-slot="agent-timeline"]')?.textContent).toContain('CHILD RESULT')
  expect(document.querySelector('[data-slot="conversation-messages"] [data-tool="agent"] button')?.getAttribute('aria-expanded')).toBe('true')
  expect(document.querySelector('[data-slot="agent-timeline"] .tool-inspect')).toBeNull()
  expect(document.querySelector('[data-slot="agent-timeline"] [role="alert"] button')).toBeNull()
  expect(fixture.chat.getState().activeSessionId).toBe('s-1')
})

it.each([
  ['light', 'en', 1000],
  ['dark', 'en', 390],
  ['light', 'zh', 390],
  ['dark', 'zh', 1000],
] as const)('actual App: %s/%s at %ipx preserves schedule, task and handoff sources and actions outside folded process', async (theme, locale, width) => {
  await page.viewport(width, 900)
  const fixture = await open(
    [
      entry(1, 'schedule_fire', { scheduleId: 'actual-schedule', occurrence: 1000, status: 'started', runId: 'run-1', missed: 2 }),
      entry(2, 'run_start', { trigger: 'schedule', schedule: { scheduleId: 'actual-schedule', occurrence: 1000 } }),
      entry(3, 'message', {
        role: 'user',
        content:
          '<scheduled_task schedule-id="actual-schedule" title="Recorded title" occurrence="1970-01-01T00:00:01.000Z">/goal resume ORIGINAL SCHEDULE PROMPT</scheduled_task>',
        timestamp: 0,
      }),
      call(4, 'work', 'custom', {}),
      result(5, 'work', 'actual output'),
      entry(6, 'team_task', {
        taskId: 't1',
        revision: 3,
        subject: 'Actual subject',
        description: 'FULL TASK DESCRIPTION',
        status: 'in_progress',
        owner: 'alice',
        blockedBy: ['t0'],
        writeScopes: ['src/'],
        by: 'alice',
      }),
      entry(7, 'handoff', { targetSessionId: 's-2', instructions: 'NEXT INSTRUCTIONS', summary: 'REAL HANDOFF SUMMARY', target: 'current' }),
      entry(8, 'run_end', { status: 'completed' }),
    ],
    theme,
    locale,
  )
  await expect.element(page.getByRole('button', { name: locale === 'en' ? 'Work steps' : '工作步骤', exact: true })).toHaveAttribute('aria-expanded', 'false')
  expect(document.querySelectorAll('[data-slot="user-message"]')).toHaveLength(0)
  const schedule = document.querySelector('[data-slot="schedule-fire"]')!
  expect(schedule.getAttribute('data-status')).toBe('started')
  const scheduledControl = schedule.querySelector<HTMLButtonElement>('button')!
  scheduledControl.focus()
  await userEvent.keyboard('{Enter}')
  expect(document.querySelector('[data-slot="schedule-prompt"]')?.textContent).toBe('/goal resume ORIGINAL SCHEDULE PROMPT')
  expect(schedule.textContent).toContain('actual-schedule')
  const task = document.querySelector('[data-slot="team-task"]')!
  task.querySelector<HTMLButtonElement>('button')!.click()
  await expect.poll(() => task.textContent).toContain('FULL TASK DESCRIPTION')
  expect(task.textContent).toContain('src/')
  const handoff = document.querySelector('[data-slot="handoff-row"]')!
  handoff.querySelector<HTMLButtonElement>('.conversation-collaboration-trigger')!.click()
  await expect.poll(() => handoff.textContent).toContain('REAL HANDOFF SUMMARY')
  expect(handoff.textContent).toContain('NEXT INSTRUCTIONS')
  const main = document.querySelector<HTMLElement>('[data-slot="app-frame-main"]')!
  expect(main.scrollWidth).toBeLessThanOrEqual(main.clientWidth)
  expect(document.querySelectorAll('[data-action="send"]').length).toBe(1)
  handoff.querySelector<HTMLButtonElement>('[data-action="open-handoff-target"]')!.click()
  await expect.poll(() => fixture.chat.getState().activeSessionId).toBe('s-2')
})
