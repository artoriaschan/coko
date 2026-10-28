import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createGrepTool } from '../tools/builtin/grep.ts'
import { toolContract, type CokoTool } from '../tools/types.ts'
import { createTempWorkspace, type TempWorkspace } from './workspace.ts'

export interface GrepContractOptions {
  /** Suite title, e.g. "built-in grep" or "ripgrep grep". */
  name: string
  /** Build the implementation under test for a Workspace directory. */
  createTool: (cwd: string) => CokoTool
}

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.map((block) => (block.type === 'text' ? (block.text ?? '') : '')).join('')
}

/**
 * Behavior every grep implementation must share so prompts, Session records and replays do not
 * depend on the host. Run it against the built-in grep and against every host override.
 *
 * Covered: contract metadata, output format, .gitignore / .ignore (also outside a git repo),
 * hidden files, .git exclusion, glob filtering, ignoreCase, literal, context lines, match limit,
 * single-file paths, binary files, long-line truncation, missing paths and invalid patterns.
 * Patterns stay in the regex subset shared by JavaScript RegExp and Rust regex.
 */
export function describeGrepContract({ name, createTool }: GrepContractOptions): void {
  describe(`grep 契约：${name}`, () => {
    let ws: TempWorkspace
    let tool: CokoTool
    const run = async (params: Record<string, unknown>) => text(await tool.execute('grep-call', params as never))

    beforeEach(async () => {
      ws = await createTempWorkspace('coko-grep-')
      tool = createTool(ws.dir)
    })
    afterEach(async () => {
      await ws.dispose()
    })

    it('契约与内置 grep 一致', () => {
      expect(toolContract(tool)).toEqual(toolContract(createGrepTool({ cwd: ws.dir })))
    })

    it('输出相对路径与行号，按路径排序', async () => {
      await ws.write('src/b.ts', 'const needle = 1\n')
      await ws.write('src/a.ts', 'first\nneedle here\n')
      await ws.write('README.md', 'no match\n')
      expect(await run({ pattern: 'needle' })).toBe('src/a.ts:2: needle here\nsrc/b.ts:1: const needle = 1')
    })

    it('无匹配时返回 No matches found', async () => {
      await ws.write('a.txt', 'hello\n')
      expect(await run({ pattern: 'absent' })).toBe('No matches found')
    })

    it('遵守 .gitignore 与 .ignore（不要求 git 仓库），包含隐藏文件，排除 .git', async () => {
      await ws.write('.gitignore', 'build/\n*.log\n')
      await ws.write('sub/.ignore', 'skip.txt\n')
      await ws.write('build/out.js', 'needle\n')
      await ws.write('debug.log', 'needle\n')
      await ws.write('sub/skip.txt', 'needle\n')
      await ws.write('sub/keep.txt', 'needle\n')
      await ws.write('.hidden/config', 'needle\n')
      await ws.write('.git/HEAD', 'needle\n')
      expect(await run({ pattern: 'needle' })).toBe('.hidden/config:1: needle\nsub/keep.txt:1: needle')
    })

    it('glob 过滤：无斜杠匹配任意深度的文件名，有斜杠相对搜索目录锚定', async () => {
      await ws.write('a.ts', 'needle\n')
      await ws.write('deep/x/b.ts', 'needle\n')
      await ws.write('deep/c.js', 'needle\n')
      await ws.write('src/one.spec.ts', 'needle\n')
      await ws.write('src/nested/two.spec.ts', 'needle\n')
      await ws.write('lib/src/three.spec.ts', 'needle\n')
      expect(await run({ pattern: 'needle', glob: '*.js' })).toBe('deep/c.js:1: needle')
      expect(await run({ pattern: 'needle', glob: 'src/**/*.spec.ts' })).toBe('src/nested/two.spec.ts:1: needle\nsrc/one.spec.ts:1: needle')
    })

    it('ignoreCase 与 literal', async () => {
      await ws.write('a.txt', 'Needle\nneedle\na.b\naxb\n')
      expect(await run({ pattern: 'needle' })).toBe('a.txt:2: needle')
      expect(await run({ pattern: 'needle', ignoreCase: true })).toBe('a.txt:1: Needle\na.txt:2: needle')
      expect(await run({ pattern: 'a.b' })).toBe('a.txt:3: a.b\na.txt:4: axb')
      expect(await run({ pattern: 'a.b', literal: true })).toBe('a.txt:3: a.b')
    })

    it('context 输出前后行，匹配行用冒号、上下文行用连字符', async () => {
      await ws.write('a.txt', 'one\ntwo\nneedle\nfour\nfive\n')
      expect(await run({ pattern: 'needle', context: 1 })).toBe('a.txt-2- two\na.txt:3: needle\na.txt-4- four')
    })

    it('limit 截断匹配并给出提示', async () => {
      await ws.write('a.txt', 'needle 1\nneedle 2\nneedle 3\n')
      expect(await run({ pattern: 'needle', limit: 2 })).toBe(
        'a.txt:1: needle 1\na.txt:2: needle 2\n\n[2 matches limit reached. Use limit=4 for more, or refine pattern]',
      )
      const result = await tool.execute('grep-call', { pattern: 'needle', limit: 2 } as never)
      expect(result.details).toEqual({ matchLimitReached: 2 })
    })

    it('path 指向单个文件时输出文件名', async () => {
      await ws.write('dir/a.txt', 'needle\n')
      await ws.write('dir/b.txt', 'needle\n')
      expect(await run({ pattern: 'needle', path: 'dir/a.txt' })).toBe('a.txt:1: needle')
    })

    it('path 指向子目录时路径相对该目录', async () => {
      await ws.write('dir/inner/a.txt', 'needle\n')
      await ws.write('other.txt', 'needle\n')
      expect(await run({ pattern: 'needle', path: 'dir' })).toBe('inner/a.txt:1: needle')
    })

    it('跳过二进制文件', async () => {
      await ws.write('bin.dat', Buffer.from('needle\u0000binary\n'))
      await ws.write('text.txt', 'needle\n')
      expect(await run({ pattern: 'needle' })).toBe('text.txt:1: needle')
    })

    it('超长行截断到 500 字符并提示', async () => {
      await ws.write('long.txt', `needle${'x'.repeat(600)}\n`)
      const output = await run({ pattern: 'needle' })
      expect(output).toBe(`long.txt:1: needle${'x'.repeat(494)}... [truncated]\n\n[Some lines truncated to 500 chars. Use read tool to see full lines]`)
    })

    it('CRLF 行尾不出现在输出中', async () => {
      await ws.write('crlf.txt', 'needle\r\nnext\r\n')
      expect(await run({ pattern: 'needle' })).toBe('crlf.txt:1: needle')
    })

    it('路径不存在时报错', async () => {
      await expect(tool.execute('grep-call', { pattern: 'x', path: 'missing' } as never)).rejects.toThrow(/Path not found/)
    })

    it('非法正则报错', async () => {
      await ws.write('a.txt', 'x\n')
      // Wording differs between engines (JavaScript RegExp, Rust regex); only the failure is contract.
      await expect(tool.execute('grep-call', { pattern: '(' } as never)).rejects.toBeInstanceOf(Error)
    })

    it('已取消的 signal 立即中止', async () => {
      const controller = new AbortController()
      controller.abort()
      await expect(tool.execute('grep-call', { pattern: 'x' } as never, controller.signal)).rejects.toThrow(/aborted/)
    })
  })
}
