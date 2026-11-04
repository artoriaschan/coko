import '../../styles.css'
import type { GoalPayload, SessionEntryRecord } from '@coko/protocol'
import { afterEach, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { App } from '../../app/app.tsx'
import { createAppearanceStore } from '../../app/appearance-store.ts'
import { createConnectionStore } from '../../app/connection-store.ts'
import { createPreferences } from '../../app/preferences.ts'
import { createSettingsPageStore } from '../../app/settings-page-store.ts'
import { createAgentsStore } from '../../stores/agents-store.ts'
import { createGoalStore } from '../../stores/goal-store.ts'
import { GoalStoreProvider } from './dock/goal-card.tsx'
import { createJobsStore } from '../../stores/jobs-store.ts'
import { createFixtureChat, fixtureSessions } from '../../testing/fixture-chat.ts'
import { AgentsStoreProvider } from './agents-button.tsx'
import { JobsStoreProvider } from './jobs-button.tsx'

const entry = (seq: number, kind: string, payload: unknown, sessionId = 's-1'): SessionEntryRecord => ({
  sessionId,
  seq,
  kind,
  payloadVersion: 1,
  payload,
  runId: 'same-run',
  createdAt: seq,
})
const call = (seq: number, id: string) =>
  entry(seq, 'message', {
    role: 'assistant',
    content: [{ type: 'toolCall', id, name: 'custom', arguments: {} }],
    stopReason: 'toolUse',
    timestamp: 0,
  })
const usage = (tokens: number) => ({
  input: tokens - 10,
  output: 10,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: tokens,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
})
const reply = (seq: number, tokens: number) =>
  entry(seq, 'message', {
    role: 'assistant',
    content: [{ type: 'text', text: 'Recorded answer' }],
    stopReason: 'stop',
    timestamp: 0,
    usage: usage(tokens),
  })
const start = (seq: number) =>
  entry(seq, 'job_start', {
    jobId: 'job_0123456789ab',
    kind: 'bash',
    label: 'node worker.js',
    command: 'node worker.js',
    toolCallId: 'bash-1',
    logPath: '/tmp/worker.log',
  })
const plan = (seq: number, status: 'proposed' | 'rejected' | 'approved', revision = 1) =>
  entry(seq, 'plan', {
    planId: 'shared-plan',
    revision,
    markdown: '# Recorded plan\n\nRead sources before editing.',
    status,
    ...(status === 'rejected' ? { feedback: 'Please include regression evidence' } : {}),
  })
const viewport = { width: window.innerWidth, height: window.innerHeight }
afterEach(async () => {
  await page.viewport(viewport.width, viewport.height)
})

async function open(
  entries: SessionEntryRecord[],
  options: { child?: SessionEntryRecord[]; theme?: 'light' | 'dark'; locale?: 'en' | 'zh'; removed?: boolean } = {},
) {
  const fixture = createFixtureChat({
    ...(options.removed
      ? {
          sessions: fixtureSessions.map((session) =>
            session.id === 's-1' ? { ...session, worktree: { id: 'removed', name: 'removed', branch: 'coko/removed', status: 'removed' as const } } : session,
          ),
        }
      : {}),
    entries: { 's-1': entries, ...(options.child ? { child: options.child.map((e) => ({ ...e, sessionId: 'child' })) } : {}) },
  })
  const appearance = createAppearanceStore({ theme: options.theme ?? 'light', locale: options.locale ?? 'en' })
  const preferences = createPreferences({ appearance, settings: fixture.settings, onConflict: () => {}, onFailure: () => {} })
  const agents = createAgentsStore({
    list: async () => [{ agentId: 'child', agentType: 'general', description: 'Child work', status: 'completed', background: false, startedAt: 1, endedAt: 2 }],
    cancel: async () => {},
    definitions: async () => ({ definitions: [], diagnostics: [] }),
    answer: async () => {},
  })
  const jobs = createJobsStore({
    list: async () => [],
    output: async () => ({ offset: 0, chunk: 'Recorded Job output', nextOffset: 19, done: true }),
    kill: async () => {},
  })
  const goal = entries.findLast((e) => e.kind === 'goal')?.payload as GoalPayload | undefined
  const goals = createGoalStore({
    get: async () => ({ goal: goal ?? null, usage: { rounds: 2, tokens: 800, cost: 0, costUnpriced: true } }),
    act: async () => {
      throw new Error('Unexpected goal mutation')
    },
  })
  await render(
    <GoalStoreProvider store={goals}>
      <div style={{ width: '100vw', height: '100vh' }}>
        <AgentsStoreProvider store={agents}>
          <JobsStoreProvider store={jobs}>
            <App
              store={appearance}
              connection={createConnectionStore()}
              chat={fixture.chat}
              settings={fixture.settings}
              preferences={preferences}
              settingsPage={createSettingsPageStore()}
              pickDirectory={async () => null}
            />
          </JobsStoreProvider>
        </AgentsStoreProvider>
      </div>
    </GoalStoreProvider>,
  )
  await expect.poll(() => fixture.chat.getState().conversations['s-1']?.status).toBe('ready')
  return { ...fixture, agents, jobs }
}

it('actual App: invisible Job lifecycle do not split adjacent process; visible business conclusions stay outside folding', async () => {
  await open([
    entry(1, 'run_start', { trigger: 'submit' }),
    call(2, 'before'),
    start(3),
    call(5, 'after'),
    plan(6, 'rejected'),
    entry(7, 'run_end', { status: 'completed' }),
  ])
  await expect.poll(() => document.querySelectorAll('[data-slot="process-group"]').length).toBe(1)
  expect(document.querySelectorAll('[data-slot="plan-card"]')).toHaveLength(1)
  await expect
    .element(page.elementLocator(document.querySelector('[data-slot="plan-card"]')!).getByText('Please include regression evidence', { exact: true }))
    .toBeVisible()
  expect(document.querySelector('[data-slot="plan-card"]')!.closest('[data-slot="process-seat"]')).toBeNull()
  expect(document.querySelector('[data-slot="process-seat"]')!.hasAttribute('hidden')).toBe(true)
})

it('actual App: child Plan revisions and Job navigation use rendered Session facts even when parent IDs coincide', async () => {
  await page.viewport(1280, 900)
  const fixture = await open([plan(100, 'approved'), reply(101, 999), entry(102, 'run_end', { status: 'completed' })], {
    child: [
      plan(1, 'proposed'),
      start(2),
      entry(3, 'job_end', { jobId: 'job_0123456789ab', status: 'failed', exitCode: 7, outputBytes: 0, truncated: false }),
      entry(4, 'job_notification', { jobIds: ['job_0123456789ab'] }),
      reply(5, 42),
      entry(6, 'run_end', { status: 'completed' }),
    ],
  })
  fixture.agents.getState().open('s-1', 'child')
  await expect.poll(() => document.querySelector('[data-slot="agent-timeline"] [data-slot="plan-card"]')?.getAttribute('data-status')).toBe('proposed')
  const child = document.querySelector('[data-slot="agent-timeline"]')!
  expect(child.querySelector('[data-slot="plan-card"]')?.getAttribute('data-status')).toBe('proposed')
  expect(child.querySelector('[data-slot="job-notification"]')!.textContent).toContain('Failed · exit code 7')
  await page.elementLocator(child.querySelector('[data-action="open-job"]')!).click()
  await expect.element(page.elementLocator(child).getByText('Recorded Job output', { exact: true })).toBeVisible()
  expect(child.querySelector('[data-action="stop-job"]')).toBeNull()
  expect(fixture.jobs.getState().selected.child).toBe('job_0123456789ab')
  expect(fixture.jobs.getState().selected['s-1']).toBeUndefined()
  expect(fixture.chat.getState().activeSessionId).toBe('s-1')
})

it('actual App: Plan settlement preserves the real review boundary and focused expanded tool identity', async () => {
  const fixture = await open([entry(1, 'run_start', { trigger: 'submit' }), call(2, 'before'), plan(3, 'proposed'), call(4, 'after')])
  fixture.sendServer({ type: 'progress', sessionId: 's-1', runId: 'same-run', event: { type: 'run_start' } })
  await expect.poll(() => document.querySelectorAll('[data-slot="tool-card"]').length).toBe(2)
  const tool = document.querySelectorAll<HTMLButtonElement>('[data-slot="tool-card"] button')[1]!
  tool.focus()
  await userEvent.keyboard('{Enter}')
  const row = tool.closest('[data-slot="tool-card"]')!
  const body = row.querySelector('[data-slot="tool-card-body"]')!
  fixture.sendServer({ type: 'entry', sessionId: 's-1', entry: plan(5, 'approved') })
  await expect.poll(() => document.querySelectorAll('[data-slot="plan-card"]').length).toBe(1)
  expect(document.querySelector('[data-slot="plan-card"]')!.getAttribute('data-status')).toBe('approved')
  expect(document.querySelectorAll('[data-slot="process-group"]')).toHaveLength(2)
  expect(document.querySelectorAll('[data-slot="tool-card"]')[1]).toBe(row)
  expect(row.querySelector('[data-slot="tool-card-body"]')).toBe(body)
  expect(document.activeElement).toBe(tool)
})

it('actual App: rewound usage uses the rendered Run entries and historical Plan inspection shows its snapshot without changing the active Plan tab', async () => {
  await page.viewport(1280, 900)
  await open([
    entry(1, 'run_start', { trigger: 'submit' }),
    plan(2, 'rejected'),
    reply(3, 42),
    entry(4, 'run_end', { status: 'completed' }),
    entry(5, 'rewind', { targetSeq: 1 }),
    { ...reply(6, 999), runId: 'new-run' },
    plan(7, 'approved', 2),
    { ...entry(8, 'run_end', { status: 'completed' }), runId: 'new-run' },
  ])
  await page.elementLocator(document.querySelector('[data-slot="plan-card"][data-revision="2"] [data-action="open-plan"]')!).click()
  await expect.poll(() => document.querySelector('[data-slot="plan-tab"]')?.getAttribute('data-revision')).toBe('2')
  const history = document.querySelector<HTMLDetailsElement>('[data-slot="rewound"]')!
  await page.elementLocator(history.querySelector('summary')!).click()
  const row = history.querySelector('[data-slot="assistant-footer"]')!
  expect(row.getAttribute('data-tokens')).toBe('42')
  // Historical usage remains attached to its original Run; a later Run has independent totals.
  expect(history.querySelector('[data-slot="plan-card"]')!.getAttribute('data-revision')).toBe('1')
  await page.elementLocator(history.querySelector('[data-action="open-plan"]')!).click()
  await expect.element(page.elementLocator(history).getByText('Read sources before editing.', { exact: true })).toBeVisible()
  expect(document.querySelector('[data-slot="plan-tab"]')?.getAttribute('data-revision')).toBe('2')
})

for (const theme of ['light', 'dark'] as const)
  for (const locale of ['en', 'zh'] as const)
    for (const width of [390, 1000]) {
      it(`actual App: business facts remain readable and keyboard reachable in ${theme}/${locale}/${width}`, async () => {
        await page.viewport(width, 900)
        await open(
          [
            entry(1, 'run_start', { trigger: 'submit' }),
            call(2, 'process'),
            plan(3, 'rejected'),
            entry(4, 'goal', {
              id: 'g1',
              revision: 1,
              objective: 'Check ' + 'long-objective-'.repeat(16),
              criteria: [{ id: 'c1', text: 'Tests pass' }],
              budget: { maxRounds: 3, maxTokens: 1000 },
              phase: 'running',
              resumedAtRound: 0,
              source: 'model',
            }),
            entry(5, 'todo_list', { items: [{ id: 'todo1', content: 'Verify output', status: 'in_progress' }] }),
            entry(6, 'hook_run', {
              hookId: 'hook1',
              event: 'PostToolUse',
              source: 'global',
              command: 'check-output '.repeat(20),
              outcome: 'error',
              durationMs: 3,
              exitCode: 9,
              message: 'Recorded failure\n' + 'unbroken'.repeat(30),
            }),
            reply(7, 42),
            entry(8, 'run_end', { status: 'completed' }),
          ],
          { theme, locale },
        )
        await expect.poll(() => document.querySelector('[data-slot="app-frame-main"]')!.getBoundingClientRect().width).toBe(width)
        const goal = document.querySelector('[data-slot="goal-row"]')!
        expect(goal.getAttribute('data-phase')).toBe('running')
        expect(goal.closest('[data-slot="process-seat"]')).toBeNull()
        expect(document.querySelector('[data-slot="todo-card"]')!.textContent).toContain('Verify output')
        const hook = document.querySelector('[data-slot="hook-row"]')!
        expect(hook.getAttribute('data-outcome')).toBe('error')
        expect(hook.textContent).toContain('9')
        expect(hook.querySelector('[data-slot="hook-message"]')!.textContent).toContain('unbroken'.repeat(30))
        for (const row of document.querySelectorAll<HTMLElement>('.conversation-business-row')) {
          expect(getComputedStyle(row).fontSize).toBe('13px')
          expect(getComputedStyle(row).lineHeight).toBe('20px')
          expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth + 1)
        }
        const main = document.querySelector<HTMLElement>('[data-slot="app-frame-main"]')!
        expect(main.scrollWidth).toBeLessThanOrEqual(main.clientWidth)
        const planButton = document.querySelector<HTMLButtonElement>('[data-action="open-plan"]')!
        planButton.focus()
        await userEvent.keyboard('{Enter}')
        await expect.poll(() => document.querySelector('[data-slot="plan-tab"]')?.getAttribute('data-revision')).toBe('1')
        // Goal controls and budget remain in the existing dock, never folded with work steps.
        const goalToggle = document.querySelector<HTMLButtonElement>('[data-action="toggle-goal"]')!
        goalToggle.focus()
        await userEvent.keyboard('{Enter}')
        await expect.poll(() => document.querySelector('[data-budget="tokens"] [data-budget-value]')?.textContent).toBe('800 / 1,000')
        expect(document.querySelector('[data-action="pause-goal"]')).not.toBeNull()
        expect(document.querySelector('[data-slot="dock"]')!.closest('[data-slot="process-seat"]')).toBeNull()
      })
    }

