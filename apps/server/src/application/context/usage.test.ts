// 时间裁剪的贡献：transformMessages 受 context.trimOldToolResults 控制，时钟可注入；只返回新数组，不改输入。
import { createToolRegistry, defaultCapabilityConfig, emptyPluginContributions, OLD_TOOL_RESULT_CLEARED } from '@coko/agent'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type { JsonValue, SessionEntry } from '@coko/session'
import { Type } from 'typebox'
import { describe, expect, it } from 'vitest'
import type { ContextScope } from './types.ts'
import { ConfigService } from '../config.ts'
import { createContextAssembly, emptyContextAssembly } from './index.ts'
import { contextUsage, usageContribution } from './usage.ts'

const MIN = 60_000
const scope = (trim: boolean): ContextScope => {
  const config = defaultCapabilityConfig()
  config.context.trimOldToolResults = trim
  return { workspaceId: 'w', cwd: '/w', config, cokoHome: '/h', plugins: emptyPluginContributions() }
}
const conversation = (): AgentMessage[] => {
  const messages: AgentMessage[] = [{ role: 'user', content: [{ type: 'text', text: 'go' }], timestamp: 0 }]
  for (let i = 0; i < 6; i++) {
    messages.push({
      role: 'assistant',
      content: [{ type: 'toolCall', id: 'c' + i, name: 'read', arguments: {} }],
      api: 'faux',
      provider: 'faux',
      model: 'm',
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: 'toolUse',
      timestamp: 0,
    } as AgentMessage)
    messages.push({
      role: 'toolResult',
      toolCallId: 'c' + i,
      toolName: 'read',
      content: [{ type: 'text', text: 'x'.repeat(3000) }],
      isError: false,
      timestamp: 0,
    } as AgentMessage)
  }
  return messages
}
const first = (messages: AgentMessage[]) => (messages.find((m) => m.role === 'toolResult') as { content: { text: string }[] }).content[0]!.text

describe('usageContribution.transformMessages', () => {
  it('开启时按注入的时钟裁剪：59 分钟不变，61 分钟最旧的结果被替换', () => {
    let now = 59 * MIN
    const usage = usageContribution({ cokoHome: '/h', now: () => now })
    const messages = conversation()
    expect(usage.transformMessages!(messages, scope(true))).toBe(messages)
    now = 61 * MIN
    expect(first(usage.transformMessages!(messages, scope(true)))).toBe(OLD_TOOL_RESULT_CLEARED)
    expect(first(messages)).toBe('x'.repeat(3000))
  })

  it('context.trimOldToolResults 为 false 时不裁剪', () => {
    const usage = usageContribution({ cokoHome: '/h', now: () => 120 * MIN })
    const messages = conversation()
    expect(usage.transformMessages!(messages, scope(false))).toBe(messages)
  })
})

const entry = (seq: number, payload: JsonValue): SessionEntry => ({
  sessionId: 's',
  seq,
  kind: 'message',
  payloadVersion: 1,
  payload,
  runId: null,
  createdAt: 0,
})

