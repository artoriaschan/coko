import { expect, it } from 'vitest'
import type { RunTrace, SessionEntry } from '@coko/protocol'
import { buildTrajectory } from './trajectory-record.ts'

const usage = { input: 10, output: 3, cacheRead: 0, cacheWrite: 0, total: 13 }
const run: RunTrace = {
  runId: 'r',
  trigger: 'submit',
  startedAt: 100,
  status: 'completed',
  durationMs: 500,
  requests: [
    { runId: 'r', provider: 'faux', model: 'model', startedAt: 100, durationMs: 10, purpose: 'turn', usage, stopReason: 'toolUse', retries: 0 },
    { runId: 'r', provider: 'faux', model: 'model', startedAt: 120, durationMs: 10, purpose: 'turn', usage, stopReason: 'stop', retries: 0 },
  ],
  tools: [{ toolCallId: 'call', name: 'read', startedAt: 110, durationMs: 10, hooks: [] }],
  hooks: [],
  usage,
  tokens: 26,
  cost: 0,
}
const entry = (seq: number, payload: unknown, runId: string | null = 'r'): SessionEntry =>
  ({
    sessionId: 's',
    seq,
    kind: 'message',
    payloadVersion: 1,
    payload,
    runId,
    createdAt: 100 + seq * 10,
  }) as SessionEntry
const entries = [
  entry(0, { role: 'user', content: 'Read a file', timestamp: 100 }, null),
  entry(1, {
    role: 'assistant',
    content: [
      { type: 'thinking', thinking: 'Inspect first' },
      { type: 'toolCall', id: 'call', name: 'read', arguments: { path: 'a.ts' } },
    ],
    timestamp: 110,
  }),
  entry(2, { role: 'toolResult', toolCallId: 'call', toolName: 'read', content: [{ type: 'text', text: 'file contents' }], isError: false, timestamp: 120 }),
  entry(3, { role: 'assistant', content: [{ type: 'text', text: 'Finished' }], timestamp: 130 }),
]

it('projects committed messages into a chronological ledger and attaches the exact call result and request usage', () => {
  const { cells, turns } = buildTrajectory(entries, [run])
  expect(cells.map((cell) => ({ id: cell.id, kind: cell.kind, turn: cell.turn, request: cell.requestNumber, text: cell.text }))).toEqual([
    { id: 'system:unrecorded', kind: 'system', turn: null, request: undefined, text: '' },
    { id: 'entry:0', kind: 'user', turn: 1, request: undefined, text: 'Read a file' },
    { id: 'entry:1', kind: 'message', turn: 1, request: 1, text: '' },
    { id: 'tool:call', kind: 'tool', turn: 1, request: undefined, text: 'read' },
    { id: 'entry:3', kind: 'message', turn: 1, request: 2, text: 'Finished' },
  ])
  expect(cells.find((cell) => cell.id === 'tool:call')).toMatchObject({
    input: { path: 'a.ts' },
    output: 'file contents',
    parentId: 'entry:1',
    timeSeconds: 0.01,
    rawResult: entries[2]!.payload,
  })
  expect(cells.find((cell) => cell.id === 'entry:1')).toMatchObject({ thinking: 'Inspect first', request: { usage } })
  expect(turns.find((turn) => turn.turn === 1)?.groups[0]?.cells).toHaveLength(4)
})

it('retains failed requests, incomplete tools and live output without duplicating committed calls', () => {
  const failed = { ...run.requests[0]!, requestId: 'failed', errorCode: 'network', stopReason: 'error' }
  const { cells } = buildTrajectory(
    entries.slice(0, 2),
    [{ ...run, requests: [failed, ...run.requests], tools: [{ ...run.tools[0]!, durationMs: undefined }] }],
    {
      runId: 'r',
      accepting: true,
      blocks: [{ kind: 'text', text: 'Still working' }],
      tools: { call: { toolCallId: 'call', toolName: 'read', args: { path: 'a.ts' }, status: 'running', partialResult: 'partial output' } },
    },
  )
  expect(cells.filter((cell) => cell.toolCallId === 'call')).toHaveLength(1)
  expect(cells.find((cell) => cell.toolCallId === 'call')).toMatchObject({ output: 'partial output', status: 'running', timeSeconds: null })
  expect(cells.find((cell) => cell.request?.requestId === 'failed')).toMatchObject({ isError: true, status: 'error' })
  expect(cells.find((cell) => cell.id === 'live:r')?.text).toBe('Still working')
})

