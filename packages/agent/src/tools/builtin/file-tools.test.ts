import { readFile } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTempWorkspace, type TempWorkspace } from '../../testing/workspace.ts'
import { createEditTool } from './edit.ts'
import { createFindTool } from './find.ts'
import { createLsTool } from './ls.ts'
import { createReadTool } from './read.ts'
import { createWriteTool } from './write.ts'

const textOf = (result: { content: { type: string; text?: string }[] }) => result.content.map((block) => block.text ?? '').join('')
// 1x1 transparent PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')

let ws: TempWorkspace
beforeEach(async () => {
  ws = await createTempWorkspace('coko-tools-')
})
afterEach(async () => {
  await ws.dispose()
})

describe('read', () => {
  it('读取文本，offset / limit 生效并提示后续偏移', async () => {
    await ws.write('a.txt', 'one\ntwo\nthree\nfour')
    const tool = createReadTool({ cwd: ws.dir })
    expect(textOf(await tool.execute('c', { path: 'a.txt' }))).toBe('one\ntwo\nthree\nfour')
    expect(textOf(await tool.execute('c', { path: 'a.txt', offset: 2, limit: 2 }))).toBe('two\nthree\n\n[1 more lines in file. Use offset=4 to continue.]')
    await expect(tool.execute('c', { path: 'a.txt', offset: 9 })).rejects.toThrow('Offset 9 is beyond end of file (4 lines total)')
  })

  it('超过 2000 行截断并给出续读位置', async () => {
    await ws.write('big.txt', Array.from({ length: 2500 }, (_, i) => `line ${i + 1}`).join('\n'))
    const result = await createReadTool({ cwd: ws.dir }).execute('c', { path: 'big.txt' })
    const text = textOf(result)
    expect(text.endsWith('line 2000\n\n[Showing lines 1-2000 of 2500. Use offset=2001 to continue.]')).toBe(true)
    expect(result.details?.truncation).toMatchObject({ truncated: true, truncatedBy: 'lines', outputLines: 2000 })
  })

  it('图片以附件返回', async () => {
    await ws.write('dot.png', PNG)
    const result = await createReadTool({ cwd: ws.dir }).execute('c', { path: 'dot.png' })
    expect(result.content).toEqual([
      { type: 'text', text: 'Read image file [image/png]' },
      { type: 'image', data: PNG.toString('base64'), mimeType: 'image/png' },
    ])
  })

  it('文件不存在时报错', async () => {
    await expect(createReadTool({ cwd: ws.dir }).execute('c', { path: 'missing.txt' })).rejects.toThrow(/ENOENT/)
  })
})

describe('write', () => {
  it('创建父目录并写入内容', async () => {
    const result = await createWriteTool({ cwd: ws.dir }).execute('c', { path: 'deep/dir/new.txt', content: 'hello\n' })
    expect(textOf(result)).toBe('Successfully wrote to deep/dir/new.txt')
    expect(await readFile(ws.path('deep/dir/new.txt'), 'utf-8')).toBe('hello\n')
  })
})

