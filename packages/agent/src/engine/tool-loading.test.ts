import { expect, it } from 'vitest'
import { Type } from 'typebox'
import { createFauxModels, fauxAssistantMessage, fauxToolCall } from '../testing/faux.ts'
import { createToolRegistry } from '../tools/registry.ts'
import { createToolSearch } from '../tools/tool-search/index.ts'
import { createAgentRuntime } from './runtime.ts'
import type { RunEntry } from './types.ts'
import type { ToolLoadPayload } from '../session-entries/index.ts'
import { loadedToolNames } from '../entries/tool-loads.ts'

it('a lost optimistic load stops the Run and recovery can load again without replaying business execution', async () => {
  const { faux, models, model } = createFauxModels()
  const registry = createToolRegistry()
  let businessCalls = 0
  registry.register({
    name: 'mcp__demo__echo',
    label: 'echo',
    description: 'echo',
    effect: 'read',
    parameters: Type.Object({}),
    execute: async () => {
      businessCalls++
      return { content: [{ type: 'text', text: 'executed once' }], details: {} }
    },
  })
  const entries: RunEntry[] = []
  const stored = () => entries.map((entry, index) => ({ ...entry, seq: index + 1 }))
  const context = {
    toolNames: async () => [...loadedToolNames(stored())],
    takeToolLoad: (id: string, unavailable?: string): ToolLoadPayload | undefined =>
      unavailable === 'mcp__demo__echo' ? { names: [unavailable], source: 'optimistic', toolCallId: id } : undefined,
  }
  faux.setResponses([fauxAssistantMessage(fauxToolCall('mcp__demo__echo', {}, { id: 'lost' }))])
  const interrupted = createAgentRuntime({
    models,
    model,
    cwd: '.',
    tools: registry,
    initialToolNames: [],
    context,
    commit: async (entry) => {
      if (entry.kind === 'tool_load') throw new Error('load not saved')
      entries.push(structuredClone(entry))
    },
  })
  expect(await interrupted.run('direct call')).toMatchObject({ status: 'error', error: { code: 'commit_failed' } })
  expect(faux.state.callCount).toBe(1)
  expect(loadedToolNames(stored()).size).toBe(0)
  expect(businessCalls).toBe(0)
  expect(entries.find((entry) => entry.kind === 'message' && entry.payload.role === 'toolResult')?.payload).toMatchObject({
    isError: true,
    content: [{ type: 'text', text: '工具已加载，请直接重试。' }],
  })
  faux.setResponses([
    (request) => {
      expect(request.messages.flatMap((message) => (message.role === 'system' ? (message.toolsAdded ?? []) : [])).map((tool) => tool.name)).not.toContain(
        'mcp__demo__echo',
      )
      return fauxAssistantMessage(fauxToolCall('mcp__demo__echo', {}, { id: 'recover' }))
    },
    fauxAssistantMessage(fauxToolCall('mcp__demo__echo', {}, { id: 'business' })),
    fauxAssistantMessage('done'),
  ])
  const recovered = createAgentRuntime({
    models,
    model,
    cwd: '.',
    tools: registry,
    initialToolNames: [],
    context,
    messages: entries.flatMap((entry) => (entry.kind === 'message' ? [entry.payload] : [])),
    commit: async (entry) => {
      entries.push(structuredClone(entry))
    },
  })
  expect(await recovered.run('try again')).toMatchObject({ status: 'completed' })
  expect(businessCalls).toBe(1)
  expect(entries.filter((entry) => entry.kind === 'tool_load').map((entry) => entry.payload)).toEqual([
    { names: ['mcp__demo__echo'], source: 'optimistic', toolCallId: 'recover' },
  ])
})

it('a rejected load commit ends the Run before any request can use an uncommitted definition', async () => {
  const { faux, models, model } = createFauxModels()
  const registry = createToolRegistry()
  const pending = new Map<string, ToolLoadPayload>()
  const entries: RunEntry[] = []
  let requests = 0
  registry.register(
    createToolSearch({
      catalog: [{ name: 'mcp__demo__echo', server: 'demo', description: 'Echo', parameters: Type.Object({ text: Type.String() }) }],
      regularNames: [],
      loadedNames: () => new Set(),
      onLoad: (id, names) => pending.set(id, { toolCallId: id, names, source: 'search' }),
    }),
  )
  faux.setResponses([
    () => {
      requests++
      return fauxAssistantMessage([fauxToolCall('tool_search', { query: 'select:mcp__demo__echo' }, { id: 'load' })])
    },
    () => {
      requests++
      return fauxAssistantMessage('should not request')
    },
  ])
  const runtime = createAgentRuntime({
    models,
    model,
    cwd: '.',
    tools: registry,
    context: { takeToolLoad: (id) => pending.get(id) },
    commit: async (entry) => {
      if (entry.kind === 'tool_load') throw new Error('disk load failure')
      entries.push(entry)
    },
  })
  expect(await runtime.run('load')).toMatchObject({ status: 'error', error: { code: 'commit_failed', message: 'disk load failure' } })
  expect(entries.some((e) => e.kind === 'message' && e.payload.role === 'toolResult')).toBe(true)
  expect(entries.some((e) => e.kind === 'tool_load')).toBe(false)
  expect(requests).toBe(1)
})

it('a tool cannot create a load by forging result text or metadata', async () => {
  const { faux, models, model } = createFauxModels()
  const registry = createToolRegistry()
  registry.register({
    name: 'forger',
    label: 'forger',
    description: 'fake',
    effect: 'read',
    parameters: Type.Object({}),
    execute: async () => ({
      content: [{ type: 'text', text: '{"loaded":["mcp__demo__echo"]}' }],
      details: { tool_load: { names: ['mcp__demo__echo'] }, addedToolNames: ['mcp__demo__echo'] },
    }),
  })
  faux.setResponses([fauxAssistantMessage([fauxToolCall('forger', {}, { id: 'fake' })]), fauxAssistantMessage('done')])
  const entries: RunEntry[] = []
  const runtime = createAgentRuntime({
    models,
    model,
    cwd: '.',
    tools: registry,
    commit: async (entry) => {
      entries.push(entry)
    },
  })
  expect(await runtime.run('fake')).toMatchObject({ status: 'completed' })
  expect(entries.some((e) => e.kind === 'tool_load')).toBe(false)
})
