import { pairedStateUpdates } from '@coko/agent/entries'
import type { HookTrace, ModelRequestPayload, RunTrace, SessionEntry, ToolTrace } from '@coko/protocol'
import type { Conversation } from '../../stores/chat-store.ts'
import type { TrajectoryTranslate } from './locales.ts'
import type { TrajectoryTurnModel } from './layout.ts'
import { snapshotContext, type SystemPromptSnapshot } from './snapshot-context.ts'

export type TrajectoryCellKind = 'system' | 'user' | 'context' | 'compacted' | 'message' | 'tool' | 'subtool'
export interface AssistantMetricDetail {
  timingRecorded: boolean
  stepStartTime: number
  firstTokenTime?: number
  completedTime: number | null
}
export interface TrajectoryCellProps {
  id: string
  index: number
  kind: TrajectoryCellKind
  text: string
  runId: string | null
  turn: number | null
  parentId?: string
  toolCallId?: string
  startedAt: number | null
  timeSeconds: number | null
  isError?: boolean
  requestOnly?: boolean
  assistantMetrics?: AssistantMetricDetail
  input?: unknown
  output?: unknown
  outputBlocks?: unknown
  /** Saved tool-result message or current SDK result; never synthesized from rendered text. */
  rawResult?: unknown
  thinking?: string
  sourceBlocks?: readonly unknown[]
  raw?: unknown
  request?: ModelRequestPayload
  requestNumber?: number
  requestStep?: number
  tool?: ToolTrace
  hook?: HookTrace
  schema?: unknown
  promptChange?: 'initialSystemPrompt' | 'systemPromptUpdated' | 'toolsUpdated' | 'systemPromptAndToolsUpdated' | 'firstRecordedSystemPrompt'
  previousSnapshot?: SystemPromptSnapshot
  promptSnapshot?: SystemPromptSnapshot
  promptMissing?: boolean
  contextSection?: string
  contextRemoved?: boolean
  sortPhase?: number
  status?: string
}

export function formatDurationMillis(value: number, t: TrajectoryTranslate): string {
  return t('unit.milliseconds', { value: Math.round(Math.max(0, value)).toLocaleString() })
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
export const stringify = (value: unknown): string => (typeof value === 'string' ? value : (JSON.stringify(value, null, 2) ?? ''))
function textContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map(record)
    .flatMap((block) => (typeof block?.text === 'string' ? [block.text] : []))
    .join('\n')
}

function resultOutput(content: unknown): unknown {
  const text = textContent(content)
  return text !== '' ? text : Array.isArray(content) && content.some((block) => record(block)?.type !== 'text') ? content : ''
}

