// grep / find / ls 的读取拒绝过滤（ADR 0005：拒绝规则在任何模式下都生效）：执行上下文给出 readDenied 时，结果中不出现被拒绝的路径。
import { symlink } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTempWorkspace, type TempWorkspace } from '../../testing/workspace.ts'
import { createFindTool } from './find.ts'
import { createGrepTool } from './grep.ts'
import { createLsTool } from './ls.ts'

const textOf = (result: { content: { type: string; text?: string }[] }) => result.content.map((block) => block.text ?? '').join('')
const context = (readDenied: (path: string) => boolean) => ({ idempotencyKey: 'k', readDenied })

let ws: TempWorkspace
let outside: TempWorkspace
beforeEach(async () => {
  ws = await createTempWorkspace('coko-filter-')
  outside = await createTempWorkspace('coko-filter-out-')
  await ws.write('src/secret.txt', 'needle secret\n')
  await ws.write('src/open.txt', 'needle open\n')
  await ws.write('vault/key.txt', 'needle key\n')
})
afterEach(async () => {
  await ws.dispose()
  await outside.dispose()
})

const deniedNames =
  (...names: string[]) =>
  (path: string) =>
    names.some((name) => path.endsWith(name) || path.includes(`${name}/`))

describe('读取拒绝过滤', () => {
  it('grep 跳过被拒绝的文件并注明排除了几个路径', async () => {
    const tool = createGrepTool({ cwd: ws.dir })
    const text = textOf(await tool.execute('g', { pattern: 'needle' }, undefined, undefined, context(deniedNames('secret.txt'))))
    expect(text).toContain('src/open.txt:1: needle open')
    expect(text).not.toContain('secret')
    expect(text).toContain('[1 path omitted: denied by permission rules]')
  })

  it('find 不列出被拒绝的文件，也不进入被拒绝的目录', async () => {
    const tool = createFindTool({ cwd: ws.dir })
    const text = textOf(await tool.execute('f', { pattern: '**/*.txt' }, undefined, undefined, context(deniedNames('secret.txt', 'vault'))))
    expect(text.split('\n')).toContain('src/open.txt')
    expect(text).not.toContain('secret.txt')
    expect(text).not.toContain('key.txt')
  })

  it('ls 不列出被拒绝的条目', async () => {
    const tool = createLsTool({ cwd: ws.dir })
    const text = textOf(await tool.execute('l', { path: 'src' }, undefined, undefined, context(deniedNames('secret.txt'))))
    expect(text).toContain('open.txt')
    expect(text).not.toContain('secret.txt')
    expect(text).toContain('[1 path omitted: denied by permission rules]')
  })

  it('搜索根是指向别处的符号链接时按真实路径判定', async () => {
    await outside.write('id_rsa', 'needle private key\n')
    await symlink(outside.dir, ws.path('link'))
    const tool = createGrepTool({ cwd: ws.dir })
    const real = await import('node:fs/promises').then((fs) => fs.realpath(outside.dir))
    const text = textOf(
      await tool.execute(
        'g',
        { pattern: 'needle', path: 'link' },
        undefined,
        undefined,
        context((path) => path.startsWith(real)),
      ),
    )
    expect(text).not.toContain('private key')
  })
})
