// File Reference 的展开：Workspace 内文件按 read 截断（2000 行 / 50KB）读入、目录列表最多 200 项、单条消息最多 10 个 / 合计
// 200KB；Read 拒绝规则覆盖、Workspace 外或二进制时只附说明。断言生成的 <file_reference> 文本块。
import { symlink } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTempWorkspace, type TempWorkspace } from '../../testing/workspace.ts'
import { expandFileReferences, FILE_REFERENCE_DIRECTORY_LIMIT, FILE_REFERENCE_MAX_COUNT, FILE_REFERENCE_MESSAGE_BYTES, FILE_REFERENCE_NOTES } from './index.ts'

let ws: TempWorkspace
let outside: TempWorkspace
beforeEach(async () => {
  ws = await createTempWorkspace('coko-ref-')
  outside = await createTempWorkspace('coko-ref-out-')
})
afterEach(async () => {
  await ws.dispose()
  await outside.dispose()
})

const expand = (text: string, rules: Parameters<typeof expandFileReferences>[1]['rules'] = []) => expandFileReferences(text, { cwd: ws.dir, rules })
const texts = async (text: string, rules?: Parameters<typeof expand>[1]) => (await expand(text, rules)).blocks.map((b) => b.text)

describe('expandFileReferences：文件与目录', () => {
  it('Workspace 内的文件：一个文本块，开标签带相对路径，内容原样', async () => {
    await ws.write('src/a.ts', 'export const a = 1\n')
    expect(await texts('看看 @src/a.ts')).toEqual(['<file_reference path="src/a.ts">\nexport const a = 1\n\n</file_reference>'])
    const { references } = await expand('看看 @src/a.ts')
    expect(references).toEqual([{ path: 'src/a.ts', status: 'file', truncated: false }])
  })

  it('不存在的路径（以及 @someone 这类提及）不产生块', async () => {
    expect(await texts('ping @someone about @missing.ts')).toEqual([])
  })

  it('同一个文件只附一次；绝对路径与 ./ 写法归一为相对路径', async () => {
    await ws.write('a.md', 'A')
    const blocks = await texts(`@a.md @./a.md @${ws.path('a.md')}`)
    expect(blocks).toEqual(['<file_reference path="a.md">\nA\n</file_reference>'])
  })

  it('路径含空格与需要转义的字符时按 XML 属性转义', async () => {
    await ws.write('a & b.md', 'n')
    expect(await texts('@"a & b.md"')).toEqual(['<file_reference path="a &amp; b.md">\nn\n</file_reference>'])
    await ws.write('my <notes>.md', 'n')
    expect(await texts('@"my <notes>.md"')).toEqual(['<file_reference path="my &lt;notes&gt;.md">\nn\n</file_reference>'])
  })

  it('超过 2000 行按 read 截断并注明如何继续', async () => {
    await ws.write('long.txt', Array.from({ length: 2500 }, (_, i) => `line ${i + 1}`).join('\n'))
    const [block] = await texts('@long.txt')
    expect(block).toContain('line 2000\n')
    expect(block).not.toContain('line 2001')
    expect(block).toContain('[Showing lines 1-2000 of 2500. Use the read tool with offset=2001 to continue.]')
    expect((await expand('@long.txt')).references[0]!.truncated).toBe(true)
  })

  it('超过 50KB 按字节截断', async () => {
    await ws.write('wide.txt', Array.from({ length: 1000 }, () => 'x'.repeat(99)).join('\n'))
    const [block] = await texts('@wide.txt')
    const body = block!.split('\n').filter((l) => l.startsWith('x'))
    expect(body.join('\n').length).toBeLessThanOrEqual(50 * 1024)
    expect(block).toMatch(/\[Showing lines 1-\d+ of 1000 \(50\.0KB limit\)\. Use the read tool with offset=\d+ to continue\.\]/)
  })

  it('目录：ls 式列表（目录带 /，按名字排序），超过 200 项时截断并注明', async () => {
    await ws.write('src/b.ts', '')
    await ws.write('src/A.ts', '')
    await ws.write('src/lib/c.ts', '')
    expect(await texts('@src/')).toEqual(['<file_reference path="src/">\nA.ts\nb.ts\nlib/\n</file_reference>'])
    // 不带 / 的目录路径同样列出，开标签补上 /。
    expect((await texts('@src'))[0]).toMatch(/^<file_reference path="src\/">/)
    for (let i = 0; i < FILE_REFERENCE_DIRECTORY_LIMIT + 5; i++) await ws.write(`many/f${String(i).padStart(3, '0')}.txt`, '')
    const [listing] = await texts('@many')
    expect(listing!.split('\n').filter((l) => l.startsWith('f'))).toHaveLength(200)
    expect(listing).toContain('[200 entries limit reached; 5 more not shown]')
  })
})

