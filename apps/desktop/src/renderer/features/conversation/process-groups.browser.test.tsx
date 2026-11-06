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

it('actual App: a running Run keeps mixed process rows flat across phase replies', async () => {
  const fixture = await open([
    entry(1, 'run_start', { trigger: 'submit' }),
    entry(2, 'message', { role: 'assistant', content: [{ type: 'thinking', thinking: 'Inspect source\n' }], stopReason: 'toolUse', timestamp: 0 }),
    call(3, 'r', 'read', { path: 'src/main.ts' }),
    result(4, 'r', 'source'),
    call(5, 'b', 'bash', { command: 'echo sample' }),
  ])
  fixture.sendServer({ type: 'progress', sessionId: 's-1', runId: 'run-1', event: { type: 'run_start' } })
  await expect.poll(() => document.querySelectorAll('[data-slot="process-group"]').length).toBe(1)
  expect(document.querySelectorAll('[data-slot="process-group-header"]:not([hidden])')).toHaveLength(0)
  const body = document.querySelector('[data-slot="process-group-body"]')!
  expect(getComputedStyle(body).maxHeight).toBe('none')
  expect(getComputedStyle(body).overflowY).toBe('visible')
  fixture.sendServer({
    type: 'entry',
    sessionId: 's-1',
    entry: entry(6, 'message', { role: 'assistant', content: [{ type: 'text', text: 'Phase reply' }], stopReason: 'toolUse', timestamp: 0 }),
  })
  fixture.sendServer({ type: 'entry', sessionId: 's-1', entry: call(7, 'r2', 'read', { path: 'next.ts' }) })
  await expect.element(page.getByText('Phase reply', { exact: true })).toBeVisible()
  expect(document.querySelectorAll('[data-slot="process-group"]')).toHaveLength(2)
  for (const group of document.querySelectorAll('[data-slot="process-group"]')) {
    expect(group.querySelector('[data-slot="process-group-header"]')?.hasAttribute('hidden')).toBe(true)
    expect(getComputedStyle(group.querySelector('[data-slot="process-group-body"]')!).maxHeight).toBe('none')
  }
})

it('actual App: completed process folds across replies, then opens three disclosure levels and resets them on explicit collapse', async () => {
  await open([
    entry(1, 'run_start', { trigger: 'submit' }),
    entry(2, 'message', { role: 'user', content: 'First opening input', timestamp: 0 }),
    entry(3, 'message', { role: 'user', content: 'Second opening input', timestamp: 0 }),
    call(4, 'r', 'read', { path: 'file.ts' }),
    result(5, 'r', 'source'),
    entry(6, 'message', { role: 'assistant', content: [{ type: 'text', text: 'Phase reply' }], stopReason: 'toolUse', timestamp: 0 }),
    call(7, 'b', 'custom', { query: 'original' }),
    result(8, 'b', 'actual output'),
    entry(9, 'message', { role: 'assistant', content: [{ type: 'text', text: 'Final answer' }], stopReason: 'stop', timestamp: 0 }),
    entry(10, 'run_end', { status: 'completed' }),
  ])
  const whole = page.getByRole('button', { name: 'Work steps', exact: true })
  await expect.element(whole).toHaveAttribute('aria-expanded', 'false')
  await expect.element(page.getByText('Phase reply', { exact: true })).toBeVisible()
  await expect.element(page.getByText('Final answer', { exact: true })).toBeVisible()
  for (const group of document.querySelectorAll('[data-slot="process-group"]')) expect(group.hasAttribute('hidden')).toBe(true)
  await whole.click()
  await expect.element(page.getByRole('button', { name: 'Read files', exact: true })).toHaveAttribute('aria-expanded', 'false')
  await page.getByRole('button', { name: 'Called tools', exact: true }).click()
  const tool = document.querySelector<HTMLButtonElement>('[data-tool="custom"] button')!
  tool.click()
  await expect.element(page.getByText('actual output', { exact: true })).toBeVisible()
  tool.focus()
  await whole.click()
  expect(document.activeElement).toBe(whole.element())
  await whole.click()
  await page.getByRole('button', { name: 'Called tools', exact: true }).click()
  expect(tool.getAttribute('aria-expanded')).toBe('false')
  expect(document.querySelector('[data-tool="custom"] [data-slot="tool-card-body"]')).toBeNull()
})