describe('edit', () => {
  it('精确替换多处并返回 diff 与 patch', async () => {
    await ws.write('a.ts', 'const a = 1\nconst b = 2\nconst c = 3\n')
    const result = await createEditTool({ cwd: ws.dir }).execute('c', {
      path: 'a.ts',
      edits: [
        { oldText: 'a = 1', newText: 'a = 10' },
        { oldText: 'c = 3', newText: 'c = 30' },
      ],
    })
    expect(textOf(result)).toBe('Successfully replaced 2 block(s) in a.ts.')
    expect(await readFile(ws.path('a.ts'), 'utf-8')).toBe('const a = 10\nconst b = 2\nconst c = 30\n')
    expect(result.details?.firstChangedLine).toBe(1)
    expect(result.details?.patch).toContain('-const a = 1\n+const a = 10')
    expect(result.details?.diff).toContain('+1 const a = 10')
  })

  it('保留 BOM 与 CRLF', async () => {
    await ws.write('crlf.txt', '\uFEFFone\r\ntwo\r\n')
    await createEditTool({ cwd: ws.dir }).execute('c', { path: 'crlf.txt', edits: [{ oldText: 'two', newText: 'TWO' }] })
    expect(await readFile(ws.path('crlf.txt'), 'utf-8')).toBe('\uFEFFone\r\nTWO\r\n')
  })

  it('oldText 不唯一或不存在时报错且文件不变', async () => {
    await ws.write('dup.txt', 'x\nx\n')
    const tool = createEditTool({ cwd: ws.dir })
    await expect(tool.execute('c', { path: 'dup.txt', edits: [{ oldText: 'x', newText: 'y' }] })).rejects.toThrow(/Found 2 occurrences/)
    await expect(tool.execute('c', { path: 'dup.txt', edits: [{ oldText: 'zzz', newText: 'y' }] })).rejects.toThrow(/Could not find/)
    expect(await readFile(ws.path('dup.txt'), 'utf-8')).toBe('x\nx\n')
  })

  it('兼容旧的 oldText / newText 参数', () => {
    const tool = createEditTool({ cwd: ws.dir })
    expect(tool.prepareArguments?.({ path: 'a', oldText: 'x', newText: 'y' })).toEqual({ path: 'a', edits: [{ oldText: 'x', newText: 'y' }] })
  })
})

describe('ls', () => {
  it('按字母排序，目录带斜杠，包含点文件', async () => {
    await ws.write('b.txt', '')
    await ws.write('A.txt', '')
    await ws.write('.env', '')
    await ws.write('sub/x', '')
    expect(textOf(await createLsTool({ cwd: ws.dir }).execute('c', {}))).toBe('.env\nA.txt\nb.txt\nsub/')
  })

  it('limit 截断并提示', async () => {
    await ws.write('a', '')
    await ws.write('b', '')
    await ws.write('c', '')
    const result = await createLsTool({ cwd: ws.dir }).execute('c', { limit: 2 })
    expect(textOf(result)).toBe('a\nb\n\n[2 entries limit reached. Use limit=4 for more]')
    expect(result.details).toEqual({ entryLimitReached: 2 })
  })

  it('路径不存在或不是目录时报错', async () => {
    await ws.write('f.txt', '')
    const tool = createLsTool({ cwd: ws.dir })
    await expect(tool.execute('c', { path: 'missing' })).rejects.toThrow(/Path not found/)
    await expect(tool.execute('c', { path: 'f.txt' })).rejects.toThrow(/Not a directory/)
  })
})

describe('find', () => {
  it('无斜杠匹配文件名，有斜杠匹配相对路径，遵守 .gitignore', async () => {
    await ws.write('.gitignore', 'dist/\n')
    await ws.write('src/a.ts', '')
    await ws.write('src/nested/b.spec.ts', '')
    await ws.write('src/c.spec.ts', '')
    await ws.write('dist/d.ts', '')
    await ws.write('.git/config', '')
    const tool = createFindTool({ cwd: ws.dir })
    expect(textOf(await tool.execute('c', { pattern: '*.ts' }))).toBe('src/a.ts\nsrc/c.spec.ts\nsrc/nested/b.spec.ts')
    expect(textOf(await tool.execute('c', { pattern: 'src/**/*.spec.ts' }))).toBe('src/c.spec.ts\nsrc/nested/b.spec.ts')
    expect(textOf(await tool.execute('c', { pattern: 'nested' }))).toBe('src/nested/')
    expect(textOf(await tool.execute('c', { pattern: '*.md' }))).toBe('No files found matching pattern')
  })

  it('limit 截断并提示', async () => {
    await ws.write('a.ts', '')
    await ws.write('b.ts', '')
    const result = await createFindTool({ cwd: ws.dir }).execute('c', { pattern: '*.ts', limit: 1 })
    expect(textOf(result)).toBe('a.ts\n\n[1 results limit reached. Use limit=2 for more, or refine pattern]')
    expect(result.details).toEqual({ resultLimitReached: 1 })
  })
})
