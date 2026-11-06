import '../../styles.css'
import type { RunTrace, SessionEntryRecord, TraceResponse } from '@coko/protocol'
import { afterEach, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { toast } from '@coko/ui'
import { App } from '../../app/app.tsx'
import { createAppearanceStore } from '../../app/appearance-store.ts'
import { createConnectionStore } from '../../app/connection-store.ts'
import { createPreferences } from '../../app/preferences.ts'
import { createSettingsPageStore } from '../../app/settings-page-store.ts'
import { createTraceStore, type TraceBackend } from '../../stores/trace-store.ts'
import { createFixtureChat } from '../../testing/fixture-chat.ts'
import { inspectTrajectory, trajectoryInspectStore } from '../trajectory/inspect-store.ts'
import { getRightPanelLayout } from '../right-panel/layout-store.ts'
import { TraceStoreProvider } from '../conversation/session-download.tsx'

const usage = { input: 100, output: 20, cacheRead: 0, cacheWrite: 0, total: 120 }
const run = (runId: string, patch: Partial<RunTrace> = {}): RunTrace => ({
  runId,
  trigger: 'submit',
  status: 'completed',
  startedAt: 1,
  durationMs: 2_500,
  requests: [
    {
      runId,
      provider: 'faux',
      model: 'faux-1',
      startedAt: 1,
      durationMs: 800,
      ttftMs: 120,
      usage,
      cost: 0.0123,
      stopReason: 'toolUse',
      retries: 2,
      purpose: 'turn',
    },
  ],
  tools: [
    {
      toolCallId: `${runId}-c1`,
      name: 'bash',
      startedAt: 1,
      durationMs: 1_700,
      execMs: 40,
      isError: false,
      approvalWaitMs: 1_500,
      approval: 'allowed',
      approvalBy: 'user',
      hooks: [{ event: 'PreToolUse', hookId: 'global:PreToolUse:0:0', source: 'global', outcome: 'asked', durationMs: 9 }],
    },
  ],
  hooks: [],
  usage,
  tokens: 120,
  cost: 0.0123,
  ...patch,
})
const response = (runs: RunTrace[]): TraceResponse => ({
  runs,
  totals: {
    runs: runs.length,
    requests: runs.reduce((n, r) => n + r.requests.length, 0),
    toolCalls: runs.reduce((n, r) => n + r.tools.length, 0),
    tokens: runs.reduce((n, r) => n + r.tokens, 0),
    cost: runs.reduce((n, r) => n + r.cost, 0),
    durationMs: 0,
  },
})

function fakeTrace(initial: TraceResponse) {
  const state = { response: initial, reads: 0, exports: [] as string[], fail: false }
  const backend: TraceBackend = {
    trace: async () => {
      state.reads++
      if (state.fail) throw new Error('offline')
      return state.response
    },
    export: async (sessionId) => {
      state.exports.push(sessionId)
      return { filename: `coko-session-${sessionId}.ndjson`, text: '{"type":"header"}\n' }
    },
  }
  return { state, backend }
}

let seq = 5000
const record = (kind: string, payload: unknown, runId: string | null = 'run-x'): SessionEntryRecord =>
  ({ sessionId: 's-1', seq: ++seq, kind, payloadVersion: 1, payload, runId, createdAt: seq }) as SessionEntryRecord

async function open(trace: ReturnType<typeof fakeTrace>, entries?: SessionEntryRecord[]) {
  const fixture = createFixtureChat(entries ? { entries: { 's-1': entries } } : {})
  const store = createAppearanceStore({ theme: 'light', locale: 'en' })
  const preferences = createPreferences({ appearance: store, settings: fixture.settings, onConflict: () => {}, onFailure: () => {} })
  await render(
    <div style={{ width: '100vw', height: '100vh' }}>
      <TraceStoreProvider store={createTraceStore(trace.backend)}>
        <App
          store={store}
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
  await expect.poll(() => fixture.chat.getState().conversations['s-1']?.status).toBe('ready')
  await page.getByRole('tab', { name: 'Trajectory', exact: true }).click()
  await expect.poll(() => document.querySelector('[role="tab"][data-tab="trajectory"]')?.getAttribute('aria-selected')).toBe('true')
  return fixture
}

const rows = () => [...document.querySelectorAll<HTMLElement>('[data-record-id]')]
const frames = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))