it('actual App: completing while a process control has keyboard focus preserves DOM and disclosure until manual collapse', async () => {
  const fixture = await open([entry(1, 'run_start', { trigger: 'submit' }), call(2, 'x', 'custom', { query: 'source' }), result(3, 'x', 'focus-safe output')])
  fixture.sendServer({ type: 'progress', sessionId: 's-1', runId: 'run-1', event: { type: 'run_start' } })
  await expect.element(page.getByRole('button', { name: 'Tool call custom', exact: true })).toBeVisible()
  const tool = document.querySelector<HTMLButtonElement>('[data-tool="custom"] button')!
  tool.focus()
  await userEvent.keyboard('{Enter}')
  await expect.element(page.getByText('focus-safe output', { exact: true })).toBeVisible()
  const row = document.querySelector('[data-tool="custom"]')!
  const body = document.querySelector('[data-slot="tool-card-body"]')!
  fixture.sendServer({ type: 'entry', sessionId: 's-1', entry: entry(4, 'run_end', { status: 'completed' }) })
  await expect.element(page.getByRole('button', { name: 'Work steps', exact: true })).toHaveAttribute('aria-expanded', 'true')
  expect(document.activeElement).toBe(tool)
  expect(document.querySelector('[data-tool="custom"]')).toBe(row)
  expect(document.querySelector('[data-slot="tool-card-body"]')).toBe(body)
  await expect.element(page.getByText('focus-safe output', { exact: true })).toBeVisible()
  const groupHeader = page.getByRole('button', { name: 'Called tools', exact: true })
  await groupHeader.click()
  await expect.element(groupHeader).toHaveAttribute('aria-expanded', 'false')
  expect(document.activeElement).toBe(groupHeader.element())
  await groupHeader.click()
  const whole = page.getByRole('button', { name: 'Work steps', exact: true })
  await whole.click()
  expect(document.activeElement).toBe(whole.element())
  await whole.click()
  await expect.element(page.getByRole('button', { name: 'Called tools', exact: true })).toHaveAttribute('aria-expanded', 'false')
})

it.each(['completed', 'error', 'aborted', 'paused', 'interrupted'] as const)(
  'actual App: %s uses truthful Run state and only normal completion offers whole fold without needing a final answer',
  async (status) => {
    await open([
      entry(1, 'run_start', { trigger: 'submit' }),
      call(2, 'r', 'custom', {}),
      result(3, 'r', 'original result', status === 'error'),
      entry(4, 'run_end', { status }),
    ])
    const control = page.getByRole('button', { name: 'Work steps', exact: true })
    await expect.element(control).toBeVisible()
    expect(control.element().hasAttribute('disabled')).toBe(status !== 'completed')
    expect(control.element().getAttribute('aria-expanded')).toBe(status === 'completed' ? 'false' : null)
    if (status === 'completed') await control.click()
    await page.getByRole('button', { name: 'Called tools', exact: true }).click()
    await page.getByRole('button', { name: 'Tool call custom', exact: true }).click()
    await expect.element(page.getByText('original result', { exact: true })).toBeVisible()
  },
)

it('actual App: delivered mid-process input and business notifications preserve order and forbid whole folding', async () => {
  await open([
    entry(1, 'run_start', { trigger: 'submit' }),
    call(2, 'r', 'read', { path: 'before.ts' }),
    result(3, 'r', 'before'),
    entry(4, 'message', { role: 'user', content: 'Now inspect the other file', timestamp: 0 }),
    call(5, 'b', 'custom', {}),
    result(6, 'b', 'after'),
    entry(7, 'run_end', { status: 'completed' }),
  ])
  await expect.element(page.getByRole('button', { name: 'Work steps', exact: true })).toBeDisabled()
  await expect.element(page.getByText('Now inspect the other file', { exact: true })).toBeVisible()
  const flow = document.querySelector('[data-slot="process-timeline"]')!
  expect(
    [...flow.children].filter((el) => el.matches('[data-slot="process-seat"], [data-slot="user-message"]')).map((el) => el.getAttribute('data-slot')),
  ).toEqual(['process-seat', 'user-message', 'process-seat'])
})

it('actual App: ranked activity counts failed calls once, keeps first-seen ties and displays only three categories', async () => {
  await open([
    entry(1, 'run_start', { trigger: 'submit' }),
    call(2, 'r', 'read', { path: 'missing.ts' }),
    result(3, 'r', 'not found', true),
    call(4, 'b', 'bash', { command: 'echo ok' }),
    result(5, 'b', 'ok'),
    call(6, 'b2', 'bash', { command: 'echo again' }),
    result(7, 'b2', 'again'),
    call(8, 's', 'grep', { pattern: 'source' }),
    result(9, 's', 'match'),
    call(10, 'm', 'mcp__read', {}),
    result(11, 'm', 'original'),
    entry(12, 'run_end', { status: 'completed' }),
  ])
  await page.getByRole('button', { name: 'Work steps', exact: true }).click()
  await expect.element(page.getByRole('button', { name: 'Ran commands, read files, searched code and more', exact: true })).toBeVisible()
})

