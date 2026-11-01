// lsp 工具（诊断、定义、引用、悬停）：位置换算（1 基码点 ↔ 0 基 UTF-16）、结果格式化与截断、参数校验与 Content-Length 帧编解码。表驱动。
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createLspTool,
  decodeFrames,
  encodeFrame,
  formatLspResult,
  fromLspPosition,
  LSP_MAX_CHARS,
  LSP_MAX_ITEMS,
  LSP_LINE_TEXT_MAX,
  toLspPosition,
  type LspPort,
  type LspQuery,
  type LspQueryResult,
} from './index.ts'

const CWD = '/ws'

describe('位置换算', () => {
  const text = ['const a = 1', '中文abc', '😀x😀y', '', 'tail'].join('\n')
  it.each([
    ['第一行行首', 1, 1, { line: 0, character: 0 }],
    ['ASCII', 1, 7, { line: 0, character: 6 }],
    ['中文（BMP，一个码点一个 UTF-16 单元）', 2, 3, { line: 1, character: 2 }],
    ['代理对之后', 3, 2, { line: 2, character: 2 }],
    ['两个代理对之后', 3, 4, { line: 2, character: 5 }],
    ['行尾之后的列收紧到行尾', 2, 99, { line: 1, character: 5 }],
    ['空行', 4, 1, { line: 3, character: 0 }],
  ])('1 基 → 0 基 UTF-16：%s', (_name, line, character, expected) => {
    expect(toLspPosition(text, line, character)).toEqual(expected)
  })

  it.each([
    ['ASCII', { line: 0, character: 6 }, { line: 1, character: 7 }],
    ['中文', { line: 1, character: 2 }, { line: 2, character: 3 }],
    ['代理对之后', { line: 2, character: 2 }, { line: 3, character: 2 }],
    ['落在代理对中间时取该字符', { line: 2, character: 1 }, { line: 3, character: 1 }],
    ['两个代理对之后', { line: 2, character: 5 }, { line: 3, character: 4 }],
  ])('0 基 UTF-16 → 1 基：%s', (_name, position, expected) => {
    expect(fromLspPosition(text, position)).toEqual(expected)
  })

  it('CRLF 与单独的 CR 也是换行', () => {
    expect(toLspPosition('a\r\nb中\rc', 2, 3)).toEqual({ line: 1, character: 2 })
    expect(fromLspPosition('a\r\nb中\rc', { line: 2, character: 0 })).toEqual({ line: 3, character: 1 })
  })

  it('行号越出文件或小于 1 为参数错误', () => {
    expect(() => toLspPosition(text, 6, 1)).toThrow(/line 6 is beyond the end of the file \(5 lines\)/)
    expect(() => toLspPosition(text, 0, 1)).toThrow(/line and character are 1-based/)
    expect(() => toLspPosition(text, 1, 0)).toThrow(/line and character are 1-based/)
  })

  it('没有文本时（文件不可读）列按 UTF-16 加一', () => {
    expect(fromLspPosition(undefined, { line: 4, character: 9 })).toEqual({ line: 5, character: 10 })
  })
})

const range = (line: number, character: number) => ({ start: { line, character }, end: { line, character: character + 1 } })
const texts: Record<string, string> = {
  '/ws/src/a.ts': ['import x', '  const 名字 = 😀value + 1', 'x'.repeat(300)].join('\n'),
  '/ws/src/b.ts': 'export const value = 1',
  '/opt/lib/types.d.ts': 'declare const value: number',
}
const readText = (path: string) => texts[path]
const format = (result: LspQueryResult, file = '/ws/src/a.ts') => formatLspResult(result, { cwd: CWD, file, readText })