it('puts the base system prompt first and shows dynamic instructions, runtime context and skills as separate context rows', async () => {
  await page.viewport(1440, 900)
  const fixture = harnessLedger()
  for (const request of fixture.trace.state.response.runs[0]!.requests) {
    request.snapshot = {
      system:
        '# Static Coko prompt\n\n<environment>Runtime workspace</environment>\n\n<system-reminder>Workspace rule</system-reminder>\n\n<available_skills>Review</available_skills>',
      messages: [
        {
          role: 'system',
          content: '',
          sections: {
            'coko.base': '# Static Coko prompt',
            environment: '<environment>Runtime workspace</environment>',
            instructions: '<system-reminder>Workspace rule</system-reminder>',
            skills: '<available_skills>Review</available_skills>',
          },
          timestamp: 0,
        },
      ],
      tools: [],
    }
  }
  await open(fixture.trace, fixture.entries)
  expect(rows()[0]?.dataset.kind).toBe('system')
  expect(rows().filter((row) => row.dataset.kind === 'context')).toHaveLength(3)
  const user = rows().findIndex((row) => row.dataset.kind === 'user')
  expect(rows().findIndex((row) => row.dataset.contextSection === 'environment')).toBeGreaterThan(user)
  await page.getByRole('row', { name: 'SYSTEM: Initial System Prompt', exact: true }).click()
  const system = page.getByRole('tabpanel', { name: 'System Prompt', exact: true })
  await expect.element(system.getByRole('heading', { name: 'Static Coko prompt', exact: true })).toBeVisible()
  expect(system.element().textContent).not.toContain('Workspace rule')
  await page.getByRole('row', { name: /CONTEXT:.*Workspace rule/ }).click()
  await expect
    .element(page.getByRole('complementary', { name: 'Event details' }).getByText('<system-reminder>Workspace rule</system-reminder>', { exact: true }))
    .toBeVisible()
})

it('explains the missing system and dynamic context for historical sessions without snapshots', async () => {
  await open(fakeTrace(response([run('run-1')])))
  await page.getByRole('row', { name: 'SYSTEM: Initial System Prompt (not recorded)', exact: true }).click()
  await expect.element(page.getByText(/This history has no request snapshots, so its system prompt and dynamic context cannot be restored/)).toBeVisible()
})

function harnessLedger() {
  const assistant = {
    api: 'openai-completions',
    provider: 'faux',
    model: 'faux-1',
    stopReason: 'toolUse',
    timestamp: 1,
    usage: {
      input: usage.input,
      output: usage.output,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: usage.total,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  }
  const entries = [
    record('message', { role: 'user', content: 'Inspect the workspace' }, 'harness-run'),
    record(
      'message',
      {
        ...assistant,
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'Inspect the workspace before changing files.' },
          { type: 'toolCall', id: 'harness-call', name: 'bash', arguments: { command: 'pwd' } },
        ],
      },
      'harness-run',
    ),
    record(
      'message',
      { role: 'toolResult', toolCallId: 'harness-call', toolName: 'bash', content: [{ type: 'text', text: '/workspace' }], isError: false, timestamp: 1 },
      'harness-run',
    ),
    record('message', { ...assistant, role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: '**Workspace inspected.**' }] }, 'harness-run'),
  ]
  const base = run('harness-run')
  const requests = [entries[1]!, entries[3]!].map((entry, index) => ({
    ...base.requests[0]!,
    requestId: `harness-request-${index}`,
    startedAt: entry.createdAt,
    stopReason: index === 0 ? 'toolUse' : 'stop',
    snapshot: { system: '# Workspace system\nFollow workspace instructions.', messages: [{ role: 'user', content: 'Inspect the workspace' }], tools: [] },
  }))
  return {
    entries,
    trace: fakeTrace(
      response([run('harness-run', { requests, tools: [{ ...base.tools[0]!, toolCallId: 'harness-call', startedAt: entries[2]!.createdAt }] })]),
    ),
  }
}