it('actual App: missing Run start does not invent elapsed time; a pure reply Run has no empty process disclosure', async () => {
  await open([
    call(1, 'x', 'custom', {}),
    result(2, 'x', 'real output'),
    entry(3, 'run_end', { status: 'completed' }),
    { ...entry(4, 'message', { role: 'assistant', content: [{ type: 'text', text: 'Pure reply' }], stopReason: 'stop', timestamp: 0 }), runId: 'reply-run' },
    { ...entry(5, 'run_end', { status: 'completed' }), runId: 'reply-run' },
  ])
  await expect.element(page.getByRole('button', { name: 'Work steps', exact: true })).toBeVisible()
  expect(document.querySelectorAll('[data-slot="run-process-control"]')).toHaveLength(1)
  expect(document.querySelector('.conversation-process-duration')).toBeNull()
  await expect.element(page.getByText('Pure reply', { exact: true })).toBeVisible()
})

it.each([
  ['light', 'en'],
  ['dark', 'en'],
  ['light', 'zh'],
  ['dark', 'zh'],
] as const)('actual App: %s/%s keeps historical groups capped, directional masks and keyboard controls reachable at 390px', async (theme, locale) => {
  await page.viewport(390, 800)
  const entries = [
    entry(1, 'run_start', { trigger: 'submit' }),
    ...Array.from({ length: 20 }, (_, i) => [
      call(2 + i * 2, `read-${i}`, 'read', { path: `src/${'directory/'.repeat(10)}file-${i}.ts` }),
      result(3 + i * 2, `read-${i}`, `original ${i}`),
    ]).flat(),
    entry(42, 'run_end', { status: 'completed' }),
  ]
  await open(entries, theme, locale)
  const whole = page.getByRole('button', { name: locale === 'en' ? 'Work steps' : '工作步骤', exact: true })
  await whole.click()
  const header = page.getByRole('button', { name: locale === 'en' ? 'Read files' : '已读取文件', exact: true })
  await header.click()
  const body = document.querySelector<HTMLElement>('[data-slot="process-group-body"]')!
  await expect.poll(() => body.clientHeight).toBe(400)
  await expect.poll(() => getComputedStyle(body).overflowY).toBe('auto')
  await expect.poll(() => body.hasAttribute('data-scroll-down')).toBe(true)
  expect(body.scrollTop).toBe(0)
  const steps = body.querySelectorAll<HTMLElement>('[data-slot="process-tool-step"]')
  expect(steps).toHaveLength(20)
  const rows = body.querySelectorAll<HTMLElement>('[data-slot="tool-card"]')
  expect(rows).toHaveLength(20)
  expect(steps[1]!.getBoundingClientRect().top - steps[0]!.getBoundingClientRect().bottom).toBe(4)
  const stepHeader = steps[0]!.querySelector<HTMLElement>('.conversation-tool-step-header')!
  expect(rows[0]!.getBoundingClientRect().top - stepHeader.getBoundingClientRect().bottom).toBe(4)
  expect(body.getBoundingClientRect().top - header.element().getBoundingClientRect().top).toBe(32)
  expect(getComputedStyle(body).maskImage).toContain('24px')
  body.scrollTop = body.scrollHeight
  body.dispatchEvent(new Event('scroll'))
  await expect.poll(() => body.hasAttribute('data-scroll-up')).toBe(true)
  expect(body.hasAttribute('data-scroll-down')).toBe(false)
  const main = document.querySelector<HTMLElement>('[data-slot="app-frame-main"]')!
  expect(main.scrollWidth).toBeLessThanOrEqual(main.clientWidth)
  expect(body.getBoundingClientRect().right).toBeLessThanOrEqual(390)
  whole.element().focus()
  await userEvent.keyboard('{Enter}')
  expect(document.activeElement).toBe(whole.element())
})