describe('结果格式化', () => {
  it('diagnostics：<rel>:<line>:<col> <severity> <message> [<source>]，按位置排序；多行消息合为一行', () => {
    const out = format({
      kind: 'diagnostics',
      diagnostics: [
        { range: range(1, 10), severity: 2, message: 'unused', source: 'ts' },
        { range: range(0, 0), severity: 1, message: 'Cannot find name.\n  Did you mean?', source: 'ts', code: 2304 },
        { range: range(1, 2), severity: 3, message: 'info' },
        { range: range(1, 3), severity: 4, message: 'hint' },
        { range: range(1, 4), message: 'no severity' },
      ],
    })
    expect(out.text).toBe(
      [
        'src/a.ts:1:1 error Cannot find name. Did you mean? [ts]',
        'src/a.ts:2:3 information info',
        'src/a.ts:2:4 hint hint',
        'src/a.ts:2:5 error no severity',
        // 列 10（0 基 UTF-16）在代理对之前，'  const 名字' 共 10 个单元、10 个码点 → 第 11 列。
        'src/a.ts:2:11 warning unused [ts]',
      ].join('\n'),
    )
    expect(out.details).toMatchObject({ count: 5, total: 5, truncated: false })
  })

  it('diagnostics：没有诊断与没有收到诊断（超时）分别说明', () => {
    expect(format({ kind: 'diagnostics', diagnostics: [] }).text).toBe('No diagnostics for src/a.ts.')
    expect(format({ kind: 'diagnostics', diagnostics: undefined }).text).toMatch(/^No diagnostics received for src\/a.ts within 5 seconds/)
    expect(format({ kind: 'diagnostics', diagnostics: undefined }).details).toMatchObject({ count: 0, received: false })
  })

  it('definition / references：位置加该行文本（去掉首尾空白，≤ 200 字符）；代理对之后的列按码点；Workspace 外写绝对路径', () => {
    const out = format({
      kind: 'locations',
      operation: 'references',
      locations: [
        { uri: 'file:///ws/src/a.ts', range: range(1, 15) },
        { uri: 'file:///ws/src/a.ts', range: range(2, 0) },
        { uri: 'file:///opt/lib/types.d.ts', range: range(0, 14) },
        { uri: 'file:///ws/src/missing.ts', range: range(3, 4) },
      ],
    })
    const lines = out.text.split('\n')
    // '  const 名字 = 😀' 为 15 个 UTF-16 单元、14 个码点：列 15（0 基 UTF-16，指向 v）→ 第 15 列（1 基码点）。
    expect(lines[0]).toBe('src/a.ts:2:15 const 名字 = 😀value + 1')
    expect(lines[1]).toBe('src/a.ts:3:1 ' + 'x'.repeat(LSP_LINE_TEXT_MAX) + '…')
    expect(lines[2]).toBe('/opt/lib/types.d.ts:1:15 declare const value: number')
    expect(lines[3]).toBe('src/missing.ts:4:5')
    expect(out.details).toMatchObject({ count: 4, total: 4 })
  })

  it('definition：单个 Location、LocationLink 与空结果', () => {
    expect(format({ kind: 'locations', operation: 'definition', locations: { uri: 'file:///ws/src/b.ts', range: range(0, 13) } }).text).toBe(
      'src/b.ts:1:14 export const value = 1',
    )
    expect(
      format({
        kind: 'locations',
        operation: 'definition',
        locations: [{ targetUri: 'file:///ws/src/b.ts', targetRange: range(0, 0), targetSelectionRange: range(0, 13) }],
      }).text,
    ).toBe('src/b.ts:1:14 export const value = 1')
    expect(format({ kind: 'locations', operation: 'definition', locations: null }).text).toBe('No definition found.')
    expect(format({ kind: 'locations', operation: 'references', locations: [] }).text).toBe('No references found.')
  })

  it('hover：MarkupContent、MarkedString 与数组；空为没有悬停信息', () => {
    expect(format({ kind: 'hover', hover: { contents: { kind: 'markdown', value: '**x**: number' } } }).text).toBe('**x**: number')
    expect(format({ kind: 'hover', hover: { contents: [{ language: 'ts', value: 'const x: number' }, 'docs'] } }).text).toBe(
      '```ts\nconst x: number\n```\n\ndocs',
    )
    expect(format({ kind: 'hover', hover: null }).text).toBe('No hover information.')
    expect(format({ kind: 'hover', hover: { contents: '' } }).text).toBe('No hover information.')
  })

  it(`至多 ${LSP_MAX_ITEMS} 项，超出注明总数`, () => {
    const diagnostics = Array.from({ length: 250 }, (_, i) => ({ range: range(0, 0), severity: 1, message: `e${i}` }))
    const out = format({ kind: 'diagnostics', diagnostics })
    expect(out.text.split('\n').filter((l) => l.startsWith('src/'))).toHaveLength(LSP_MAX_ITEMS)
    expect(out.text.endsWith('[Showing 200 of 250 diagnostics.]')).toBe(true)
    expect(out.details).toMatchObject({ count: 200, total: 250, truncated: true })
  })

  it(`至多 ${LSP_MAX_CHARS} 字符，超出注明总数`, () => {
    const diagnostics = Array.from({ length: 150 }, (_, i) => ({ range: range(0, 0), severity: 1, message: `${i} ` + 'm'.repeat(300) }))
    const out = format({ kind: 'diagnostics', diagnostics })
    expect(out.text.length).toBeLessThanOrEqual(LSP_MAX_CHARS + 100)
    expect(out.details.truncated).toBe(true)
    expect(out.text).toMatch(new RegExp(`\\[Showing ${out.details.count} of 150 diagnostics\\.\\]$`))
    const hover = format({ kind: 'hover', hover: { contents: 'h'.repeat(LSP_MAX_CHARS + 10) } })
    expect(hover.text.endsWith('[Hover truncated: 20010 characters in total.]')).toBe(true)
  })
})

