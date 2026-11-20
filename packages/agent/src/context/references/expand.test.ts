// File Reference 的展开：Workspace 内文件按 read 截断（2000 行 / 50KB）读入、目录列表最多 200 项、单条消息最多 10 个 / 合计
// 200KB；Read 拒绝规则覆盖、Workspace 外或二进制时只附说明。断言生成的 <file_reference> 文本块。
import { symlink } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTempWorkspace, type TempWorkspace } from '../../testing/workspace.ts'
import {
  expandFileReferences,
  FILE_REFERENCE_DIRECTORY_LIMIT,
  FILE_REFERENCE_MAX_COUNT,
  FILE_REFERENCE_MESSAGE_BYTES,
  FILE_REFERENCE_NOTES,
  SESSION_REFERENCE_NOTES,
  type SessionReferenceResolution,
} from './index.ts'

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

describe('expandFileReferences：Session Reference', () => {
  const entries = [
    { seq: 1, kind: 'message', runId: 'r', payload: { role: 'user', content: [{ type: 'text', text: '用方案 A' }], timestamp: 1 } },
    { seq: 2, kind: 'message', runId: 'r', payload: { role: 'assistant', content: [{ type: 'text', text: '好的。' }], stopReason: 'stop', timestamp: 1 } },
  ]
  const sessions: Record<string, SessionReferenceResolution> = {
    s1: { status: 'attached', title: '方案 "讨论"', entries },
    other: { status: 'out-of-project', title: '别的项目' },
    self: { status: 'not-referable', title: '当前会话' },
  }
  const expandWith = (text: string) => expandFileReferences(text, { cwd: ws.dir, rules: [], resolveSession: async (id) => sessions[id] })

  it('范围内的会话：一个 <session_reference> 块，带 id 与转义后的标题，内容为文字记录；与文件引用按出现顺序排列', async () => {
    await ws.write('a.md', 'A')
    const out = await expandWith('按 @session:s1 的结论改 @a.md')
    expect(out.blocks.map((b) => b.text)).toEqual([
      '<session_reference id="s1" title="方案 &quot;讨论&quot;">\n[User]: 用方案 A\n\n[Assistant]: 好的。\n</session_reference>',
      '<file_reference path="a.md">\nA\n</file_reference>',
    ])
    expect(out.sessionReferences).toEqual([{ status: 'attached', truncated: false }])
    expect(out.references).toEqual([{ path: 'a.md', status: 'file', truncated: false }])
  })

  it('范围之外的会话只附一行说明（带标题），没有对方的内容', async () => {
    const out = await expandWith('@session:other 与 @session:self')
    expect(out.blocks.map((b) => b.text)).toEqual([
      '<session_reference id="other" title="别的项目">\n[Not attached: the session does not belong to the current project.]\n</session_reference>',
      '<session_reference id="self" title="当前会话">\n[Not attached: this session cannot be referenced.]\n</session_reference>',
    ])
    expect(out.sessionReferences.map((r) => r.status)).toEqual(['out-of-project', 'not-referable'])
  })

  it('不存在的 id 不产生块；同一个会话只附一次；没有解析入口时 @session: 既不是会话也不是路径', async () => {
    expect((await expandWith('@session:missing')).blocks).toEqual([])
    expect((await expandWith('@session:s1 再说一遍 @session:s1')).blocks).toHaveLength(1)
    await ws.write('session:s1', 'not a path')
    expect(await texts('@session:s1')).toEqual([])
  })

  it('超过单个上限的记录被截断并计入 truncated', async () => {
    const long = Array.from({ length: 10 }, (_, i) => ({
      seq: i + 1,
      kind: 'message',
      runId: 'r',
      payload: { role: 'user', content: `m${i + 1} ${'x'.repeat(10_000)}`, timestamp: 1 },
    }))
    const out = await expandFileReferences('@session:long', {
      cwd: ws.dir,
      rules: [],
      resolveSession: async () => ({ status: 'attached', title: 'long', entries: long }),
    })
    expect(Buffer.byteLength(out.blocks[0]!.text)).toBeLessThanOrEqual(50 * 1024 + 100)
    expect(out.blocks[0]!.text).toContain('[5 earlier messages omitted to fit the session reference limit]')
    expect(out.sessionReferences).toEqual([{ status: 'attached', truncated: true }])
  })

  it('文件引用与会话引用共用每条消息 10 个的数量上限', async () => {
    const tokens: string[] = []
    for (let i = 0; i < FILE_REFERENCE_MAX_COUNT; i++) {
      await ws.write(`f${i}.txt`, `F${i}`)
      tokens.push(`@f${i}.txt`)
    }
    const out = await expandWith(`${tokens.join(' ')} @session:s1`)
    expect(out.blocks[10]!.text).toBe(`<session_reference id="s1" title="方案 &quot;讨论&quot;">\n${SESSION_REFERENCE_NOTES.count}\n</session_reference>`)
    expect(out.sessionReferences).toEqual([{ status: 'skipped', truncated: false }])
  })

  it('只附说明的块不占字节额度：恰好剩下的字节仍可用于之后的引用', async () => {
    // 每个记录 `[User]: ` 加正文共 51,175 字节，4 个合计 204,700，剩 100 字节。
    const exact: SessionReferenceResolution = {
      status: 'attached',
      title: 'exact',
      entries: [{ seq: 1, kind: 'message', runId: 'r', payload: { role: 'user', content: 'u'.repeat(51_175 - 8), timestamp: 1 } }],
    }
    const out = await expandFileReferences('@session:other @session:e1 @session:e2 @session:e3 @session:e4 @session:self @session:s1', {
      cwd: ws.dir,
      rules: [],
      resolveSession: async (id) => (id.startsWith('e') ? exact : sessions[id]),
    })
    expect(out.sessionReferences).toEqual([
      { status: 'out-of-project', truncated: false },
      ...Array.from({ length: 4 }, () => ({ status: 'attached', truncated: false })),
      { status: 'not-referable', truncated: false },
      { status: 'attached', truncated: false },
    ])
    expect(out.blocks.at(-1)!.text).toBe(
      '<session_reference id="s1" title="方案 &quot;讨论&quot;">\n[User]: 用方案 A\n\n[Assistant]: 好的。\n</session_reference>',
    )
  })

  it('与文件引用共用合计 200KB：接近上限的会话按剩余额度截断，放不下的附说明；范围之外的说明块不占字节额度', async () => {
    const user = (seq: number, text: string) => ({ seq, kind: 'message', runId: 'r', payload: { role: 'user', content: text, timestamp: 1 } })
    const attached = (title: string, ...texts: string[]): SessionReferenceResolution => ({
      status: 'attached',
      title,
      entries: texts.map((t, i) => user(i + 1, t)),
    })
    const all: Record<string, SessionReferenceResolution> = {
      ...sessions,
      long: attached('long', ...[1, 2, 3].map((i) => `m${i} ${'x'.repeat(10_000)}`)),
      fill: attached('fill', 'f'.repeat(5_000)),
      tail: attached('tail', 't'.repeat(500)),
    }
    const tokens: string[] = []
    // 4 个约 45KB 的文件先用掉约 180KB。
    for (let i = 0; i < 4; i++) {
      await ws.write(`big${i}.txt`, Array.from({ length: 450 }, () => 'y'.repeat(99)).join('\n'))
      tokens.push(`@big${i}.txt`)
    }
    const out = await expandFileReferences(`${tokens.join(' ')} @session:other @session:long @session:fill @session:s1 @session:tail`, {
      cwd: ws.dir,
      rules: [],
      resolveSession: async (id) => all[id],
    })
    expect(out.references.map((r) => [r.status, r.truncated])).toEqual(Array.from({ length: 4 }, () => ['file', false]))
    expect(out.sessionReferences).toEqual([
      { status: 'out-of-project', truncated: false },
      { status: 'attached', truncated: true },
      { status: 'attached', truncated: true },
      { status: 'attached', truncated: false },
      { status: 'skipped', truncated: false },
    ])
    const [, long, fill, s1, tail] = out.blocks.slice(4).map((b) => b.text)
    // long 的三条消息约 30KB，剩余约 24KB：省略最早的一条，保留最近的两条。
    expect(long!.startsWith('<session_reference id="long" title="long">\n[1 earlier message omitted to fit the session reference limit]\n\n[User]: m2 x')).toBe(
      true,
    )
    expect(long).toContain('[User]: m3 x')
    expect(long).not.toContain('m1 x')
    // fill 只剩约 4.7KB：截断这一条消息；之后放得下的短记录照常附上。
    expect(fill).toContain('[Message truncated to fit the session reference limit]')
    expect(s1).toBe('<session_reference id="s1" title="方案 &quot;讨论&quot;">\n[User]: 用方案 A\n\n[Assistant]: 好的。\n</session_reference>')
    // 剩余不足以放下任何记录内容：附超限说明，不附只有省略说明的块。
    expect(tail).toBe(`<session_reference id="tail" title="tail">\n${SESSION_REFERENCE_NOTES.budget}\n</session_reference>`)
    const body = (text: string) => text.slice(text.indexOf('\n') + 1, text.lastIndexOf('\n'))
    const attachedBytes = out.blocks
      .map((b) => body(b.text))
      .filter((text) => !text.startsWith('[Not attached'))
      .reduce((sum, text) => sum + Buffer.byteLength(text, 'utf-8'), 0)
    expect(attachedBytes).toBeLessThanOrEqual(FILE_REFERENCE_MESSAGE_BYTES)
    expect(attachedBytes).toBeGreaterThan(FILE_REFERENCE_MESSAGE_BYTES - 200)
  })
})
