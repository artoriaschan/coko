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

it('actual App: an interrupted call distinguishes Outcome Confirmation from an ordinary missing result, and keeps both visible through group folding', async () => {
  await open([
    entry(1, 'run_start', { trigger: 'submit' }),
    call(2, 'uncertain', 'bash', { command: 'perform side effect' }),
    call(3, 'missing', 'custom', { query: 'uncommitted result' }),
    entry(4, 'confirmation_request', { toolCallId: 'uncertain' }),
    entry(5, 'run_end', { status: 'interrupted' }),
  ])
  await expect.element(page.getByRole('button', { name: 'Work steps', exact: true })).toBeDisabled()
  const group = document.querySelector('[data-slot="process-group"]')!
  const header = group.querySelector<HTMLButtonElement>('[data-slot="process-group-header"]')!
  await expect.element(page.elementLocator(group).getByText('Outcome unknown', { exact: true }).first()).toBeVisible()
  await expect.element(page.elementLocator(group).getByText('No recorded result', { exact: true }).first()).toBeVisible()
  header.click()
  const uncertain = page.elementLocator(document.querySelector('[data-tool="bash"]')!)
  await expect.element(uncertain.getByText('Outcome unknown', { exact: true }).last()).toBeVisible()
  const missing = page.elementLocator(document.querySelector('[data-tool="custom"]')!)
  await expect.element(missing.getByText('No recorded result', { exact: true }).last()).toBeVisible()
  await missing.getByRole('button', { name: /^Tool call custom/ }).click()
  expect(document.querySelector('[data-tool="custom"] [data-slot="tool-card-body"]')!.textContent).not.toContain('No output')
  await expect.element(page.getByRole('button', { name: 'It took effect', exact: true })).toBeVisible()
  await expect.element(page.getByRole('button', { name: 'It did not take effect', exact: true })).toBeVisible()
})

it('actual App: approval takeover supports keyboard answering once, then returns focus and the draft without authorizing through tool disclosure', async () => {
  const fixture = await open([])
  const answers: unknown[] = []
  Object.assign(fixture.api, {
    answerApproval: async (...args: unknown[]) => {
      answers.push(args)
    },
  })
  const composer = page.getByRole('textbox', { name: /Give Coko a task/ })
  await composer.click()
  await userEvent.keyboard('keep this draft')
  fixture.sendServer({ type: 'progress', sessionId: 's-1', runId: 'run-1', event: { type: 'run_start' } })
  fixture.sendServer({ type: 'entry', sessionId: 's-1', entry: call(1, 'protected', 'custom', { path: '.git/config' }) })
  fixture.sendServer({
    type: 'entry',
    sessionId: 's-1',
    entry: entry(2, 'approval_request', {
      requestId: 'req-1',
      toolCallId: 'protected',
      toolName: 'custom',
      kind: 'tool',
      subject: '.git/config',
      suggestions: [],
    }),
  })
  const card = () => document.querySelector<HTMLElement>('[data-slot="approval-card"]')!
  await expect.poll(() => card() === document.activeElement).toBe(true)
  expect(document.querySelector('[contenteditable="true"]')?.closest('[hidden]')).not.toBeNull()
  const tool = document.querySelector<HTMLButtonElement>('[data-tool="custom"] button')!
  tool.focus()
  await userEvent.keyboard('{Enter}')
  expect(answers).toEqual([])
  await page.getByRole('button', { name: 'Inspect', exact: true }).click()
  await expect.element(page.getByRole('tab', { name: 'Trace', exact: true })).toHaveAttribute('aria-selected', 'true')
  // Inspect 在窄窗口使用全屏右栏；返回主区后才能通过键盘回答审批。
  await page.elementLocator(document.querySelector('[data-slot="app-frame-right"]')!).getByRole('button', { name: 'Collapse sidebar', exact: true }).click()
  expect(answers).toEqual([])
  expect(document.querySelector('[data-action="rewind"]')).toBeNull()
  const allow = page.getByRole('button', { name: 'Allow once', exact: true })
  allow.element().focus()
  await userEvent.keyboard('{Enter}{Enter}')
  await expect.poll(() => answers).toEqual([['s-1', 'req-1', { decision: 'allow', scope: 'once' }]])
  fixture.sendServer({
    type: 'entry',
    sessionId: 's-1',
    entry: entry(3, 'approval_decision', { requestId: 'req-1', outcome: 'allowed', by: 'user', scope: 'once' }),
  })
  await expect.element(composer).toBeVisible()
  await expect.poll(() => document.activeElement === composer.element()).toBe(true)
  expect(composer.element().textContent).toBe('keep this draft')
})