/** Adapt Coko's committed ledger and live progress to the Harness timeline/ledger model. */
export function buildTrajectory(
  entries: readonly SessionEntry[],
  runs: readonly RunTrace[],
  live?: Conversation['live'],
): { cells: TrajectoryCellProps[]; turns: TrajectoryTurnModel[] } {
  const cells: TrajectoryCellProps[] = []
  const runNumbers = new Map(runs.map((run, i) => [run.runId, i + 1]))
  const toolMetrics = new Map(runs.flatMap((run) => run.tools.map((tool) => [tool.toolCallId, tool] as const)))
  const requests = [
    ...runs.flatMap((run) => run.requests),
    ...entries.flatMap((entry) => (entry.kind === 'model_request' && entry.payload.runId === null ? [entry.payload] : [])),
  ]
    .filter((request) => request.purpose !== 'title')
    .sort((a, b) => a.startedAt - b.startedAt)
  const stateUpdates = pairedStateUpdates(entries)
  const usedRequests = new Set<ModelRequestPayload>()
  const results = new Map(
    entries.flatMap((entry) => {
      const p = record(entry.payload)
      return entry.kind === 'message' && p?.role === 'toolResult' && typeof p.toolCallId === 'string' ? [[p.toolCallId, entry] as const] : []
    }),
  )
  const insert = (value: Omit<TrajectoryCellProps, 'index'>) => {
    const cell = { ...value, index: cells.length }
    cells.push(cell)
    return cell
  }
  const runOf = (entry: SessionEntry) =>
    entry.runId ??
    runs.findLast((run) => run.startedAt <= entry.createdAt && (run.durationMs === undefined || entry.createdAt <= run.startedAt + run.durationMs))?.runId ??
    runs.find((run) => run.startedAt >= entry.createdAt)?.runId ??
    null
  const users = new Map(entries.filter((entry) => entry.kind === 'message' && record(entry.payload)?.role === 'user').map((entry) => [entry.seq, entry]))
  const deliveries = new Map<number, { user: SessionEntry; text: string; request?: ModelRequestPayload }>()
  for (const [seq, pairs] of stateUpdates) {
    const user = users.get(seq)!
    const content = record(user.payload)?.content
    if (!Array.isArray(content)) continue
    for (const pair of pairs)
      deliveries.set(pair.entry.seq, {
        user,
        text: String(record(content[pair.blockIndex])?.text ?? ''),
        request: requests.find((request) => request.purpose === 'turn' && request.runId === runOf(user) && request.startedAt >= user.createdAt),
      })
  }
  for (const entry of entries) {
    const p = record(entry.payload)
    if (!p) continue
    const runId = runOf(entry)
    const base = { runId, turn: runId === null ? null : (runNumbers.get(runId) ?? null), startedAt: entry.createdAt, timeSeconds: null, raw: entry }
    if (entry.kind === 'message' && p.role === 'user') {
      const injected = new Set(stateUpdates.get(entry.seq)?.map((pair) => pair.blockIndex))
      const content = Array.isArray(p.content) ? p.content.filter((_, index) => !injected.has(index)) : p.content
      if (Array.isArray(content) && content.length === 0) continue
      insert({ ...base, id: `entry:${entry.seq}`, kind: 'user', text: textContent(content), input: content, status: 'completed' })
    } else if (entry.kind === 'message' && p.role === 'assistant' && Array.isArray(p.content)) {
      const blocks = p.content.map(record).filter((block) => block !== undefined)
      const text = blocks
        .filter((block) => block.type === 'text')
        .map((block) => String(block.text ?? ''))
        .join('\n')
      const thinking = blocks
        .filter((block) => block.type === 'thinking')
        .map((block) => String(block.thinking ?? ''))
        .join('\n')
      // Successful generation requests and assistant messages retain the same per-Run order.
      const failed = p.stopReason === 'error' || p.stopReason === 'aborted'
      const request = requests.find((req) => req.runId === runId && req.purpose === 'turn' && Boolean(req.errorCode) === failed && !usedRequests.has(req))
      if (request) usedRequests.add(request)
      const assistant = insert({
        ...base,
        id: `entry:${entry.seq}`,
        kind: 'message',
        text,
        output: text,
        thinking,
        sourceBlocks: p.content,
        ...(request
          ? {
              request,
              requestNumber: requests.indexOf(request) + 1,
              requestStep: requests.filter((req) => req.runId === runId && req.purpose === 'turn').indexOf(request) + 1,
              startedAt: request.startedAt,
              timeSeconds: request.durationMs / 1000,
              assistantMetrics: {
                timingRecorded: true,
                stepStartTime: request.startedAt,
                ...(request.ttftMs === undefined ? {} : { firstTokenTime: request.startedAt + request.ttftMs }),
                completedTime: request.startedAt + request.durationMs,
              },
            }
          : {}),
        isError: failed,
        status: failed ? 'error' : 'completed',
      })
      for (const block of blocks) {
        if (block.type !== 'toolCall' || typeof block.id !== 'string') continue
        const result = results.get(block.id)
        const payload = record(result?.payload)
        const metric = toolMetrics.get(block.id)
        const progress = live?.tools[block.id]
        insert({
          ...base,
          id: `tool:${block.id}`,
          kind: 'tool',
          parentId: assistant.id,
          requestStep: assistant.requestStep,
          toolCallId: block.id,
          text: String(block.name),
          input: block.arguments,
          output: payload ? resultOutput(payload.content) : progress?.partialResult,
          outputBlocks: payload?.content ?? record(progress?.result ?? progress?.partialResult)?.content,
          rawResult: payload ?? progress?.result,
          raw: { call: block, ...(result ? { result } : {}) },
          startedAt: metric?.startedAt ?? entry.createdAt,
          timeSeconds: metric?.durationMs === undefined ? (result ? Math.max(0, result.createdAt - entry.createdAt) / 1000 : null) : metric.durationMs / 1000,
          tool: metric,
          schema: request?.snapshot?.tools.find((tool) => record(tool)?.name === block.name),
          isError: payload?.isError === true || metric?.isError === true,
          status: result || metric?.durationMs !== undefined ? (payload?.isError || metric?.isError ? 'error' : 'completed') : 'running',
        })
      }
    } else if (entry.kind === 'compaction') {
      insert({ ...base, id: `entry:${entry.seq}`, kind: 'compacted', text: String(p.summary ?? ''), output: p.summary, status: 'completed' })
    } else if (entry.kind === 'state_update') {
      const delivery = deliveries.get(entry.seq)
      const text = delivery?.text ?? (textContent(p.content) || stringify(p))
      insert({
        ...base,
        id: `entry:${entry.seq}`,
        kind: 'context',
        text,
        input: delivery ? text : p,
        contextSection: typeof p.name === 'string' ? p.name : undefined,
        ...(delivery
          ? {
              startedAt: delivery.request?.startedAt ?? delivery.user.createdAt,
              sortPhase: 2,
              request: delivery.request,
              requestNumber: delivery.request ? requests.indexOf(delivery.request) + 1 : undefined,
            }
          : {}),
        status: 'completed',
      })
    }
  }
  // Trace retains requests and tool timing even when an old/partial ledger omits their messages.
  for (const request of requests) {
    if (usedRequests.has(request)) continue
    insert({
      id: `request:${request.requestId ?? `${request.runId}:${requests.indexOf(request)}`}`,
      kind: 'message',
      text: '',
      requestOnly: true,
      runId: request.runId,
      turn: request.runId === null ? null : (runNumbers.get(request.runId) ?? null),
      startedAt: request.startedAt,
      timeSeconds: request.durationMs / 1000,
      request,
      requestNumber: requests.indexOf(request) + 1,
      requestStep: request.runId === null ? undefined : requests.filter((req) => req.runId === request.runId && req.purpose === 'turn').indexOf(request) + 1,
      isError: Boolean(request.errorCode),
      status: request.errorCode ? 'error' : 'completed',
      raw: request,
    })
  }
  for (const run of runs) {
    for (const tool of run.tools) {
      if (cells.some((cell) => cell.toolCallId === tool.toolCallId)) continue
      const parent = cells.findLast((cell) => cell.runId === run.runId && cell.kind === 'message' && (cell.startedAt ?? 0) <= tool.startedAt)
      insert({
        id: `tool:${tool.toolCallId}`,
        kind: 'tool',
        text: tool.name,
        toolCallId: tool.toolCallId,
        parentId: parent?.id,
        runId: run.runId,
        turn: runNumbers.get(run.runId)!,
        startedAt: tool.startedAt,
        timeSeconds: tool.durationMs === undefined ? null : tool.durationMs / 1000,
        tool,
        schema: parent?.request?.snapshot?.tools.find((schema) => record(schema)?.name === tool.name),
        isError: tool.isError,
        status: tool.durationMs === undefined ? (run.status ?? 'running') : tool.isError ? 'error' : 'completed',
        raw: tool,
      })
    }
  }
  let previousPrompt: SystemPromptSnapshot | undefined
  let previousContexts: ReadonlyMap<string, string> = new Map()
  const firstRequest = requests.find((request) => request.purpose === 'turn')
  const missingInitial = firstRequest !== undefined && firstRequest.snapshot === undefined
  if (missingInitial)
    insert({ id: 'system:unrecorded', kind: 'system', text: '', runId: null, turn: null, startedAt: null, timeSeconds: null, promptMissing: true })
  for (const [index, request] of requests.entries()) {
    // Auxiliary requests keep their own inspector; they do not change the conversation's prompt state.
    if (request.purpose !== 'turn') continue
    const snapshot = request.snapshot
    if (!snapshot) continue
    const { prompt, contexts } = snapshotContext(snapshot)
    const turn = request.runId === null ? null : (runNumbers.get(request.runId) ?? null)
    for (const [name, text] of contexts) {
      if (previousContexts.get(name) === text) continue
      insert({
        id: `context:${request.requestId ?? index}:${name}`,
        kind: 'context',
        text,
        input: text,
        raw: { section: name, content: text },
        contextSection: name,
        request,
        requestNumber: index + 1,
        runId: request.runId,
        turn,
        startedAt: request.startedAt,
        timeSeconds: null,
        sortPhase: 1,
        status: 'completed',
      })
    }
    for (const name of previousContexts.keys())
      if (!contexts.has(name))
        insert({
          id: `context:${request.requestId ?? index}:${name}:removed`,
          kind: 'context',
          text: '',
          input: { section: name, value: null },
          raw: { section: name, value: null },
          contextSection: name,
          contextRemoved: true,
          request,
          requestNumber: index + 1,
          runId: request.runId,
          turn,
          startedAt: request.startedAt,
          timeSeconds: null,
          sortPhase: 1,
          status: 'completed',
        })
    previousContexts = contexts
    const systemChanged = previousPrompt?.system !== prompt.system
    const toolsChanged = JSON.stringify(previousPrompt?.tools) !== JSON.stringify(prompt.tools)
    if (!systemChanged && !toolsChanged) continue
    const initial = previousPrompt === undefined
    const promptChange = initial
      ? missingInitial
        ? 'firstRecordedSystemPrompt'
        : 'initialSystemPrompt'
      : systemChanged && toolsChanged
        ? 'systemPromptAndToolsUpdated'
        : systemChanged
          ? 'systemPromptUpdated'
          : 'toolsUpdated'
    const previousSnapshot = previousPrompt
    previousPrompt = prompt
    insert({
      id: `system:${request.requestId ?? index}`,
      kind: 'system',
      text: '',
      promptChange,
      previousSnapshot,
      promptSnapshot: prompt,
      input: prompt,
      raw: prompt,
      request,
      requestNumber: index + 1,
      runId: initial && !missingInitial ? null : request.runId,
      turn: initial && !missingInitial ? null : turn,
      startedAt: request.startedAt,
      timeSeconds: 0,
      status: 'completed',
    })
  }
  if (live) {
    const runId = live.runId
    let parent = cells.findLast((cell) => cell.runId === runId && cell.kind === 'message')
    const output = live.blocks
      .filter((block) => block.kind === 'text')
      .map((block) => block.text)
      .join('\n')
    const thinking = live.blocks
      .filter((block) => block.kind === 'thinking')
      .map((block) => block.text)
      .join('\n')
    if (output || thinking)
      parent = insert({
        id: `live:${runId}`,
        kind: 'message',
        text: output,
        output,
        thinking,
        runId,
        turn: runId ? (runNumbers.get(runId) ?? null) : null,
        startedAt: null,
        timeSeconds: null,
        status: 'running',
      })
    for (const tool of Object.values(live.tools)) {
      if (cells.some((cell) => cell.toolCallId === tool.toolCallId)) continue
      insert({
        id: `tool:${tool.toolCallId}`,
        kind: 'tool',
        text: tool.toolName,
        input: tool.args,
        output: tool.result ?? tool.partialResult,
        outputBlocks: record(tool.result ?? tool.partialResult)?.content,
        toolCallId: tool.toolCallId,
        parentId: parent?.id,
        runId,
        turn: runId ? (runNumbers.get(runId) ?? null) : null,
        startedAt: null,
        timeSeconds: null,
        status: tool.status === 'done' ? 'completed' : tool.status,
        isError: tool.status === 'error',
      })
    }
  }
  cells.sort(
    (a, b) =>
      Number(b.kind === 'system' && b.turn === null) - Number(a.kind === 'system' && a.turn === null) ||
      (a.turn ?? -1) - (b.turn ?? -1) ||
      (a.startedAt ?? Infinity) - (b.startedAt ?? Infinity) ||
      (a.sortPhase ?? (a.kind === 'system' || a.kind === 'user' ? 0 : 3)) - (b.sortPhase ?? (b.kind === 'system' || b.kind === 'user' ? 0 : 3)) ||
      a.index - b.index,
  )
  cells.forEach((cell, index) => {
    cell.index = index
  })
  const turns: TrajectoryTurnModel[] = []
  for (const cell of cells) {
    let turn = turns.at(-1)
    if (!turn || turn.turn !== cell.turn) {
      turn = { turn: cell.turn, groups: [{ title: '', cells: [] }] }
      turns.push(turn)
    }
    turn.groups[0]!.cells.push(cell)
  }
  return { cells, turns }
}
