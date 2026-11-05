// 恢复的首条已提交消息是工具声明时，检查实际送达模型的基础提示与工具声明。
import { getSystemMessageText, type Context, type SystemMessage } from '@earendil-works/pi-ai'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Type } from 'typebox'
import { createFauxModels, fauxAssistantMessage, fauxToolCall } from '../testing/faux.ts'
import { createTempWorkspace, type TempWorkspace } from '../testing/workspace.ts'
import { createToolRegistry } from '../tools/registry.ts'
import { createAgentRuntime, DEFAULT_SYSTEM_PROMPT, type AgentRuntimeOptions } from './runtime.ts'
import type { RunEntry } from './types.ts'

let ws: TempWorkspace
beforeEach(async () => {
  ws = await createTempWorkspace('coko-rebuild-')
})
afterEach(async () => {
  await ws.dispose()
})

function harness(options: Partial<Omit<AgentRuntimeOptions, 'models' | 'model'>> = {}) {
  const { faux, models, model } = createFauxModels()
  const entries: RunEntry[] = []
  const requests: Context[] = []
  const runtime = createAgentRuntime({
    models,
    model,
    cwd: ws.dir,
    commit: async (entry) => {
      entries.push(entry)
    },
    ...options,
  })
  const reply = (...messages: ReturnType<typeof fauxAssistantMessage>[]) =>
    faux.setResponses(
      messages.map((message) => (context: Context) => {
        requests.push(structuredClone(context))
        return message
      }),
    )
  return { runtime, entries, requests, reply }
}
const leadingOf = (context: Context) => context.messages[0] as SystemMessage

describe('runtime rebuild system prompt', () => {
  it.each([
    { name: '没有开头 system', prefix: [], expected: DEFAULT_SYSTEM_PROMPT + '\n\nCurrent instructions' },
    { name: '保留已有正文 system', prefix: [{ role: 'system' as const, content: 'Existing system prompt', timestamp: 1 }], expected: 'Existing system prompt' },
  ])('$name 的恢复行为保持不变', async ({ prefix, expected }) => {
    const h = harness({
      messages: [...prefix, { role: 'user', content: 'previous input', timestamp: 2 }, fauxAssistantMessage('previous answer')],
      context: { systemSections: async () => [{ name: 'instructions', text: 'Current instructions' }] },
    })
    h.reply(fauxAssistantMessage('done'))
    await h.runtime.run('next input')
    expect(getSystemMessageText(leadingOf(h.requests[0]!))).toBe(expected)
  })

  it.each([
    { name: 'string', content: '' },
    { name: 'blocks', content: [] },
  ])('只有 toolsRemoved 的开头声明仍按原顺序回放，基础提示只补一次（$name）', async ({ content }) => {
    const declaration: SystemMessage = { role: 'system', content, toolsRemoved: [{ name: 'removed_tool' }], timestamp: 1 }
    const h = harness({ tools: createToolRegistry(), messages: [declaration], context: { systemSections: async () => [] } })
    h.reply(fauxAssistantMessage('first'), fauxAssistantMessage('second'))
    await h.runtime.run('first input')
    await h.runtime.run('second input')
    for (const request of h.requests) {
      expect(getSystemMessageText(leadingOf(request))).toBe(DEFAULT_SYSTEM_PROMPT)
      expect(request.messages.filter((message) => message.role === 'system')).toEqual([
        expect.objectContaining({ content: DEFAULT_SYSTEM_PROMPT }),
        declaration,
      ])
    }
    expect(h.entries.some((entry) => entry.kind === 'message' && entry.payload.role === 'system')).toBe(false)
  })

  it.each([false, true])('工具声明作为首条已提交消息时，重建请求保留基础提示、Run sections 与工具（sections=%s）', async (sections) => {
    const tools = createToolRegistry()
    const initial = harness({ tools })
    // 宿主在构造与首次 Run 之间增加工具，pi 把变化作为首条消息提交。
    tools.register({
      name: 'late_tool',
      label: 'Late tool',
      description: 'A tool registered after runtime construction.',
      parameters: Type.Object({}),
      effect: 'read',
      async execute() {
        return { content: [{ type: 'text', text: 'late tool executed' }], details: undefined }
      },
    })
    initial.reply(fauxAssistantMessage('first'))
    await initial.runtime.run('first run')
    const restored = initial.entries.flatMap((entry) => (entry.kind === 'message' ? [entry.payload] : []))
    expect(restored[0]).toMatchObject({ role: 'system', content: '', toolsAdded: [{ name: 'late_tool' }] })

    const rebuilt = harness({
      tools,
      messages: restored,
      ...(sections ? { context: { systemSections: async () => [{ name: 'instructions', text: 'Current Run instructions' }] } } : {}),
    })
    rebuilt.reply(fauxAssistantMessage(fauxToolCall('late_tool', {}, { id: 'late-1' }), { stopReason: 'toolUse' }), fauxAssistantMessage('done'))
    expect((await rebuilt.runtime.run('after rebuild')).status).toBe('completed')
    const messages = rebuilt.requests[0]!.messages
    expect(getSystemMessageText(leadingOf(rebuilt.requests[0]!))).toBe(DEFAULT_SYSTEM_PROMPT + (sections ? '\n\nCurrent Run instructions' : ''))
    expect(messages.slice(1, 1 + restored.length)).toEqual(restored)
    expect(
      messages
        .filter((message) => message.role === 'system')
        .flatMap((message) => message.toolsAdded ?? [])
        .map((tool) => tool.name),
    ).toEqual(['late_tool'])
    expect(rebuilt.entries.some((entry) => entry.kind === 'message' && entry.payload.role === 'toolResult' && !entry.payload.isError)).toBe(true)
  })
})