it('actual App: finishing the dispatch Run does not complete its independent Job; later Job failure updates the same chip', async () => {
  const fixture = await open([
    entry(1, 'run_start', { trigger: 'submit' }),
    entry(2, 'message', {
      role: 'assistant',
      content: [{ type: 'toolCall', id: 'bash-1', name: 'bash', arguments: { command: 'node worker.js', run_in_background: true } }],
      stopReason: 'toolUse',
      timestamp: 0,
    }),
    start(3),
    entry(4, 'message', {
      role: 'toolResult',
      toolCallId: 'bash-1',
      toolName: 'bash',
      content: [{ type: 'text', text: 'Started background job job_0123456789ab: node worker.js. Read output with job_output.' }],
      isError: false,
      timestamp: 0,
    }),
    entry(5, 'run_end', { status: 'completed' }),
  ])
  await page.getByRole('button', { name: 'Work steps', exact: true }).click()
  await page.getByRole('button', { name: 'Ran commands', exact: true }).click()
  await page.elementLocator(document.querySelector('[data-slot="tool-card"][data-tool="bash"] button')!).click()
  const chip = document.querySelector('[data-slot="job-chip"]')!
  expect(chip.querySelector('[data-job-status]')!.getAttribute('data-job-status')).toBe('running')
  expect(document.querySelectorAll('[data-slot="tool-card"]')).toHaveLength(1)
  fixture.sendServer({
    type: 'entry',
    sessionId: 's-1',
    entry: entry(6, 'job_end', { jobId: 'job_0123456789ab', status: 'failed', exitCode: 7, outputBytes: 0, truncated: false }),
  })
  fixture.sendServer({ type: 'entry', sessionId: 's-1', entry: entry(7, 'job_notification', { jobIds: ['job_0123456789ab'] }) })
  await expect.poll(() => chip.querySelector('[data-job-status]')!.getAttribute('data-job-status')).toBe('failed')
  expect(document.querySelector('[data-slot="job-chip"]')).toBe(chip)
  expect(document.querySelectorAll('[data-slot="tool-card"]')).toHaveLength(1)
  expect(document.querySelector('[data-slot="job-notification"]')!.closest('[data-slot="process-seat"]')).toBeNull()
})