it('Harness parity: assistant reasoning and call blocks are visible, and the left request dot opens a separate request inspector', async () => {
  await page.viewport(1440, 900)
  const fixture = harnessLedger()
  await open(fixture.trace, fixture.entries)
  const assistant = page.getByRole('row', { name: /ASSISTANT: Inspect the workspace before changing files/ })
  await expect.element(page.getByRole('row', { name: /ASSISTANT: Workspace inspected\./ })).toBeVisible()
  await expect.element(assistant).toBeVisible()
  await assistant.click()
  const inspector = page.getByRole('complementary', { name: 'Event details', exact: true })
  await expect.element(inspector.getByText('Inspect the workspace before changing files.', { exact: true })).toBeVisible()
  await expect.element(inspector.getByRole('button', { name: /^bash \{/ })).toBeVisible()
  await inspector.getByRole('tab', { name: 'Preview', exact: true }).click()
  await assistant.click()
  await expect.element(inspector.getByRole('tab', { name: 'Summary', exact: true })).toHaveAttribute('aria-selected', 'true')
  await assistant.getByRole('button', { name: 'Request #1', exact: true }).click()
  await expect.element(page.getByRole('complementary', { name: 'Request details', exact: true })).toBeVisible()
  await expect.element(assistant).toHaveAttribute('aria-selected', 'false')
  await expect.element(assistant.getByRole('button', { name: 'Request #1', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('tab', { name: 'Usage', exact: true }).click()
  await assistant.getByRole('button', { name: 'Request #1', exact: true }).click()
  await expect.element(page.getByRole('tab', { name: 'Summary', exact: true })).toHaveAttribute('aria-selected', 'true')
})

it('keeps square nodes and independently scrollable Harness summary sections, with the original resize limits', async () => {
  await page.viewport(1440, 900)
  const fixture = harnessLedger()
  fixture.entries[2] = record(
    'message',
    {
      role: 'toolResult',
      toolCallId: 'harness-call',
      toolName: 'bash',
      content: [{ type: 'text', text: Array.from({ length: 500 }, (_, i) => `Full result line ${i}`).join('\n') }],
      isError: false,
    },
    'harness-run',
  )
  await open(fixture.trace, fixture.entries)
  await page.getByRole('row', { name: /TOOL: bash/ }).click()
  const inspector = page.getByRole('complementary', { name: 'Event details', exact: true }).element()
  const body = inspector.querySelector<HTMLElement>('[role="tabpanel"]')!
  expect(body.scrollHeight).toBeLessThanOrEqual(body.clientHeight + 1)
  const regions = [...inspector.querySelectorAll<HTMLElement>('[data-summary-scroll-region]')]
  const overflow = regions.find((region) => region.scrollHeight > region.clientHeight + 10)
  expect(overflow).toBeDefined()
  overflow!.scrollTop = 200
  await frames()
  expect(overflow!.scrollTop).toBeGreaterThan(0)
  expect(body.scrollTop).toBe(0)
  for (const node of document.querySelectorAll('[data-timeline-span],span[data-kind]')) expect(getComputedStyle(node).borderRadius).toBe('0px')
  const width = inspector.getBoundingClientRect().width
  inspector.querySelector<HTMLElement>('[role="separator"]')!.focus()
  await userEvent.keyboard('{ArrowLeft}')
  expect(inspector.getBoundingClientRect().width - width).toBe(16)
  await userEvent.keyboard('{Home}')
  expect(inspector.getBoundingClientRect().width).toBe(width)
  await page.viewport(390, 844)
  await frames()
  const close = page.getByRole('button', { name: 'Close details', exact: true }).element()
  const rect = close.getBoundingClientRect()
  expect(close.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2))).toBe(true)
  await page.elementLocator(close).click()
  await expect.element(page.getByRole('complementary', { name: 'Event details', exact: true })).not.toBeInTheDocument()
  await page.viewport(1440, 900)
})

it('shows prefix cumulative usage, toggles timestamps, and navigates raw assistant calls and request timing like Harness', async () => {
  await page.viewport(1440, 900)
  const fixture = harnessLedger()
  await open(fixture.trace, fixture.entries)
  await page.getByRole('button', { name: 'Request #2', exact: true }).click()
  await page.getByRole('tab', { name: 'Usage', exact: true }).click()
  const cumulative = page.getByRole('region', { name: 'Session cumulative', exact: true })
  expect(cumulative.getByText('Input', { exact: true }).element().parentElement?.querySelector('dd')?.textContent).toBe('200 tok')
  await expect.element(cumulative.getByText('40 tok', { exact: true })).toBeVisible()
  await page.getByRole('tab', { name: 'Timing', exact: true }).click()
  const timestamp = document.querySelector<HTMLButtonElement>('[title="Show Unix timestamp"]')!
  await page.elementLocator(timestamp).click()
  expect(timestamp.textContent).toBe((fixture.trace.state.response.runs[0]!.requests[1]!.startedAt / 1000).toFixed(3))
  const assistant = page.getByRole('row', { name: /ASSISTANT: Inspect the workspace before changing files/ })
  await assistant.click()
  await expect.element(page.getByRole('button', { name: 'Thinking', exact: true })).toHaveAttribute('aria-expanded', 'true')
  await page.getByRole('button', { name: 'Thinking', exact: true }).click()
  await expect.element(page.getByRole('button', { name: 'Thinking', exact: true })).toHaveAttribute('aria-expanded', 'false')
  await page.getByRole('button', { name: 'Request Timing', exact: true }).click()
  await expect.element(page.getByRole('complementary', { name: 'Request details', exact: true })).toBeVisible()
  await expect.element(page.getByRole('tab', { name: 'Timing', exact: true })).toHaveAttribute('aria-selected', 'true')
  await assistant.click()
  await page.getByRole('tab', { name: 'Raw', exact: true }).click()
  const raw = page.getByRole('tabpanel', { name: 'Raw', exact: true })
  await expect.element(raw.getByText('Block #1 thinking', { exact: true })).toBeVisible()
  await raw.getByRole('button', { name: 'Open Block #2 tool call summary', exact: true }).click()
  await expect.element(page.getByRole('tab', { name: 'Payload', exact: true })).toBeVisible()
  await expect.element(page.getByRole('tab', { name: 'Summary', exact: true })).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('tab', { name: 'Result', exact: true }).click()
  await expect.element(page.getByRole('region', { name: 'Raw result', exact: true }).getByRole('heading', { name: 'Raw result', exact: true })).toBeVisible()
  await expect
    .element(page.getByRole('region', { name: 'Rendered result', exact: true }).getByRole('heading', { name: 'Rendered result', exact: true }))
    .toBeVisible()
})

it('uses the Harness compacted Summary and Raw views without a nonfunctional Preview tab', async () => {
  const fixture = harnessLedger()
  fixture.entries.push(
    record(
      'compaction',
      {
        summary: '## Compacted summary\n\nRetained **facts**.',
        firstKeptSeq: fixture.entries[0]!.seq,
        tokensBefore: 1000,
        tokensAfter: 100,
        trigger: 'manual',
        readFiles: [],
        modifiedFiles: [],
      },
      'harness-run',
    ),
  )
  await open(fixture.trace, fixture.entries)
  await page.getByRole('row', { name: /COMPACTED:/ }).click()
  const inspector = page.getByRole('complementary', { name: 'Event details', exact: true })
  await expect.element(inspector.getByRole('heading', { name: 'Compacted summary', exact: true })).toBeVisible()
  await expect.element(inspector.getByRole('tab', { name: 'Preview', exact: true })).not.toBeInTheDocument()
  await inspector.getByRole('tab', { name: 'Raw Output', exact: true }).click()
  await expect.element(inspector.getByText('## Compacted summary\n\nRetained **facts**.', { exact: true })).toBeVisible()
})

it('Harness parity: double-click folds assistant calls or the whole turn into keyboard-expandable summary rows', async () => {
  await page.viewport(1440, 900)
  const fixture = harnessLedger()
  await open(fixture.trace, fixture.entries)
  const assistant = page.getByRole('row', { name: /ASSISTANT: Inspect the workspace before changing files/ })
  await assistant.dblClick()
  await expect.element(page.getByRole('row', { name: /Collapsed assistant.*1 tool call.*bash/i })).toBeVisible()
  expect(rows().some((row) => row.dataset.toolCallId === 'harness-call')).toBe(false)
  await page.getByRole('row', { name: /Collapsed assistant/i }).click()
  await expect.element(page.getByRole('row', { name: /TOOL: bash/ })).toBeVisible()
  const user = page.getByRole('row', { name: 'USER: Inspect the workspace', exact: true })
  await user.dblClick()
  await expect.element(user).toBeVisible()
  const summary = page.getByRole('row', { name: /Collapsed turn.*2 steps.*1 tool call/i })
  await expect.element(summary).toBeVisible()
  expect(Math.round(summary.element().getBoundingClientRect().height)).toBe(20)
  summary.element().focus()
  await userEvent.keyboard('{Enter}')
  await expect.element(assistant).toBeVisible()
})

it('Harness parity: changed prompts open Diff and context opens its own rendered content', async () => {
  await page.viewport(1440, 900)
  const fixture = harnessLedger()
  fixture.trace.state.response.runs[0]!.requests[1]!.snapshot!.system += '\nUse the changed workspace rule.'
  fixture.entries.push(record('state_update', { name: 'date', value: { date: '2026-11-06', weekday: 'Friday' } }, 'harness-run'))
  await open(fixture.trace, fixture.entries)
  await page.getByRole('row', { name: /SYSTEM: System Prompt Updated/ }).click()
  await expect.element(page.getByRole('tab', { name: 'Diff', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect.element(page.getByText('+Use the changed workspace rule.', { exact: true })).toBeVisible()
  await page.getByRole('row', { name: /CONTEXT:.*2026-11-06/ }).click()
  const inspector = page.getByRole('complementary', { name: 'Event details' })
  await expect.element(inspector.getByText(/2026-11-06/)).toBeVisible()
  await expect.element(page.getByRole('tab', { name: 'Preview', exact: true })).toBeVisible()
})

it('shows the exact request system, messages and complete tool catalog, and opens the tool Schema from that request', async () => {
  await page.viewport(1440, 900)
  const snapshot = {
    system: '## Captured system\n<instructions>Use the original workspace rules.</instructions>\nEND-OF-SYSTEM',
    messages: [{ role: 'user', content: 'Exact sent message END-OF-MESSAGE', timestamp: 1 }],
    tools: [
      { name: 'bash', description: 'Captured bash definition', parameters: { type: 'object', properties: { command: { type: 'string' } } } },
      { name: 'unused_tool', description: 'This tool was available but never called', parameters: { type: 'object', properties: {} } },
    ],
  }
  const request = { ...run('run-1').requests[0]!, requestId: 'snapshot-request', snapshot }
  await open(fakeTrace(response([run('run-1', { requests: [request] })])))
  await expect.poll(() => rows().some((row) => row.dataset.kind === 'system')).toBe(true)
  const system = rows().find((row) => row.dataset.kind === 'system')
  expect(system).not.toBeUndefined()
  await page.elementLocator(system!).click()
  await page.getByRole('tab', { name: 'System Prompt', exact: true }).click()
  await expect.element(page.getByRole('tabpanel', { name: 'System Prompt', exact: true }).getByRole('heading', { name: 'Captured system' })).toBeVisible()
  await expect.element(page.getByText(/<instructions>Use the original workspace rules/)).toBeVisible()
  await page.getByRole('tab', { name: 'Tools', exact: true }).click()
  await expect.element(page.getByText('unused_tool', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Close details', exact: true }).click()
  const tool = rows().find((row) => row.dataset.toolCallId === 'run-1-c1')!
  await page.elementLocator(tool).click()
  await page.getByRole('tab', { name: 'Schema', exact: true }).click()
  await expect.element(page.getByText('Captured bash definition', { exact: true })).toBeVisible()
  const copied = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
  try {
    const tree = page.getByRole('tree', { name: 'bash parameters JSON', exact: true }).element()
    await page.elementLocator(tree.previousElementSibling!).hover()
    await page.getByRole('button', { name: 'Copy pretty JSON', exact: true }).first().click()
    expect(copied).toHaveBeenCalledWith(JSON.stringify(snapshot.tools[0]!.parameters, null, 2))
    await page.elementLocator(tree.querySelector('[role="treeitem"]')!).hover()
    await page.getByRole('button', { name: 'Copy value', exact: true }).click({ button: 'right' })
    await expect.element(page.getByRole('menu')).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await expect.element(page.getByRole('menu')).not.toBeInTheDocument()
    await expect.element(page.getByRole('complementary', { name: 'Event details', exact: true })).toBeVisible()
    await expect.element(page.getByRole('tab', { name: 'Schema', exact: true })).toHaveAttribute('aria-selected', 'true')
  } finally {
    copied.mockRestore()
  }
})

it('marks old requests without snapshots as unrecorded, independently of empty captured inputs', async () => {
  await open(fakeTrace(response([run('run-1')])))
  await page.getByRole('button', { name: 'Request #1', exact: true }).click()
  await page.getByRole('tab', { name: 'Options', exact: true }).click()
  await expect.element(page.getByText('No snapshot was recorded for this request.', { exact: true })).toBeVisible()
})

it('hides standalone title request nodes and COKO_SESSION_TITLE content from the ledger and timeline', async () => {
  const request = {
    ...run('run-1').requests[0]!,
    requestId: 'title-request',
    runId: null,
    purpose: 'title',
    snapshot: { system: 'Captured title system', messages: [{ role: 'user', content: 'COKO_SESSION_TITLE' }], tools: [] },
  }
  await open(fakeTrace(response([])), [record('model_request', request, null)])
  expect(rows()).toHaveLength(0)
  expect(document.querySelectorAll('[data-timeline-span]')).toHaveLength(0)
  await expect.element(page.getByRole('button', { name: 'Request #1', exact: true })).not.toBeInTheDocument()
  expect(document.body.textContent).not.toContain('COKO_SESSION_TITLE')
  expect(request.snapshot.messages[0]?.content).toBe('COKO_SESSION_TITLE')
})

it('shows captured empty system and tools distinctly from missing historical snapshots', async () => {
  const request = { ...run('run-1').requests[0]!, snapshot: { system: '', messages: [], tools: [] } }
  await open(fakeTrace(response([run('run-1', { requests: [request] })])))
  await page.getByRole('row', { name: /SYSTEM: Initial System Prompt/ }).click()
  await page.getByRole('tab', { name: 'System Prompt', exact: true }).click()
  await expect.element(page.getByText('No system prompt in this request', { exact: true })).toBeVisible()
  await page.getByRole('tab', { name: 'Tools', exact: true }).click()
  await expect.element(page.getByText('No tools in this request', { exact: true })).toBeVisible()
})

it('places trajectory in the main header, removes its sidebar entry and preserves chat and trajectory state across tab changes', async () => {
  await page.viewport(1440, 900)
  await open(fakeTrace(response([run('run-1')])))
  const tabs = page.getByRole('tablist', { name: 'Conversation', exact: true })
  expect(
    tabs
      .getByRole('tab')
      .all()
      .map((tab) => tab.element().textContent),
  ).toEqual(['Conversation', 'Trajectory'])
  await expect.element(page.getByRole('button', { name: 'Open sidebar', exact: true })).toBeVisible()
  await tabs.getByRole('tab', { name: 'Conversation', exact: true }).click()
  const editor = page.getByRole('textbox', { name: 'Give Coko a task' })
  await editor.fill('retained draft')
  const editorNode = editor.element()
  const scrollport = document.querySelector<HTMLElement>('.conversation-message-scroll')!
  scrollport.scrollTop = 0
  scrollport.dispatchEvent(new Event('scroll'))
  await page.getByRole('button', { name: 'Open sidebar', exact: true }).click()
  const sidebar = page.getByRole('region', { name: 'Sidebar', exact: true })
  await expect.element(sidebar.getByRole('button', { name: 'Trajectory', exact: true })).not.toBeInTheDocument()
  await sidebar.getByRole('button', { name: 'Plan', exact: true }).click()
  const layout = getRightPanelLayout('s-1')
  await tabs.getByRole('tab', { name: 'Trajectory', exact: true }).click()
  const search = page.getByRole('searchbox', { name: 'Search trajectory' })
  await search.fill('sidebar.tsx')
  const trajectory = document.querySelector('[data-slot="trajectory-panel"]')!
  await tabs.getByRole('tab', { name: 'Conversation', exact: true }).click()
  expect(document.querySelector('.conversation-message-scroll')).toBe(scrollport)
  expect(scrollport.scrollTop).toBe(0)
  expect(editor.element()).toBe(editorNode)
  await expect.element(editor).toHaveTextContent('retained draft')
  await tabs.getByRole('tab', { name: 'Trajectory', exact: true }).click()
  expect(document.querySelector('[data-slot="trajectory-panel"]')).toBe(trajectory)
  await expect.element(search).toHaveValue('sidebar.tsx')
  inspectTrajectory('s-1', 'call-edit')
  await expect.poll(() => document.activeElement?.getAttribute('data-tool-call-id')).toBe('call-edit')
  expect(getRightPanelLayout('s-1')).toBe(layout)
})

it('supports keyboard view selection and remembers the selected main view per Session', async () => {
  const fixture = await open(fakeTrace(response([])))
  const tabs = page.getByRole('tablist', { name: 'Conversation', exact: true })
  const chat = tabs.getByRole('tab', { name: 'Conversation', exact: true })
  const trajectory = tabs.getByRole('tab', { name: 'Trajectory', exact: true })
  await chat.click()
  chat.element().focus()
  await userEvent.keyboard('{ArrowRight}')
  await expect.element(trajectory).toHaveFocus()
  await expect.element(chat).toHaveAttribute('aria-selected', 'true')
  await userEvent.keyboard('{Enter}')
  await expect.element(trajectory).toHaveAttribute('aria-selected', 'true')
  fixture.chat.getState().openSession('s-3')
  await expect.element(chat).toHaveAttribute('aria-selected', 'true')
  fixture.chat.getState().openSession('s-1')
  await expect.element(trajectory).toHaveAttribute('aria-selected', 'true')
})

it('renders the Harness toolbar, three-lane timeline and chronological ledger; keyboard opens tool input/output and timing', async () => {
  await page.viewport(1440, 900)
  const trace = fakeTrace(response([run('run-1')]))
  await open(trace)
  await expect.element(page.getByRole('toolbar', { name: 'Trajectory toolbar' })).toBeVisible()
  await expect.poll(() => document.querySelectorAll('[data-timeline-span]').length).toBeGreaterThan(0)
  expect(rows()[0]!.dataset.kind).toBe('system')
  const tool = rows().find((row) => row.dataset.toolCallId === 'run-1-c1')!
  tool.focus()
  await userEvent.keyboard('{Enter}')
  await expect.element(page.getByRole('complementary', { name: 'Event details' })).toBeVisible()
  await page.getByRole('tab', { name: 'Timing', exact: true }).click()
  await expect.element(page.getByText('1.50 s', { exact: true })).toBeVisible()
  await expect.element(page.getByText('Session timestamps (running)', { exact: true })).toBeVisible()
  await expect.element(page.getByText('Allowed', { exact: true })).toBeVisible()
  await page.getByRole('tab', { name: 'Summary', exact: true }).click()
  await expect.element(page.getByText('PreToolUse', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Close details' }).click()
  expect(document.querySelector('aside[aria-label="Event details"]')).toBeNull()
})

it('searches payload and output; folds turns/calls; Inspect clears filters, unfolds and focuses the exact tool repeatedly', async () => {
  const trace = fakeTrace(response([run('run-1')]))
  await open(trace)
  const search = page.getByRole('searchbox', { name: 'Search trajectory' })
  await search.fill('src/sidebar.tsx')
  await expect.poll(() => rows().map((row) => row.dataset.toolCallId)).toEqual(['call-edit'])
  await search.fill('no-such-record')
  await expect.element(page.getByText('No matching records')).toBeVisible()
  await page.getByRole('button', { name: 'Collapse turns', exact: true }).click()
  inspectTrajectory('s-1', 'call-edit')
  await expect.poll(() => document.querySelector<HTMLElement>('[data-record-id][data-selected="true"]')?.dataset.toolCallId).toBe('call-edit')
  await expect.element(search).toHaveValue('')
  const selected = document.querySelector<HTMLElement>('[data-record-id][data-selected="true"]')!
  await expect.poll(() => document.activeElement === selected).toBe(true)
  await page.getByRole('tab', { name: 'Payload', exact: true }).click()
  await expect.element(page.getByText('"src/sidebar.tsx"', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Close details' }).click()
  inspectTrajectory('s-1', 'call-edit')
  await expect.element(page.getByRole('complementary', { name: 'Event details' })).toBeVisible()
  expect(trajectoryInspectStore.getState().requests['s-1']).toBeUndefined()
})

it('entry changes coalesce reads per frame and preserve selection when a new Run arrives', async () => {
  const trace = fakeTrace(response([run('run-1')]))
  const fixture = await open(trace)
  await expect.poll(() => trace.state.reads).toBe(1)
  inspectTrajectory('s-1', 'call-edit')
  await expect.poll(() => document.querySelector('[data-selected="true"]')?.getAttribute('data-tool-call-id')).toBe('call-edit')
  await frames()
  const before = trace.state.reads
  trace.state.response = response([run('run-1'), run('run-2')])
  fixture.sendServer({ type: 'entry', sessionId: 's-1', entry: record('run_start', { trigger: 'submit' }, 'run-2') })
  fixture.sendServer({ type: 'entry', sessionId: 's-1', entry: record('model_request', run('run-2').requests[0], 'run-2') })
  fixture.sendServer({ type: 'entry', sessionId: 's-1', entry: record('run_end', { status: 'completed' }, 'run-2') })
  await expect.poll(() => rows().some((row) => row.dataset.toolCallId === 'run-2-c1')).toBe(true)
  await frames()
  expect(trace.state.reads - before).toBe(1)
  expect(document.querySelector('[data-selected="true"]')?.getAttribute('data-tool-call-id')).toBe('call-edit')
})

it('Inspect scrolls a virtualized ledger to an offscreen historical call', async () => {
  const tools = Array.from({ length: 500 }, (_, index) => ({ toolCallId: `history-${index}`, name: 'read', startedAt: index + 10, durationMs: 1, hooks: [] }))
  await open(fakeTrace(response([run('run-1', { tools })])))
  await expect.poll(() => document.querySelectorAll('[data-record-id]').length).toBeLessThan(200)
  inspectTrajectory('s-1', 'history-250')
  await expect.poll(() => document.querySelector('[data-record-id][data-selected="true"]')?.getAttribute('data-tool-call-id')).toBe('history-250')
  await expect.poll(() => document.activeElement?.getAttribute('data-tool-call-id')).toBe('history-250')
})

it.each([150, 300])('folded assistant summaries keep %i-row ledger navigation aligned', async (count) => {
  const entries = Array.from({ length: count }, (_, index) => [
    record(
      'message',
      { role: 'assistant', content: [{ type: 'toolCall', id: `fold-${index}`, name: 'read', arguments: { path: String(index) } }], stopReason: 'toolUse' },
      'run-1',
    ),
    record('message', { role: 'toolResult', toolCallId: `fold-${index}`, toolName: 'read', content: [{ type: 'text', text: 'ok' }], isError: false }, 'run-1'),
  ]).flat()
  await open(fakeTrace(response([run('run-1', { requests: [], tools: [] })])), entries)
  await page.getByRole('toolbar').getByRole('button', { name: 'Collapse calls', exact: true }).click()
  const tablePane = document.querySelector('table[aria-label="Trajectory"]')!.parentElement!
  const headerHeight = tablePane.querySelector('thead')!.getBoundingClientRect().height
  await expect.poll(() => tablePane.scrollHeight).toBe(Math.ceil(count * 50 + headerHeight))
  inspectTrajectory('s-1', `fold-${count - 5}`)
  await expect.poll(() => document.activeElement?.getAttribute('data-tool-call-id')).toBe(`fold-${count - 5}`)
  const target = document.activeElement!.getBoundingClientRect()
  const viewport = tablePane.getBoundingClientRect()
  expect(target.top).toBeGreaterThanOrEqual(viewport.top + 30)
  expect(target.bottom).toBeLessThanOrEqual(viewport.bottom)
})

it('image-only tool output retains its image and structured blocks in the Result inspector', async () => {
  const data = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='
  const entries = [
    record('message', { role: 'assistant', content: [{ type: 'toolCall', id: 'image-call', name: 'image', arguments: {} }], stopReason: 'toolUse' }, 'run-1'),
    record(
      'message',
      { role: 'toolResult', toolCallId: 'image-call', toolName: 'image', content: [{ type: 'image', mimeType: 'image/png', data }], isError: false },
      'run-1',
    ),
  ]
  await open(fakeTrace(response([run('run-1', { requests: [], tools: [] })])), entries)
  inspectTrajectory('s-1', 'image-call')
  await expect.element(page.getByRole('complementary', { name: 'Event details' })).toBeVisible()
  await page.getByRole('tab', { name: 'Result', exact: true }).click()
  await expect.poll(() => document.querySelector<HTMLImageElement>('aside[aria-label="Event details"] [data-tool-image]')?.naturalWidth).toBe(1)
  expect(document.querySelector('aside[aria-label="Event details"]')!.textContent).not.toContain('No output')
  await page.elementLocator(document.querySelector('aside[aria-label="Event details"] [data-action="open-image"]')!).click()
  await expect.poll(() => document.querySelector('[data-tool-image-dialog]')).not.toBeNull()
  await userEvent.keyboard('{Escape}')
  await expect.poll(() => document.querySelector('[data-tool-image-dialog]')).toBeNull()
})

it('导出：读取 ?children=1 的文本并交给下载，提示文件名；导出中按钮不可用', async () => {
  const trace = fakeTrace(response([run('run-1')]))
  await open(trace)
  await expect.poll(() => rows().length).toBeGreaterThan(0)
  const clicked: { download: string; href: string }[] = []
  const original = HTMLAnchorElement.prototype.click
  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    clicked.push({ download: this.download, href: this.href })
  }
  try {
    await page.getByRole('button', { name: 'Export' }).click()
    await expect.poll(() => clicked).toEqual([{ download: 'coko-session-s-1.ndjson', href: expect.stringMatching(/^blob:/) }])
  } finally {
    HTMLAnchorElement.prototype.click = original
  }
  expect(trace.state.exports).toEqual(['s-1'])
  await expect.element(page.getByText('Exported coko-session-s-1.ndjson')).toBeVisible()
})

it('读取失败：没有内容时为错误与重试；有内容时保留内容并显示紧凑提示', async () => {
  const trace = fakeTrace(response([]))
  trace.state.fail = true
  await open(trace)
  await expect.element(page.getByText('Couldn’t load the trace')).toBeVisible()
  trace.state.fail = false
  trace.state.response = response([run('run-1')])
  await page.getByRole('button', { name: 'Retry' }).click()
  await expect.poll(() => rows().length).toBeGreaterThan(0)
})

afterEach(async () => {
  trajectoryInspectStore.setState({ requests: {} })
  toast.dismiss()
  await vi.waitFor(() => {
    if (document.querySelector('[data-sonner-toast]')) throw new Error('toast still mounted')
  })
})