it('retains each request snapshot, emits system/tool changes and binds schemas to the exact call request', () => {
  const snapshot = (description: string) => ({
    system: 'Same system prompt',
    messages: [],
    tools: [{ name: 'read', description, parameters: { type: 'object' } }],
  })
  const requests = run.requests.map((request, index) => ({
    ...request,
    requestId: `request-${index}`,
    snapshot: snapshot(index === 0 ? 'Original schema' : 'Changed schema'),
  }))
  const calls = [
    ...entries.slice(0, 3),
    entry(3, { role: 'assistant', content: [{ type: 'toolCall', id: 'second-call', name: 'read', arguments: { path: 'b.ts' } }], timestamp: 130 }),
  ]
  const { cells } = buildTrajectory(calls, [{ ...run, requests }])
  expect(cells.filter((cell) => cell.kind === 'system')).toHaveLength(2)
  expect(cells.find((cell) => cell.toolCallId === 'call')?.schema).toMatchObject({ description: 'Original schema' })
  expect(cells.find((cell) => cell.toolCallId === 'second-call')?.schema).toMatchObject({ description: 'Changed schema' })
  expect(cells.find((cell) => cell.id === 'entry:3')?.request?.snapshot).toBe(requests[1]!.snapshot)
})

it('hides detached title requests and their COKO_SESSION_TITLE input from the trajectory projection', () => {
  const request = {
    ...run.requests[0]!,
    requestId: 'title',
    runId: null,
    purpose: 'title' as const,
    snapshot: { system: 'Title system', messages: [{ role: 'user', content: 'COKO_SESSION_TITLE' }], tools: [] },
  }
  const { cells } = buildTrajectory([{ ...entry(1, request, null), kind: 'model_request', payload: request }], [])
  expect(cells).toEqual([])
  expect(request.snapshot.messages[0]?.content).toBe('COKO_SESSION_TITLE')
})

it('keeps auxiliary request snapshots out of conversation SYSTEM changes', () => {
  const snapshot = { system: 'Conversation system', messages: [], tools: [] }
  const compaction = { ...run.requests[0]!, purpose: 'compaction' as const, startedAt: 115, snapshot: { ...snapshot, system: 'Summarize history' } }
  const { cells } = buildTrajectory(entries, [{ ...run, requests: [{ ...run.requests[0]!, snapshot }, compaction, { ...run.requests[1]!, snapshot }] }])
  expect(cells.filter((cell) => cell.kind === 'system')).toHaveLength(1)
  expect(cells.find((cell) => cell.requestOnly && cell.request?.purpose === 'compaction')?.request?.snapshot?.system).toBe('Summarize history')
})

it('keeps failed assistant source blocks with their own attempt instead of consuming the next successful request', () => {
  const failed = { ...run.requests[0]!, requestId: 'failed', errorCode: 'model_error', stopReason: 'error' }
  const success = { ...run.requests[1]!, requestId: 'success' }
  const source = [
    { type: 'thinking', thinking: 'Partial reasoning' },
    { type: 'text', text: 'Partial output' },
  ]
  const { cells } = buildTrajectory(
    [
      entry(1, { role: 'assistant', content: source, stopReason: 'error' }),
      entry(2, { role: 'assistant', content: [{ type: 'text', text: 'Recovered' }], stopReason: 'stop' }),
    ],
    [{ ...run, requests: [failed, success], tools: [] }],
  )
  expect(cells.find((cell) => cell.id === 'entry:1')).toMatchObject({ request: { requestId: 'failed' }, sourceBlocks: source, isError: true })
  expect(cells.find((cell) => cell.id === 'entry:2')?.request?.requestId).toBe('success')
  expect(cells.filter((cell) => cell.requestOnly)).toHaveLength(0)
})

