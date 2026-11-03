// 上下文用量：预算与阈值、Token 估算（最后一次 usage + 其后 chars/4）、时间裁剪（注入时钟）。
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { describe, expect, it } from 'vitest'
import { contextBudget, estimateContextTokens, estimateMessageChars, OLD_TOOL_RESULT_CLEARED, trimOldToolResults } from './index.ts'

const MIN = 60_000
const usage = (input: number, output: number, cacheRead = 0, cacheWrite = 0) => ({
  input,
  output,
  cacheRead,
  cacheWrite,
  totalTokens: input + output + cacheRead + cacheWrite,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
})
const user = (text: string, timestamp = 0): AgentMessage => ({ role: 'user', content: [{ type: 'text', text }], timestamp })
const assistant = (text: string, timestamp = 0, u = usage(0, 0), stopReason: 'stop' | 'error' | 'aborted' | 'toolUse' = 'stop'): AgentMessage =>
  ({ role: 'assistant', content: [{ type: 'text', text }], api: 'faux', provider: 'faux', model: 'm', usage: u, stopReason, timestamp }) as AgentMessage
const call = (id: string, timestamp = 0): AgentMessage =>
  ({
    role: 'assistant',
    content: [{ type: 'toolCall', id, name: 'read', arguments: { path: 'a' } }],
    api: 'faux',
    provider: 'faux',
    model: 'm',
    usage: usage(1, 1),
    stopReason: 'toolUse',
    timestamp,
  }) as AgentMessage
const result = (id: string, text: string, timestamp = 0): AgentMessage =>
  ({ role: 'toolResult', toolCallId: id, toolName: 'read', content: [{ type: 'text', text }], isError: false, timestamp }) as AgentMessage
const resultText = (m: AgentMessage) => (m as { content: { text: string }[] }).content[0]!.text

describe('contextBudget', () => {
  it.each([
    // [contextWindow, maxTokens, effective, threshold, warning]
    [128_000, 16_384, 111_616, 102_400, 82_400],
    [128_000, 64_000, 108_000, 102_400, 82_400],
    [400_000, 128_000, 380_000, 320_000, 300_000],
    [1_000_000, 32_000, 980_000, 800_000, 780_000],
  ])('窗口 %i、maxTokens %i：有效窗口 %i，阈值 %i，预警 %i', (contextWindow, maxTokens, effective, threshold, warning) => {
    expect(contextBudget({ contextWindow, maxTokens })).toEqual({ contextWindow, effectiveWindow: effective, threshold, warning })
  })

  it('小窗口仍按窗口的 80% 计算阈值，且各值不为负', () => {
    expect(contextBudget({ contextWindow: 10_000, maxTokens: 4_000 })).toEqual({ contextWindow: 10_000, effectiveWindow: 6_000, threshold: 8_000, warning: 0 })
    expect(contextBudget({ contextWindow: 0, maxTokens: 0 })).toEqual({ contextWindow: 0, effectiveWindow: 0, threshold: 0, warning: 0 })
  })
})

describe('estimateContextTokens', () => {
  it('没有 usage 时全部按 chars/4（向上取整）估算', () => {
    const messages = [user('x'.repeat(10)), assistant('y'.repeat(7))]
    expect(estimateContextTokens(messages)).toEqual({ tokens: 3 + 2, usageTokens: 0, trailingTokens: 5, estimated: true })
  })

  it('有 usage 时为最后一次 assistant 的 input + cacheRead + cacheWrite + output 加其后消息的 chars/4', () => {
    const messages = [user('hi'), assistant('ok', 0, usage(100, 20, 30, 5)), result('t', 'z'.repeat(41))]
    expect(estimateContextTokens(messages)).toEqual({ tokens: 155 + 11, usageTokens: 155, trailingTokens: 11, estimated: true })
  })

  it('最后一条就是带 usage 的 assistant 时不是估算值', () => {
    expect(estimateContextTokens([user('hi'), assistant('ok', 0, usage(100, 20))])).toEqual({
      tokens: 120,
      usageTokens: 120,
      trailingTokens: 0,
      estimated: false,
    })
  })

  it('跳过出错、中止与 usage 为 0 的 assistant', () => {
    const messages = [
      user('hi'),
      assistant('first', 0, usage(50, 10)),
      user('a'.repeat(8)),
      assistant('', 0, usage(0, 0), 'error'),
      assistant('', 0, usage(9, 9), 'aborted'),
    ]
    // 50 + 10，其后：user 8 字符 = 2，两条 assistant 文本为空 = 0。
    expect(estimateContextTokens(messages)).toMatchObject({ tokens: 62, usageTokens: 60, trailingTokens: 2 })
  })

  it('estimateMessageChars：toolCall 计名字与参数 JSON，toolResult 计文本', () => {
    expect(estimateMessageChars(call('c1'))).toBe('read'.length + JSON.stringify({ path: 'a' }).length)
    expect(estimateMessageChars(result('c1', 'abc'))).toBe(3)
  })
})