it('actual App: right-panel child Sessions use their own Run process and never inherit another child disclosure', async () => {
  await page.viewport(1280, 900)
  const childEntries = (id: string) =>
    [
      entry(1, 'run_start', { trigger: 'submit' }),
      call(2, 'same-call', 'custom', { query: id }),
      result(3, 'same-call', `output from ${id}`),
      entry(4, 'run_end', { status: 'completed' }),
    ].map((record) => ({ ...record, sessionId: id }))
  const agents = createAgentsStore({
    list: async () =>
      ['child-a', 'child-b'].map((id) => ({
        agentId: id,
        agentType: 'general',
        description: id,
        status: 'completed',
        background: false,
        startedAt: 1,
        endedAt: 2,
      })),
    cancel: async () => {},
    definitions: async () => ({ definitions: [], diagnostics: [] }),
    answer: async () => {},
  })
  const fixture = await open([], 'light', 'en', { agents, entries: { 'child-a': childEntries('child-a'), 'child-b': childEntries('child-b') } })
  agents.getState().open('s-1', 'child-a')
  await expect.poll(() => document.querySelector('[data-slot="agent-detail"]')?.getAttribute('data-agent-id')).toBe('child-a')
  const child = page.elementLocator(document.querySelector('[data-slot="agent-timeline"]')!)
  await child.getByRole('button', { name: 'Work steps', exact: true }).click()
  await child.getByRole('button', { name: 'Called tools', exact: true }).click()
  await child.getByRole('button', { name: 'Tool call custom', exact: true }).click()
  await expect.element(child.getByText('output from child-a', { exact: true })).toBeVisible()
  await page.elementLocator(document.querySelector('li [data-agent-id="child-b"]')!).click()
  await expect.poll(() => document.querySelector('[data-slot="agent-detail"]')?.getAttribute('data-agent-id')).toBe('child-b')
  const other = page.elementLocator(document.querySelector('[data-slot="agent-timeline"]')!)
  await expect.element(other.getByRole('button', { name: 'Work steps', exact: true })).toHaveAttribute('aria-expanded', 'false')
  await other.getByRole('button', { name: 'Work steps', exact: true }).click()
  await other.getByRole('button', { name: 'Called tools', exact: true }).click()
  await expect.element(other.getByRole('button', { name: 'Tool call custom', exact: true })).toHaveAttribute('aria-expanded', 'false')
  expect(fixture.chat.getState().activeSessionId).toBe('s-1')
})

it('actual App: outcome-unknown confirmation keeps the process accessible even when a normal end was recorded', async () => {
  await open([call(1, 'x', 'custom', {}), entry(2, 'confirmation_request', { toolCallId: 'x' }), entry(3, 'run_end', { status: 'completed' })])
  await expect.element(page.getByRole('button', { name: 'Work steps', exact: true })).toBeDisabled()
  await expect.element(page.getByRole('button', { name: 'Called tools', exact: true })).toBeVisible()
  await expect.poll(() => document.querySelector('[data-slot="confirmation-card"]') !== null).toBe(true)
})

it('actual App: trusted running duration freezes while disconnected and catches up on reconnect without ticking announcements', async () => {
  const now = vi.spyOn(Date, 'now').mockReturnValue(10000)
  const fixture = await open([{ ...entry(1, 'run_start', { trigger: 'submit' }), createdAt: 1000 }, call(2, 'x', 'custom', {})])
  fixture.sendServer({ type: 'progress', sessionId: 's-1', runId: 'run-1', event: { type: 'run_start' } })
  fixture.connection.set({ phase: 'connected' })
  await expect.poll(() => document.querySelector('.conversation-process-duration')?.textContent).toBe('9s')
  fixture.connection.set({ phase: 'disconnected' })
  now.mockReturnValue(19000)
  fixture.sendServer({
    type: 'progress',
    sessionId: 's-1',
    runId: 'run-1',
    event: { type: 'retry', attempt: 1, maxRetries: 2, delayMs: 1, errorMessage: 'retry' },
  })
  await expect.element(page.getByText('Model request failed, retrying (1/2)', { exact: true }).first()).toBeInTheDocument()
  expect(document.querySelector('.conversation-process-duration')?.textContent).toBe('9s')
  fixture.connection.set({ phase: 'connected' })
  await expect.poll(() => document.querySelector('.conversation-process-duration')?.textContent).toBe('18s')
  expect(document.querySelector('.conversation-process-duration')?.getAttribute('aria-hidden')).toBe('true')
  const announcements = [...document.querySelectorAll('[role="status"]')].map((node) => node.textContent)
  expect(announcements.some((text) => text?.includes('18s'))).toBe(false)
})