describe('expandFileReferences：不附内容的情形', () => {
  it('Read 拒绝规则覆盖的文件只附说明；目录列表不含被拒绝的项', async () => {
    await ws.write('.env', 'SECRET=1')
    await ws.write('cfg/.env', 'SECRET=2')
    await ws.write('cfg/app.json', '{}')
    const rules = [{ behavior: 'deny' as const, tool: 'Read', content: '.env' }]
    expect(await texts('@.env', rules)).toEqual([`<file_reference path=".env">\n${FILE_REFERENCE_NOTES.denied}\n</file_reference>`])
    const [dir] = await texts('@cfg/', rules)
    expect(dir).toContain('app.json')
    expect(dir).not.toContain('.env\n')
    expect(dir).toContain('[1 entry omitted: denied by permission rules]')
    expect((await expand('@.env', rules)).references[0]!.status).toBe('denied')
  })

  it('不带内容的 Read 拒绝规则拒绝全部引用；询问规则与其他工具的拒绝规则不影响（引用即授权）', async () => {
    await ws.write('a.txt', 'A')
    expect(await texts('@a.txt', [{ behavior: 'deny', tool: 'read' }])).toEqual([
      `<file_reference path="a.txt">\n${FILE_REFERENCE_NOTES.denied}\n</file_reference>`,
    ])
    expect(
      await texts('@a.txt', [
        { behavior: 'ask', tool: 'Read', content: 'a.txt' },
        { behavior: 'deny', tool: 'Edit', content: 'a.txt' },
      ]),
    ).toEqual(['<file_reference path="a.txt">\nA\n</file_reference>'])
  })

  it('Workspace 外的路径（绝对、../、~ 以及指向外部的符号链接）只附说明', async () => {
    await outside.write('x.txt', 'OUTSIDE')
    await symlink(outside.path('x.txt'), ws.path('link.txt'))
    for (const token of [`@${outside.path('x.txt')}`, '@link.txt']) {
      const blocks = await texts(token)
      expect(blocks).toHaveLength(1)
      expect(blocks[0]).toContain(FILE_REFERENCE_NOTES.outside)
      expect(blocks[0]).not.toContain('OUTSIDE')
    }
    expect((await expand('@link.txt')).references[0]!.status).toBe('outside')
  })

  it('二进制文件只附说明', async () => {
    await ws.write('img.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]))
    expect(await texts('@img.png')).toEqual([`<file_reference path="img.png">\n${FILE_REFERENCE_NOTES.binary}\n</file_reference>`])
  })

  it('单条消息最多 10 个：之后的引用只附说明', async () => {
    const tokens: string[] = []
    for (let i = 0; i < FILE_REFERENCE_MAX_COUNT + 2; i++) {
      await ws.write(`f${i}.txt`, `F${i}`)
      tokens.push(`@f${i}.txt`)
    }
    const { blocks, references } = await expand(tokens.join(' '))
    expect(blocks).toHaveLength(12)
    expect(references.filter((r) => r.status === 'file')).toHaveLength(10)
    expect(blocks[10]!.text).toBe(`<file_reference path="f10.txt">\n${FILE_REFERENCE_NOTES.count}\n</file_reference>`)
    expect(references[11]!.status).toBe('skipped')
  })

  it('合计 200KB：超出部分截断，用尽后只附说明', async () => {
    const tokens: string[] = []
    for (let i = 0; i < 6; i++) {
      await ws.write(`big${i}.txt`, Array.from({ length: 450 }, () => 'y'.repeat(99)).join('\n'))
      tokens.push(`@big${i}.txt`)
    }
    const { blocks, references } = await expand(tokens.join(' '))
    const contentBytes = blocks
      .map(
        (b) =>
          b.text
            .split('\n')
            .filter((l) => l.startsWith('y'))
            .join('\n').length,
      )
      .reduce((a, b) => a + b, 0)
    expect(contentBytes).toBeLessThanOrEqual(FILE_REFERENCE_MESSAGE_BYTES)
    expect(contentBytes).toBeGreaterThan(FILE_REFERENCE_MESSAGE_BYTES - 50 * 1024)
    expect(references.map((r) => r.status)).toEqual(['file', 'file', 'file', 'file', 'file', 'skipped'])
    expect(references[4]!.truncated).toBe(true)
    expect(blocks[5]!.text).toBe(`<file_reference path="big5.txt">\n${FILE_REFERENCE_NOTES.budget}\n</file_reference>`)
  })
})
