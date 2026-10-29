import { describe, expect, it } from 'vitest'
import { createMcpToolName, MAX_MCP_TOOL_NAME_LENGTH, mcpNamespace, serverNamesConflict } from './naming.ts'

describe('MCP 工具命名', () => {
  it('mcp__<server>__<tool>，[A-Za-z0-9_-] 之外的字符换成 _', () => {
    expect(createMcpToolName('docs', 'search')).toBe('mcp__docs__search')
    expect(createMcpToolName('my-srv', 'get.file/v2 now')).toBe('mcp__my-srv__get_file_v2_now')
  })

  it('超过 64 字符时截断并加 8 位 hash，保留 mcp__<server>__ 前缀', () => {
    const long = 'a'.repeat(80)
    const name = createMcpToolName('srv', long)
    expect(name).toHaveLength(MAX_MCP_TOOL_NAME_LENGTH)
    expect(name.startsWith('mcp__srv__aaaa')).toBe(true)
    expect(name).toMatch(/_[0-9a-f]{8}$/)
    // 不同的长名字得到不同的 hash；同一名字稳定。
    expect(createMcpToolName('srv', long)).toBe(name)
    expect(createMcpToolName('srv', `${long}b`)).not.toBe(name)
  })

  it('同一 Server 的两个工具规范化后同名时，后者加 hash', () => {
    const taken = new Set([createMcpToolName('srv', 'a.b')])
    const second = createMcpToolName('srv', 'a_b', (n) => taken.has(n))
    expect(second).not.toBe('mcp__srv__a_b')
    expect(second).toMatch(/^mcp__srv__a_b_[0-9a-f]{8}$/)
  })

  it('Server 名只差 - 与 _ 时冲突', () => {
    expect(serverNamesConflict('my-srv', 'my_srv')).toBe(true)
    expect(serverNamesConflict('my-srv', 'my-srv')).toBe(false)
    expect(serverNamesConflict('srv', 'srv2')).toBe(false)
    expect(mcpNamespace('my-srv')).toBe('mcp__my-srv')
  })
})
