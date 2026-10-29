// @ 菜单的文件候选：模糊匹配 Workspace 内的文件与目录，遵守忽略规则（不含 .git），目录带 /，有上限。
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTempWorkspace, type TempWorkspace } from '../../testing/workspace.ts'
import { FILE_SEARCH_LIMIT, searchWorkspaceFiles } from './index.ts'

let ws: TempWorkspace
beforeEach(async () => {
  ws = await createTempWorkspace('coko-search-')
  await ws.write('.git/HEAD', 'ref: refs/heads/main\n')
  await ws.write('.gitignore', 'dist/\n*.log\n')
  await ws.write('README.md', '')
  await ws.write('src/app.ts', '')
  await ws.write('src/lib/readme-util.ts', '')
  await ws.write('dist/bundle.js', '')
  await ws.write('debug.log', '')
  await ws.write('docs/guide.md', '')
})
afterEach(() => ws.dispose())

const paths = async (query: string, limit?: number) => (await searchWorkspaceFiles(ws.dir, query, limit === undefined ? {} : { limit })).map((e) => e.path)

describe('searchWorkspaceFiles', () => {
  it('空查询：浅层在前；遵守 .gitignore，不含 .git；目录带 /', async () => {
    const all = await paths('')
    expect(all.slice(0, 5)).toEqual(['.gitignore', 'docs/', 'README.md', 'src/', 'docs/guide.md'])
    expect(all).not.toContain('dist/')
    expect(all).not.toContain('debug.log')
    expect(all.some((p) => p.startsWith('.git/'))).toBe(false)
    const entries = await searchWorkspaceFiles(ws.dir, 'src')
    expect(entries.find((e) => e.path === 'src/')).toEqual({ path: 'src/', kind: 'directory' })
    expect(entries.find((e) => e.path === 'src/app.ts')).toEqual({ path: 'src/app.ts', kind: 'file' })
  })

  it('模糊匹配（不区分大小写）：路径前缀 > 文件名前缀 > 包含 > 子序列', async () => {
    expect(await paths('readme')).toEqual(['README.md', 'src/lib/readme-util.ts'])
    expect(await paths('rdme')).toEqual(['README.md', 'src/lib/readme-util.ts'])
    expect(await paths('app')).toEqual(['src/app.ts'])
    expect(await paths('zzz')).toEqual([])
  })

  it('以 / 结尾的查询列出该目录之下的项（不含目录本身）', async () => {
    expect(await paths('src/')).toEqual(['src/app.ts', 'src/lib/', 'src/lib/readme-util.ts'])
  })

  it('最多 50 条（limit 可更小）', async () => {
    for (let i = 0; i < 70; i++) await ws.write(`many/n${i}.txt`, '')
    expect(await paths('many/')).toHaveLength(FILE_SEARCH_LIMIT)
    expect(FILE_SEARCH_LIMIT).toBe(50)
    expect(await paths('many/', 3)).toHaveLength(3)
    expect(await paths('many/', 500)).toHaveLength(50)
  })
})
