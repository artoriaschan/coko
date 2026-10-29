import { describe, expect, it } from 'vitest'
import { convertMcpResult } from './results.ts'

const text = (result: { content: { type: string; text?: string }[] }) => result.content.map((b) => b.text ?? '').join('')

describe('MCP 结果转换', () => {
  it('文本与图片透传；isError 为错误结果', () => {
    const ok = convertMcpResult('srv', 'echo', {
      content: [
        { type: 'text', text: 'hi' },
        { type: 'image', data: 'AAAA', mimeType: 'image/png' },
      ],
    })
    expect(ok).toMatchObject({
      content: [
        { type: 'text', text: 'hi' },
        { type: 'image', data: 'AAAA', mimeType: 'image/png' },
      ],
      details: { server: 'srv', tool: 'echo' },
    })
    expect(ok.isError).toBeUndefined()
    const failed = convertMcpResult('srv', 'echo', { content: [{ type: 'text', text: 'boom' }], isError: true })
    expect(failed).toMatchObject({ isError: true, content: [{ type: 'text', text: 'boom' }] })
    expect(text(convertMcpResult('srv', 'echo', { content: [], isError: true }))).toContain('returned an error')
  })

  it('其他类型注明省略；只有 structuredContent 时为其 JSON', () => {
    expect(text(convertMcpResult('s', 't', { content: [{ type: 'audio', data: 'x', mimeType: 'audio/wav' } as never] }))).toContain('omitted')
    expect(text(convertMcpResult('s', 't', { content: [], structuredContent: { a: 1 } }))).toContain('"a": 1')
  })

  it('超过 2000 行或 50KB 时截断并注明', () => {
    const lines = Array.from({ length: 2500 }, (_, i) => `line ${i + 1}`).join('\n')
    const byLines = text(convertMcpResult('s', 't', { content: [{ type: 'text', text: lines }] }))
    expect(byLines).toContain('line 2000\n')
    expect(byLines).not.toContain('line 2001\n')
    expect(byLines).toMatch(/\[MCP output truncated: showing 2000 of 2500 lines/)
    const big = 'x'.repeat(60 * 1024)
    const byBytes = text(convertMcpResult('s', 't', { content: [{ type: 'text', text: `${big}\nshort` }] }))
    expect(Buffer.byteLength(byBytes)).toBeLessThan(52 * 1024)
    expect(byBytes).toMatch(/50\.0KB limit/)
  })
})