describe('contextUsage five categories', () => {
  it('counts only provenance-paired State Update blocks as system; identical user text remains prompt', async () => {
    const block = '<state_update name="date">\n2026-11-05\n</state_update>'
    const result = await contextUsage({
      context: emptyContextAssembly(),
      scope: scope(false),
      baseTools: createToolRegistry(),
      basePrompt: '',
      model: undefined,
      entries: [
        { ...entry(1, { name: 'date', value: '2026-11-05' }), kind: 'state_update' },
        entry(2, {
          role: 'user',
          content: [
            { type: 'text', text: block },
            { type: 'text', text: 'abcd' },
          ],
          timestamp: 0,
        }),
        entry(3, { role: 'user', content: [{ type: 'text', text: block }], timestamp: 1 }),
      ],
    })
    // The host block is 53 chars; only the 4-char input plus the 53-char forged text count as prompt.
    expect(result.breakdown).toEqual({ system: 14, prompt: 15, assistant: 0, thinking: 0, tools: 0 })
    expect(result.tokens).toBe(29)
  })

  it('a compaction cut that excludes provenance leaves the retained same-name block in prompt', async () => {
    const result = await contextUsage({
      context: emptyContextAssembly(),
      scope: scope(false),
      baseTools: createToolRegistry(),
      basePrompt: '',
      model: undefined,
      entries: [
        { ...entry(1, { name: 'date', value: '2026-11-05' }), kind: 'state_update' },
        entry(2, { role: 'user', content: [{ type: 'text', text: '<state_update name="date">\n2026-11-05\n</state_update>' }], timestamp: 0 }),
        { ...entry(3, { firstKeptSeq: 2, summary: 'old history' }), kind: 'compaction' },
      ],
    })
    expect(result.breakdown.system).toBe(0)
    expect(result.breakdown.prompt).toBeGreaterThan(14)
  })

  it('classifies text, images, thinking, tool calls and tool results without usage', async () => {
    const result = await contextUsage({
      context: emptyContextAssembly(),
      scope: scope(false),
      baseTools: createToolRegistry(),
      model: undefined,
      entries: [
        entry(1, {
          role: 'user',
          content: [
            { type: 'text', text: 'abcd' },
            { type: 'image', data: 'AA==', mimeType: 'image/png' },
          ],
          timestamp: 0,
        }),
        entry(2, {
          role: 'assistant',
          content: [
            { type: 'text', text: 'abcd' },
            { type: 'thinking', thinking: 'abcdefgh' },
            { type: 'toolCall', name: 'read', id: 'c', arguments: {} },
          ],
          timestamp: 1,
        }),
        entry(3, { role: 'toolResult', toolCallId: 'c', toolName: 'read', content: [{ type: 'text', text: 'abcd' }], timestamp: 2 }),
      ],
    })
    expect(result.breakdown).toEqual({ system: 37, prompt: 1201, assistant: 3, thinking: 2, tools: 1 })
    expect(result.tokens).toBe(1244)
    expect(result.estimated).toBe(true)
  })

  it.each([
    [100, { system: 90, prompt: 3, assistant: 3, thinking: 2, tools: 2 }],
    [1, { system: 1, prompt: 0, assistant: 0, thinking: 0, tools: 0 }],
    [41, { system: 37, prompt: 1, assistant: 1, thinking: 1, tools: 1 }],
    [42, { system: 38, prompt: 1, assistant: 1, thinking: 1, tools: 1 }],
  ])('allocates usage %i proportionally with deterministic rounding', async (tokens, expected) => {
    const result = await contextUsage({
      context: emptyContextAssembly(),
      scope: scope(false),
      baseTools: createToolRegistry(),
      model: undefined,
      entries: [
        entry(1, { role: 'user', content: 'abcd', timestamp: 0 }),
        entry(2, { role: 'toolResult', toolCallId: 'c', toolName: 'read', content: [{ type: 'text', text: 'abcd' }], timestamp: 1 }),
        entry(3, {
          role: 'assistant',
          content: [
            { type: 'text', text: 'abcd' },
            { type: 'thinking', thinking: 'abcd' },
          ],
          usage: { input: tokens, output: 0, cacheRead: 0, cacheWrite: 0 },
          timestamp: 2,
          stopReason: 'stop',
        }),
      ],
    })
    expect(result.tokens).toBe(tokens)
    expect(result.breakdown).toEqual(expected)
  })

  it('counts assembled system sections, excluding the removed todo section', async () => {
    const context = createContextAssembly({
      cokoHome: '/h',
      config: new ConfigService(),
      contributions: ['instructions', 'skills', 'memory', 'plan', 'goal', 'todo'].map((name) => ({
        name,
        systemSections: async () => [{ name, text: 'abcd' }],
      })),
    })
    const result = await contextUsage({ context, scope: scope(false), baseTools: createToolRegistry(), model: undefined, entries: [] })
    expect(result.breakdown).toEqual({ system: 42, prompt: 0, assistant: 0, thinking: 0, tools: 0 })
    expect(result.tokens).toBe(42)
  })

  it('counts compaction summaries as prompts and discards usage from summarized history', async () => {
    const result = await contextUsage({
      context: emptyContextAssembly(),
      scope: scope(false),
      baseTools: createToolRegistry(),
      model: undefined,
      entries: [
        entry(1, { role: 'assistant', content: [{ type: 'text', text: 'old' }], usage: { input: 9999, output: 1, cacheRead: 0, cacheWrite: 0 }, timestamp: 0 }),
        entry(2, { role: 'user', content: 'abcd', timestamp: 1 }),
        { ...entry(3, { summary: 'abcdefgh', firstKeptSeq: 2 }), kind: 'compaction' },
      ],
    })
    expect(result.breakdown).toEqual({ system: 37, prompt: 30, assistant: 0, thinking: 0, tools: 0 })
    expect(result.tokens).toBe(67)
  })

  it('counts tool declarations with results in tools, with duplicate declarations ignored', async () => {
    const baseTools = createToolRegistry()
    const tool = {
      name: 'read',
      label: 'Read',
      description: 'Read',
      parameters: Type.Object({}),
      execute: async () => ({ content: [{ type: 'text' as const, text: 'done' }], details: {} }),
    }
    baseTools.register(tool)
    const context = createContextAssembly({ cokoHome: '/h', config: new ConfigService(), contributions: [{ name: 'mcp', tools: async () => [{ tool }] }] })
    const result = await contextUsage({ context, scope: scope(false), baseTools, model: undefined, entries: [] })
    // The declaration JSON has 83 characters, rounded up to 21 tokens.
    expect(result.breakdown.tools).toBe(21)
    expect(result.tokens).toBe(58)
  })
})