it.each(['archived', 'removed'] as const)('actual App: %s Session keeps Plan and Job inspection readable without execution controls', async (restriction) => {
  const fixture = await open(
    [plan(1, 'approved'), start(2), entry(3, 'job_notification', { jobIds: ['job_0123456789ab'] }), entry(4, 'run_end', { status: 'completed' })],
    { removed: restriction === 'removed' },
  )
  if (restriction === 'archived') {
    await fixture.chat.getState().archiveSession('s-1')
    await fixture.chat.getState().openSession('s-1')
  }
  const planButton = page.elementLocator(document.querySelector('[data-action="open-plan"]')!)
  await expect.element(planButton).toHaveAttribute('aria-expanded', 'false')
  await planButton.click()
  await expect
    .element(page.elementLocator(document.querySelector('[data-slot="plan-card"]')!).getByText('Read sources before editing.', { exact: true }))
    .toBeVisible()
  const jobButton = page.elementLocator(document.querySelector('[data-action="open-job"]')!)
  await jobButton.click()
  await expect.element(page.getByText('Recorded Job output', { exact: true })).toBeVisible()
  expect(document.querySelector('[data-action="stop-job"]')).toBeNull()
  expect(document.querySelector('[data-action="plan-edit"]')).toBeNull()
})

it('actual App: a pending Plan review keeps the active Plan-tab route available independently of disabled checkpoint actions', async () => {
  const fixture = await open([
    entry(1, 'run_start', { trigger: 'submit' }),
    plan(2, 'proposed'),
    entry(3, 'approval_request', {
      requestId: 'review1',
      toolCallId: 'exit1',
      toolName: 'exit_plan_mode',
      kind: 'plan',
      subject: 'Recorded plan',
      suggestions: [],
      planId: 'shared-plan',
      revision: 1,
    }),
  ])
  fixture.sendServer({ type: 'progress', sessionId: 's-1', runId: 'same-run', event: { type: 'run_start' } })
  await expect.poll(() => document.querySelector('[data-slot="plan-review"]')).not.toBeNull()
  const button = document.querySelector('[data-slot="plan-card"] [data-action="open-plan"]')!
  expect(button.getAttribute('aria-expanded')).toBeNull()
  await page.elementLocator(document.querySelector('[data-slot="app-frame-right"]')!).getByRole('button', { name: 'Close right sidebar', exact: true }).click()
  ;(button as HTMLButtonElement).focus()
  await userEvent.keyboard('{Enter}')
  await expect.poll(() => document.querySelector('[data-slot="app-frame-right"]')?.getAttribute('hidden')).toBeNull()
  await expect.poll(() => document.querySelector('[data-slot="plan-tab"]')?.getAttribute('data-revision')).toBe('1')
  expect(document.querySelector('[data-slot="plan-review"]')!.closest('[data-slot="process-seat"]')).toBeNull()
})