describe('lsp 工具', () => {
  async function setup(results: LspQueryResult = { kind: 'diagnostics', diagnostics: [] }) {
    const cwd = await mkdtemp(join(tmpdir(), 'coko-lsp-tool-'))
    await writeFile(join(cwd, 'a.ts'), 'const 名 = 😀1\n')
    await writeFile(join(cwd, 'a.py'), 'x = 1\n')
    const queries: LspQuery[] = []
    const port: LspPort = {
      extensions: () => ['.ts', '.tsx'],
      async query(query) {
        queries.push(query)
        return results
      },
    }
    return { cwd, queries, tool: createLspTool({ cwd, port }) }
  }

  it('契约：名字、参数与权限主体（file_path）', async () => {
    const { tool, cwd } = await setup()
    expect(tool.name).toBe('lsp')
    expect(tool.effect).toBe('read')
    expect(Object.keys((tool.parameters as { properties: object }).properties)).toEqual(['operation', 'file_path', 'line', 'character'])
    expect(tool.permissionSubject?.({ operation: 'hover', file_path: 'a.ts' })).toBe('a.ts')
    expect(tool.description).toContain('.ts, .tsx')
    expect(cwd).not.toBe('')
  })

  it.each(['definition', 'references', 'hover'] as const)('%s 缺 line 或 character 为参数错误', async (operation) => {
    const { tool, queries } = await setup()
    await expect(tool.execute('c1', { operation, file_path: 'a.ts', character: 1 })).rejects.toThrow(/requires line and character/)
    await expect(tool.execute('c1', { operation, file_path: 'a.ts', line: 1 })).rejects.toThrow(/requires line and character/)
    expect(queries).toEqual([])
  })

  it('扩展名没有匹配的服务器：错误结果并列出已配置的扩展名', async () => {
    const { tool, queries } = await setup()
    await expect(tool.execute('c1', { operation: 'diagnostics', file_path: 'a.py' })).rejects.toThrow(
      'No language server is configured for .py files. Configured extensions: .ts, .tsx',
    )
    expect(queries).toEqual([])
  })

  it('文件不存在为错误结果', async () => {
    const { tool } = await setup()
    await expect(tool.execute('c1', { operation: 'diagnostics', file_path: 'nope.ts' })).rejects.toThrow(/Cannot read nope\.ts/)
  })

  it('查询带磁盘当前内容与换算后的位置；结果经格式化，details 带操作、文件与计数', async () => {
    const { tool, queries, cwd } = await setup({ kind: 'locations', operation: 'definition', locations: [] })
    // 第 12 列（1 基码点）是代理对之后的 1：前面 11 个码点占 12 个 UTF-16 单元。
    const result = await tool.execute('c1', { operation: 'definition', file_path: 'a.ts', line: 1, character: 12 })
    expect(queries).toEqual([
      { operation: 'definition', path: join(cwd, 'a.ts'), text: 'const 名 = 😀1\n', position: { line: 0, character: 12 }, line: 1, character: 12 },
    ])
    expect(result.content).toEqual([{ type: 'text', text: 'No definition found.' }])
    expect(result.details).toEqual({ operation: 'definition', file: 'a.ts', line: 1, character: 12, count: 0, total: 0, truncated: false })
  })
})

describe('Content-Length 帧', () => {
  const message = { jsonrpc: '2.0', id: 1, method: 'x', params: { text: '中文😀' } }

  it('编码：Content-Length 为 UTF-8 字节数', () => {
    const frame = encodeFrame(message).toString('utf8')
    const body = JSON.stringify(message)
    expect(frame).toBe(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`)
  })

  it('分包（逐字节到达，含多字节字符的中间）与粘包（一个块中两条）', () => {
    const messages: unknown[] = []
    const decoder = decodeFrames((m) => messages.push(m))
    const bytes = Buffer.concat([encodeFrame(message), encodeFrame({ jsonrpc: '2.0', method: 'y' })])
    for (const byte of bytes.subarray(0, 30)) decoder.push(Buffer.from([byte]))
    decoder.push(bytes.subarray(30))
    expect(messages).toEqual([message, { jsonrpc: '2.0', method: 'y' }])
  })

  it('其他头（Content-Type）与大小写不敏感的头名', () => {
    const messages: unknown[] = []
    const body = JSON.stringify({ jsonrpc: '2.0', id: 2, result: null })
    decodeFrames((m) => messages.push(m)).push(
      Buffer.from(`content-length: ${body.length}\r\nContent-Type: application/vscode-jsonrpc; charset=utf-8\r\n\r\n${body}`),
    )
    expect(messages).toEqual([{ jsonrpc: '2.0', id: 2, result: null }])
  })

  it.each([
    ['没有 Content-Length', 'Content-Type: x\r\n\r\n{}'],
    ['Content-Length 不是数字', 'Content-Length: abc\r\n\r\n{}'],
    ['正文不是 JSON', 'Content-Length: 3\r\n\r\nabc'],
  ])('非法帧：%s 报错', (_name, raw) => {
    const errors: Error[] = []
    decodeFrames(
      () => undefined,
      (error) => errors.push(error),
    ).push(Buffer.from(raw))
    expect(errors).toHaveLength(1)
  })
})