it('actual App: a host-delivered team input cuts process groups, stays outside folding and does not expose hidden model context', async () => {
  await open([
    entry(1, 'run_start', { trigger: 'submit' }),
    call(2, 'before', 'read', { path: 'before.ts' }),
    result(3, 'before', 'source'),
    entry(4, 'team_message', { messageId: 'm-1', from: 'alice', to: 'lead', summary: 'Check this result' }),
    entry(5, 'message', { role: 'user', content: '<team-message from="alice" message-id="m-1">HIDDEN CONTEXT</team-message>', timestamp: 0 }),
    call(6, 'after', 'custom', {}),
    result(7, 'after', 'output'),
    entry(8, 'run_end', { status: 'completed' }),
  ])
  await expect.element(page.getByRole('button', { name: 'Work steps', exact: true })).toBeDisabled()
  await expect.element(page.getByText('Check this result', { exact: true })).toBeVisible()
  const flow = document.querySelector('[data-slot="process-timeline"]')!
  expect(
    [...flow.children].filter((el) => el.matches('[data-slot="process-seat"], [data-slot="team-message"]')).map((el) => el.getAttribute('data-slot')),
  ).toEqual(['process-seat', 'team-message', 'process-seat'])
  expect(flow.textContent).not.toContain('HIDDEN CONTEXT')
})

it('actual App: restoring a focused running group height cap preserves its reading position', async () => {
  await page.viewport(1000, 800)
  const fixture = await open([
    entry(1, 'run_start', { trigger: 'submit' }),
    ...Array.from({ length: 20 }, (_, i) => [call(2 + i * 2, `step-${i}`, 'custom', {}), result(3 + i * 2, `step-${i}`, `actual result ${i}`)]).flat(),
  ])
  fixture.sendServer({ type: 'progress', sessionId: 's-1', runId: 'run-1', event: { type: 'run_start' } })
  await expect.poll(() => document.querySelector('[data-slot="process-group-body"]')?.hasAttribute('data-running')).toBe(true)
  const body = document.querySelector<HTMLElement>('[data-slot="process-group-body"]')!
  const tool = body.querySelector<HTMLButtonElement>('[data-slot="tool-card"] button')!
  tool.focus({ preventScroll: true })
  expect(body.scrollTop).toBe(0)
  fixture.sendServer({ type: 'entry', sessionId: 's-1', entry: entry(42, 'run_end', { status: 'completed' }) })
  await expect.poll(() => getComputedStyle(body).maxHeight).toBe('400px')
  expect(body.scrollTop).toBe(0)
  expect(document.activeElement).toBe(tool)
})

it('actual App: completion protects only the focused group while other historical group bodies start collapsed', async () => {
  const fixture = await open([
    entry(1, 'run_start', { trigger: 'submit' }),
    call(2, 'before', 'custom', {}),
    result(3, 'before', 'before'),
    entry(4, 'message', { role: 'assistant', content: [{ type: 'text', text: 'Independent phase' }], stopReason: 'toolUse', timestamp: 0 }),
    call(5, 'after', 'custom', {}),
    result(6, 'after', 'after'),
  ])
  fixture.sendServer({ type: 'progress', sessionId: 's-1', runId: 'run-1', event: { type: 'run_start' } })
  await expect.poll(() => document.querySelectorAll('[data-slot="process-group-body"][data-running]').length).toBe(2)
  const tool = document.querySelectorAll<HTMLButtonElement>('[data-slot="tool-card"] button')[1]!
  tool.focus({ preventScroll: true })
  fixture.sendServer({ type: 'entry', sessionId: 's-1', entry: entry(7, 'run_end', { status: 'completed' }) })
  await expect.element(page.getByRole('button', { name: 'Work steps', exact: true })).toHaveAttribute('aria-expanded', 'true')
  const heads = document.querySelectorAll('[data-slot="process-group-header"]')
  expect([...heads].map((head) => head.getAttribute('aria-expanded'))).toEqual(['false', 'true'])
  expect(document.activeElement).toBe(tool)
})

it.each(['en', 'zh'] as const)('actual App: %s composes completed activity labels without rewriting translated words', async (locale) => {
  await open(
    [
      entry(1, 'run_start', { trigger: 'submit' }),
      call(2, 'r', 'read', { path: 'a.ts' }),
      result(3, 'r', 'content'),
      call(4, 'w', 'write', { path: 'b.ts', content: 'saved' }),
      result(5, 'w', 'Saved'),
      entry(6, 'run_end', { status: 'completed' }),
    ],
    'light',
    locale,
  )
  await page.getByRole('button', { name: locale === 'en' ? 'Work steps' : '工作步骤', exact: true }).click()
  await expect.element(page.getByRole('button', { name: locale === 'en' ? 'Read files and wrote files' : '已读取文件并写入文件', exact: true })).toBeVisible()
})
