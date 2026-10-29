// 时间裁剪的贡献（票 10）：transformMessages 受 context.trimOldToolResults 控制，时钟可注入；只返回新数组，不改输入。
import { defaultCapabilityConfig, OLD_TOOL_RESULT_CLEARED } from '@coko/agent'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { describe, expect, it } from 'vitest'
import type { ContextScope } from './types.ts'
import { usageContribution } from './usage.ts'

const MIN = 60_000
const scope = (trim: boolean): ContextScope => {
  const config = defaultCapabilityConfig()
  config.context.trimOldToolResults = trim
  return { workspaceId: 'w', cwd: '/w', config, cokoHome: '/h' }
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