it.each([
  ['light', 'en'],
  ['dark', 'en'],
  ['light', 'zh'],
  ['dark', 'zh'],
] as const)('actual App: %s/%s preserves distinct rejection, expiry, sandbox and Hook facts through both folds at 390px', async (theme, locale) => {
  await page.viewport(390, 800)
  const reason = 'Keep this protected file unchanged: ' + '原因/'.repeat(50)
  const request = (seq: number, id: string) =>
    entry(seq, 'approval_request', { requestId: id, toolCallId: id, toolName: 'custom', kind: 'tool', subject: id, suggestions: [] })
  const blocked = (seq: number, id: string, details: unknown) =>
    entry(seq, 'message', {
      role: 'toolResult',
      toolCallId: id,
      toolName: 'custom',
      content: [{ type: 'text', text: `Actual block: ${id}` }],
      details,
      isError: true,
      timestamp: 0,
    })
  await open(
    [
      entry(1, 'run_start', { trigger: 'submit' }),
      call(2, 'denied', 'custom', {}),
      request(3, 'denied'),
      entry(4, 'approval_decision', { requestId: 'denied', outcome: 'denied', feedback: reason, by: 'user' }),
      result(5, 'denied', 'Not run: denied', true),
      call(6, 'expired', 'custom', {}),
      request(7, 'expired'),
      entry(8, 'approval_decision', { requestId: 'expired', outcome: 'expired' }),
      result(9, 'expired', 'Not run: expired', true),
      call(10, 'sandbox', 'custom', {}),
      blocked(11, 'sandbox', { sandbox: { denied: true, mode: 'workspace-write' } }),
      call(12, 'hook', 'custom', {}),
      blocked(13, 'hook', { hostBlock: { by: 'hook', command: 'local-check ' + '目录/'.repeat(60) } }),
      entry(14, 'run_end', { status: 'completed' }),
    ],
    theme,
    locale,
  )
  const outer = page.getByRole('button', { name: locale === 'en' ? 'Work steps' : '工作步骤', exact: true })
  await expect.element(outer).toHaveAttribute('aria-expanded', 'false')
  const overview = document.querySelector('[data-slot="process-tool-states"]')!
  for (const expected of locale === 'en'
    ? ['Rejected', 'Approval expired', 'Sandbox denied', 'Blocked by hook']
    : ['已拒绝', '审批已失效', '沙箱已拒绝', '被 Hook 阻止']) {
    expect(overview.textContent).toContain(expected)
  }
  await outer.click()
  await page.getByRole('button', { name: locale === 'en' ? 'Called tools' : '已调用工具', exact: true }).click()
  const rows = document.querySelectorAll<HTMLElement>('[data-tool="custom"]')
  rows[0]!.querySelector<HTMLButtonElement>('button')!.focus()
  await userEvent.keyboard('{Enter}')
  const feedback = rows[0]!.querySelector<HTMLElement>('[data-approval-feedback]')!
  expect(feedback.textContent).toBe(reason)
  expect(feedback.scrollWidth).toBeLessThanOrEqual(feedback.clientWidth)
  await page.elementLocator(rows[3]!).getByRole('button').click()
  const command = rows[3]!.querySelector<HTMLElement>('[data-slot="hook-block"] code')!
  expect(command.textContent).toContain('目录/'.repeat(60))
  expect(command.scrollWidth).toBeLessThanOrEqual(command.clientWidth)
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
  expect(document.querySelector('[data-slot="approval-card"]')).toBeNull()
})

it('actual App: confirmation answers remain user statements until an actual tool result arrives', async () => {
  const fixture = await open([
    entry(1, 'run_start', { trigger: 'submit' }),
    call(2, 'uncertain', 'custom', {}),
    entry(3, 'confirmation_request', { toolCallId: 'uncertain' }),
    entry(4, 'run_end', { status: 'interrupted' }),
  ])
  fixture.sendServer({ type: 'entry', sessionId: 's-1', entry: entry(5, 'confirmation_answer', { toolCallId: 'uncertain', answer: 'applied' }) })
  await expect.poll(() => document.querySelector('[data-slot="confirmation-card"]')).toBeNull()
  await page.getByRole('button', { name: 'Called tools', exact: true }).click()
  const row = document.querySelector('[data-tool="custom"]')!
  expect(row.getAttribute('data-status')).toBe('pending')
  expect(row.textContent).toContain('User confirmed it took effect')
  expect(row.textContent).toContain('No recorded result')
  fixture.sendServer({ type: 'entry', sessionId: 's-1', entry: result(6, 'uncertain', 'Applied (confirmed by the user)') })
  await expect.poll(() => row.getAttribute('data-status')).toBe('done')
})

