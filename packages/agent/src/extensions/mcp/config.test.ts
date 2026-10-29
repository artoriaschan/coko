import { describe, expect, it } from 'vitest'
import { digestMcpServer, expandSecretRefs, parseMcpServers, secretRefsOf, validateMcpServerConfig } from './config.ts'

describe('MCP Server 配置校验', () => {
  it('stdio 与 HTTP 两种形状；type 可省略', () => {
    expect(validateMcpServerConfig('a', { command: 'node', args: ['s.mjs'], env: { K: 'v' }, cwd: 'sub', timeout: 5, disabledTools: ['x'] })).toEqual({
      ok: true,
      config: { command: 'node', args: ['s.mjs'], env: { K: 'v' }, cwd: 'sub', timeout: 5, disabledTools: ['x'] },
    })
    expect(validateMcpServerConfig('b', { type: 'http', url: 'http://127.0.0.1:1/mcp', headers: { Authorization: 'Bearer ${TOKEN}' } })).toMatchObject({
      ok: true,
    })
  })

  it('非法名字、缺 command / url、SSE、非字符串 args、非正 timeout 都是错误', () => {
    const bad: [string, unknown][] = [
      ['has space', { command: 'x' }],
      ['a__b', { command: 'x' }],
      ['x'.repeat(41), { command: 'x' }],
      ['ok', {}],
      ['ok', { type: 'sse', url: 'http://x' }],
      ['ok', { command: 'x', args: [1] }],
      ['ok', { command: 'x', timeout: 0 }],
      ['ok', { url: 'ftp://x' }],
      ['ok', { command: 'x', env: { A: 1 } }],
      ['ok', { command: 'x', disabledTools: 'all' }],
      ['ok', { command: 'x', bogus: true }],
      ['ok', 'not an object'],
    ]
    expect(bad.filter(([name, raw]) => validateMcpServerConfig(name, raw).ok)).toEqual([])
  })
})

describe('配置摘要', () => {
  const base = { command: 'node', args: ['s.mjs', '--flag'], env: { A: '1', B: '2' }, cwd: 'sub' }

  it('键顺序不影响摘要；启停、超时与 disabledTools 不改变摘要', () => {
    const reordered = { cwd: 'sub', env: { B: '2', A: '1' }, args: ['s.mjs', '--flag'], command: 'node' }
    expect(digestMcpServer(reordered)).toBe(digestMcpServer(base))
    expect(digestMcpServer({ ...base, enabled: false, timeout: 9, disabledTools: ['t'] })).toBe(digestMcpServer(base))
    expect(digestMcpServer(base)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('改命令、参数、环境、地址或请求头时摘要变化', () => {
    const digest = digestMcpServer(base)
    expect(digestMcpServer({ ...base, command: 'python' })).not.toBe(digest)
    expect(digestMcpServer({ ...base, args: ['s.mjs'] })).not.toBe(digest)
    expect(digestMcpServer({ ...base, env: { A: '1', B: '3' } })).not.toBe(digest)
    const http = { url: 'http://h/mcp', headers: { X: 'a' } }
    expect(digestMcpServer({ ...http, url: 'http://h/other' })).not.toBe(digestMcpServer(http))
    expect(digestMcpServer({ ...http, headers: { X: 'b' } })).not.toBe(digestMcpServer(http))
  })
})

describe('Secret 引用', () => {
  it('env 与 headers 中的 ${NAME} 被找出并按登记的值展开', async () => {
    const config = { command: 'x', env: { DSN: '${MY_SERVICE_DSN}', PLAIN: 'literal' } }
    expect(secretRefsOf(config)).toEqual(['MY_SERVICE_DSN'])
    expect(await expandSecretRefs(config, async (name) => (name === 'MY_SERVICE_DSN' ? 'secret-value' : undefined))).toEqual({
      ok: true,
      config: { command: 'x', env: { DSN: 'secret-value', PLAIN: 'literal' } },
    })
  })

  it('未登记的名字：展开失败并写明缺少哪个名字，不回退', async () => {
    const result = await expandSecretRefs({ url: 'http://h', headers: { Authorization: 'Bearer ${NOPE}' } }, async () => undefined)
    expect(result).toEqual({ ok: false, missing: ['NOPE'] })
  })
})

describe('parseMcpServers', () => {
  it('全局：逐项校验，坏项只产生诊断；名字只差 - 与 _ 的冲突给诊断', () => {
    const parsed = parseMcpServers({ good: { command: 'x' }, bad: { command: 1 }, 'my-srv': { command: 'a' }, my_srv: { command: 'b' } }, { scope: 'global' })
    expect(parsed.entries.map((e) => e.name)).toEqual(['good', 'my-srv'])
    expect(parsed.diagnostics.map((d) => d.code)).toEqual(['invalid-server', 'name-conflict'])
  })

  it('项目：含 ${…} 的项拒绝加载；与全局同名的项被忽略', () => {
    const parsed = parseMcpServers(
      { mine: { command: 'node', args: ['--token=${X}'] }, shared: { command: 'evil' }, fine: { command: 'node' } },
      { scope: 'project', path: '/w/.mcp.json', globalNames: ['shared'] },
    )
    expect(parsed.entries.map((e) => e.name)).toEqual(['fine'])
    expect(parsed.diagnostics.map((d) => [d.code, d.path])).toEqual([
      ['project-secret-reference', '/w/.mcp.json'],
      ['shadowed-by-global', '/w/.mcp.json'],
    ])
  })

  it('项目：与全局只差大小写或 - / _ 的项同样被忽略（规则 mcp__github 不会匹配项目 Server GitHub 的工具）', () => {
    const parsed = parseMcpServers(
      { GitHub: { command: 'evil' }, 'my-db': { command: 'evil' } },
      { scope: 'project', path: '/w/.mcp.json', globalNames: ['github', 'MY_DB'] },
    )
    expect(parsed.entries).toEqual([])
    expect(parsed.diagnostics.map((d) => d.code)).toEqual(['shadowed-by-global', 'shadowed-by-global'])
  })
})
