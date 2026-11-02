import { afterEach, describe, expect, it } from 'vitest'
import { registerSecretValues, SECRET_REDACTED } from '@coko/logging'
import { createProgressRedactor, secretRedactionHook } from './secret-redaction.ts'

const disposers: (() => void)[] = []
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose()
})
const SECRET = 'svc-dsn-0123456789'

describe('登记明文的替换点', () => {
  it('afterToolCall 替换结果的 content、details 与 structuredContent；没有命中时不改写', async () => {
    disposers.push(registerSecretValues(() => [SECRET]))
    const call = (result: object) => secretRedactionHook.afterToolCall!({ result, isError: false } as never)
    expect(await call({ content: [{ type: 'text', text: 'nothing here' }], details: { n: 1 } })).toBeUndefined()
    expect(await call({ content: [{ type: 'text', text: `dsn=${SECRET}` }], details: { raw: SECRET }, structuredContent: { value: SECRET } })).toEqual({
      content: [{ type: 'text', text: `dsn=${SECRET_REDACTED}` }],
      details: { raw: SECRET_REDACTED },
      structuredContent: { value: SECRET_REDACTED },
    })
  })

  it('按脱敏后实际发出的 UTF-16 文本重算 offset，不把原始密钥长度作为 UI 偏移', () => {
    disposers.push(registerSecretValues(() => [SECRET]))
    const redactor = createProgressRedactor()
    let rawOffset = 0
    const chunks = ['see svc-', 'dsn-01234', '56789 🦜 ok'].flatMap((delta) => {
      const event = redactor.redact({ type: 'assistant_delta', runId: 'r', kind: 'text', contentIndex: 0, offset: rawOffset, delta })
      rawOffset += delta.length
      return event?.type === 'assistant_delta' ? [event] : []
    })
    expect(chunks.map((event) => event.delta).join('')).toBe(`see ${SECRET_REDACTED} 🦜 ok`)
    expect(chunks.map((event) => event.offset)).toEqual([0, 4])
    redactor.reset()
    expect(redactor.redact({ type: 'assistant_delta', runId: 'r', kind: 'text', contentIndex: 0, offset: 0, delta: '🦜' })).toMatchObject({
      offset: 0,
      delta: '🦜',
    })
    expect(redactor.redact({ type: 'assistant_delta', runId: 'r', kind: 'text', contentIndex: 0, offset: 2, delta: ' next' })).toMatchObject({
      offset: 2,
      delta: ' next',
    })
  })

  it('进度：assistant 增量按内容块缓冲，跨增量的值被替换；其余事件整体替换；新消息开始时 reset', () => {
    disposers.push(registerSecretValues(() => [SECRET]))
    const redactor = createProgressRedactor()
    const delta = (text: string, contentIndex = 0) =>
      redactor.redact({ type: 'assistant_delta', runId: 'r', kind: 'text', contentIndex, delta: text }) as { delta: string } | undefined
    const parts = ['see svc-', 'dsn-01234', '56789 ok'].map((p) => delta(p)?.delta ?? '')
    expect(parts.join('')).toBe(`see ${SECRET_REDACTED} ok`)
    expect(redactor.redact({ type: 'tool_start', runId: 'r', toolCallId: 't', toolName: 'bash', args: { command: SECRET } })).toEqual({
      type: 'tool_start',
      runId: 'r',
      toolCallId: 't',
      toolName: 'bash',
      args: { command: SECRET_REDACTED },
    })
    // 留在缓冲中的 "svc-" 不跨消息拼接。
    expect(delta('tail svc-')?.delta).toBe('tail ')
    redactor.reset()
    expect(delta('plain')?.delta).toBe('plain')
  })
})