it('separates the static prompt from changing system sections and keeps the captured request intact', () => {
  const snapshot = (instructions: string) => ({
    system: `Static Coko prompt\n\n<environment>Workspace A</environment>\n\n${instructions}`,
    messages: [
      {
        role: 'system',
        content: '',
        timestamp: 0,
        sections: { 'coko.base': 'Static Coko prompt', environment: '<environment>Workspace A</environment>', instructions },
      },
    ],
    tools: [],
  })
  const requests = run.requests.map((request, index) => ({
    ...request,
    requestId: `section-${index}`,
    snapshot: snapshot(`<instructions>Rule ${index}</instructions>`),
  }))
  const { cells } = buildTrajectory(entries, [{ ...run, requests }])
  const systems = cells.filter((cell) => cell.kind === 'system')
  expect(systems).toHaveLength(1)
  expect(cells[0]).toMatchObject({ kind: 'system', turn: null, promptSnapshot: { system: 'Static Coko prompt' } })
  const contexts = cells.filter((cell) => cell.kind === 'context')
  expect(contexts.map((cell) => cell.text)).toEqual([
    '<environment>Workspace A</environment>',
    '<instructions>Rule 0</instructions>',
    '<instructions>Rule 1</instructions>',
  ])
  expect(contexts[0]!.index).toBeGreaterThan(cells.find((cell) => cell.kind === 'user')!.index)
  expect(contexts[0]!.index).toBeLessThan(cells.find((cell) => cell.id === 'entry:1')!.index)
  expect(requests[0]!.snapshot.system).toContain('<environment>')
  expect(systems[0]!.request?.snapshot).toBe(requests[0]!.snapshot)
})

it('renders the delivered state-update text after its user input without duplicating it as user content', () => {
  const injected = '<state_update name="date">\n{"date":"2026-11-06"}\n</state_update>'
  const user = entry(1, {
    role: 'user',
    content: [
      { type: 'text', text: injected },
      { type: 'text', text: 'My real question' },
    ],
    timestamp: 100,
  })
  const update: SessionEntry = { ...entry(0, {}), kind: 'state_update', payload: { name: 'date', value: { date: '2026-11-06' } } }
  const { cells } = buildTrajectory([update, user], [{ ...run, requests: [{ ...run.requests[0]!, startedAt: 115 }], tools: [] }])
  expect(cells.find((cell) => cell.kind === 'user')?.text).toBe('My real question')
  const context = cells.find((cell) => cell.kind === 'context')!
  expect(context.input).toBe(injected)
  expect(context.index).toBeGreaterThan(cells.find((cell) => cell.kind === 'user')!.index)
})

it('makes missing historical prompt data explicit instead of showing the current prompt as history', () => {
  const { cells } = buildTrajectory(entries, [run])
  expect(cells[0]).toMatchObject({ kind: 'system', promptMissing: true, turn: null })
  expect(cells[0]?.request?.snapshot).toBeUndefined()
})

it('shows the first available snapshot at its real request when earlier historical requests were not captured', () => {
  const { cells } = buildTrajectory(entries, [
    { ...run, requests: [run.requests[0]!, { ...run.requests[1]!, snapshot: { system: 'Only observed later', messages: [], tools: [] } }] },
  ])
  expect(cells[0]?.promptMissing).toBe(true)
  const recorded = cells.find((cell) => cell.promptChange === 'firstRecordedSystemPrompt')!
  expect(recorded.startedAt).toBe(120)
  expect(recorded.turn).toBe(1)
  expect(recorded.promptSnapshot?.system).toBe('Only observed later')
})

it('replays section removals and additions as context changes while retaining the base system prompt', () => {
  const snapshot = (sections: Record<string, string | null>) => ({
    system: 'Captured SDK prompt',
    messages: [{ role: 'system', content: '', sections, timestamp: 0 }],
    tools: [],
  })
  const { cells } = buildTrajectory(entries, [
    {
      ...run,
      requests: [
        { ...run.requests[0]!, snapshot: snapshot({ 'coko.base': 'Base', instructions: 'Old workspace rule' }) },
        { ...run.requests[1]!, snapshot: snapshot({ 'coko.base': 'Base', instructions: null, skills: 'Available skills' }) },
      ],
    },
  ])
  expect(cells.filter((cell) => cell.kind === 'system')).toHaveLength(1)
  expect(cells.find((cell) => cell.contextRemoved)).toMatchObject({
    kind: 'context',
    contextSection: 'instructions',
    input: { section: 'instructions', value: null },
  })
  expect(cells.find((cell) => cell.contextSection === 'skills')?.text).toBe('Available skills')
})