describe('trimOldToolResults（时间裁剪）', () => {
  const big = 'b'.repeat(2049)
  /** 7 个较大的 toolResult（t0 … t6），最后一条 assistant 在 t=0，之后用户在 now 发消息。 */
  const conversation = (gapMinutes: number) => {
    const messages: AgentMessage[] = [user('start', 0)]
    for (let i = 0; i < 7; i++) messages.push(call('c' + i, 0), result('c' + i, big, 0))
    messages.push(assistant('done', 0, usage(10, 1)))
    messages.push(user('later', gapMinutes * MIN))
    return messages
  }

  it('距最后一条 assistant 59 分钟：不裁剪（原数组）', () => {
    const messages = conversation(59)
    expect(trimOldToolResults(messages, { now: 59 * MIN })).toBe(messages)
  })

  it('61 分钟：保留最近 5 个 toolResult，其余超过 2KB 的替换为说明文本；条目（输入数组）不变', () => {
    const messages = conversation(61)
    const snapshot = structuredClone(messages)
    const trimmed = trimOldToolResults(messages, { now: 61 * MIN })
    const texts = trimmed.filter((m) => m.role === 'toolResult').map(resultText)
    expect(texts).toEqual([OLD_TOOL_RESULT_CLEARED, OLD_TOOL_RESULT_CLEARED, big, big, big, big, big])
    expect(OLD_TOOL_RESULT_CLEARED).toBe('[Old tool result content cleared]')
    expect(messages).toEqual(snapshot)
  })

  it('不超过 2KB 的旧结果保留', () => {
    const messages: AgentMessage[] = [user('start', 0), call('small', 0), result('small', 's'.repeat(2048), 0)]
    for (let i = 0; i < 5; i++) messages.push(call('c' + i, 0), result('c' + i, big, 0))
    messages.push(assistant('done', 0, usage(1, 1)), user('later', 61 * MIN))
    const texts = trimOldToolResults(messages, { now: 61 * MIN })
      .filter((m) => m.role === 'toolResult')
      .map(resultText)
    expect(texts[0]).toBe('s'.repeat(2048))
  })

  it('还没有用户的下一条消息时，按 now 与最后一条 assistant 的间隔判定', () => {
    const messages = conversation(0).slice(0, -1)
    expect(trimOldToolResults(messages, { now: 59 * MIN })).toBe(messages)
    expect(
      trimOldToolResults(messages, { now: 61 * MIN })
        .filter((m) => m.role === 'toolResult')
        .map(resultText)
        .slice(0, 2),
    ).toEqual([OLD_TOOL_RESULT_CLEARED, OLD_TOOL_RESULT_CLEARED])
  })

  it('裁剪点之后同一 Run 的后续请求结果相同（缓存前缀稳定）', () => {
    const messages = conversation(61)
    const first = trimOldToolResults(messages, { now: 61 * MIN })
    // 同一 Run 中模型又回复并调用了工具：最后一条 assistant 是新的，但较早的裁剪点不变。
    const next = [...messages, call('c7', 61 * MIN), result('c7', 'fresh', 61 * MIN)]
    const second = trimOldToolResults(next, { now: 61 * MIN + 1000 })
    expect(second.slice(0, first.length)).toEqual(first)
  })

  it('没有 assistant 时不裁剪', () => {
    const messages = [user('a', 0), user('b', 120 * MIN)]
    expect(trimOldToolResults(messages, { now: 120 * MIN })).toBe(messages)
  })
})