it('actual App: a background child approval stays source-routed after the parent Run completed and its process was folded', async () => {
  const childAnswers: unknown[] = []
  const agents = createAgentsStore({
    list: async () => [{ agentId: 'child-a', agentType: 'general', description: 'protected write', status: 'running', background: true, startedAt: 1 }],
    cancel: async () => {},
    definitions: async () => ({ definitions: [], diagnostics: [] }),
    answer: async (...args) => {
      childAnswers.push(args)
    },
  })
  const child = (record: SessionEntryRecord) => ({ ...record, sessionId: 'child-a', runId: 'child-run' })
  const fixture = await open(
    [
      entry(1, 'run_start', { trigger: 'submit' }),
      call(2, 'dispatch', 'custom', {}),
      result(3, 'dispatch', 'Dispatched child-a'),
      entry(4, 'run_end', { status: 'completed' }),
    ],
    'light',
    'en',
    {
      agents,
      entries: {
        'child-a': [
          child(call(1, 'child-call', 'write', { path: '.git/config', content: 'requested' })),
          child(
            entry(2, 'approval_request', {
              requestId: 'child-request',
              toolCallId: 'child-call',
              toolName: 'write',
              kind: 'tool',
              subject: '.git/config',
              suggestions: [],
            }),
          ),
        ],
      },
    },
  )
  const parentAnswers: unknown[] = []
  Object.assign(fixture.api, {
    answerApproval: async (...args: unknown[]) => {
      parentAnswers.push(args)
    },
  })
  const card = page.elementLocator(document.querySelector('[data-slot="approval-card"]')!)
  await expect.element(card.getByText('From subagent general · protected write', { exact: true })).toBeVisible()
  const whole = page.getByRole('button', { name: 'Work steps', exact: true })
  await expect.element(whole).toHaveAttribute('aria-expanded', 'false')
  await whole.click()
  await whole.click()
  await expect.element(card.getByRole('button', { name: 'Reject', exact: true })).toBeVisible()
  card.getByRole('button', { name: 'Reject', exact: true }).element().focus()
  await userEvent.keyboard('{Enter}{Enter}')
  await expect.poll(() => childAnswers).toEqual([['child-a', 'child-request', { decision: 'deny' }]])
  expect(parentAnswers).toEqual([])
})

it('actual App: Outcome Confirmation takes over keyboard focus without an implicit answer and restores the composer after an explicit answer', async () => {
  const fixture = await open([entry(1, 'run_start', { trigger: 'submit' }), call(2, 'uncertain', 'custom', {})])
  const answers: unknown[] = []
  Object.assign(fixture.api, {
    answerConfirmation: async (...args: unknown[]) => {
      answers.push(args)
    },
  })
  const composer = page.getByRole('textbox', { name: /Give Coko a task/ })
  await composer.click()
  await userEvent.keyboard('recovery draft')
  fixture.sendServer({ type: 'entry', sessionId: 's-1', entry: entry(3, 'confirmation_request', { toolCallId: 'uncertain' }) })
  fixture.sendServer({ type: 'entry', sessionId: 's-1', entry: entry(4, 'run_end', { status: 'interrupted' }) })
  const card = () => document.querySelector<HTMLElement>('[data-slot="confirmation-card"]')!
  await expect.poll(() => document.activeElement === card()).toBe(true)
  await userEvent.keyboard('{Enter}{Escape}')
  expect(answers).toEqual([])
  page.getByRole('button', { name: 'It did not take effect', exact: true }).element().focus()
  await userEvent.keyboard('{Enter}{Enter}')
  await expect.poll(() => answers).toEqual([['s-1', 'uncertain', 'not-applied']])
  fixture.sendServer({ type: 'entry', sessionId: 's-1', entry: entry(5, 'confirmation_answer', { toolCallId: 'uncertain', answer: 'not-applied' }) })
  fixture.sendServer({ type: 'entry', sessionId: 's-1', entry: result(6, 'uncertain', 'Not applied (confirmed by the user)', true) })
  await expect.element(composer).toBeVisible()
  await expect.poll(() => document.activeElement === composer.element()).toBe(true)
  expect(composer.element().textContent).toBe('recovery draft')
  await expect.element(page.getByRole('button', { name: 'Continue', exact: true })).toBeVisible()
})

it('actual App: a rejected request does not claim execution while its result has not been committed, even if old running progress remains', async () => {
  const fixture = await open([
    entry(1, 'run_start', { trigger: 'submit' }),
    call(2, 'blocked', 'custom', {}),
    entry(3, 'approval_request', { requestId: 'reject', toolCallId: 'blocked', toolName: 'custom', kind: 'tool', subject: 'protected', suggestions: [] }),
  ])
  fixture.sendServer({ type: 'progress', sessionId: 's-1', runId: 'run-1', event: { type: 'tool_start', toolCallId: 'blocked', toolName: 'custom', args: {} } })
  fixture.sendServer({ type: 'entry', sessionId: 's-1', entry: entry(4, 'approval_decision', { requestId: 'reject', outcome: 'denied', by: 'user' }) })
  const row = document.querySelector('[data-tool="custom"]')!
  await expect.poll(() => row.getAttribute('data-status')).toBe('pending')
  expect(row.textContent).toContain('Rejected')
  expect(row.textContent).toContain('No recorded result')
  expect(row.querySelector('[data-slot="tool-card-body"]')).toBeNull()
})
