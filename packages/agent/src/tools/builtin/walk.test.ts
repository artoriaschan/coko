// 忽略来源：find 与 @ 文件搜索（同一 walkTree）遵守 .git/info/exclude 与全局 excludes，与 grep 契约相同；临时 HOME。
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { searchWorkspaceFiles } from '../../context/references/search.ts'
import { useTempGitHome } from '../../testing/grep-contract.ts'
import { createTempWorkspace, type TempWorkspace } from '../../testing/workspace.ts'
import { createFindTool } from './find.ts'

const home = useTempGitHome()
let ws: TempWorkspace
beforeEach(async () => {
  ws = await createTempWorkspace('coko-walk-')
})
afterEach(() => ws.dispose())

const find = async (pattern: string) => {
  const result = await createFindTool({ cwd: ws.dir }).execute('find-call', { pattern } as never)
  return (result.content[0] as { text: string }).text.split('\n')
}
const search = async () => (await searchWorkspaceFiles(ws.dir, '')).map((e) => e.path)

describe('walkTree 的忽略来源', () => {
  it('find 与文件搜索不列出 info/exclude、core.excludesFile 与 XDG 缺省文件忽略的路径', async () => {
    await home.current.write('.gitconfig', '[core]\n  excludesfile = "~/ignores/global"\n')
    await home.current.write('ignores/global', '*.bak\n')
    await ws.write('.git/info/exclude', 'scratch/\n')
    await ws.write('a.bak', '')
    await ws.write('scratch/notes.md', '')
    await ws.write('src/app.ts', '')
    expect(await find('*')).toEqual(['src/', 'src/app.ts'])
    expect(await search()).toEqual(['src/', 'src/app.ts'])
  })

  it('XDG 缺省文件只在未设 core.excludesFile 时读取', async () => {
    await home.current.write('.config/git/ignore', '*.cache\n')
    await ws.write('.git/HEAD', '')
    await ws.write('a.cache', '')
    await ws.write('b.txt', '')
    expect(await find('*')).toEqual(['b.txt'])
    await home.current.write('.gitconfig', '[core]\n\texcludesFile = ~/none\n')
    expect(await find('*')).toEqual(['a.cache', 'b.txt'])
  })

  it('嵌套仓库的 info/exclude 作用于其目录之下；.git 为文件（worktree）时读 commondir 指向的 exclude', async () => {
    await ws.write('.git/HEAD', '')
    await ws.write('vendor/lib/.git/info/exclude', 'gen.ts\n')
    await ws.write('vendor/lib/gen.ts', '')
    await ws.write('vendor/lib/keep.ts', '')
    await ws.write('gen.ts', '')
    await ws.write('main-git/worktrees/wt/commondir', '../..\n')
    await ws.write('main-git/info/exclude', 'local.txt\n')
    await ws.write('wt/.git', 'gitdir: ' + ws.path('main-git/worktrees/wt') + '\n')
    await ws.write('wt/local.txt', '')
    await ws.write('wt/shared.txt', '')
    const files = await find('*.{ts,txt}')
    expect(files).toEqual(['gen.ts', 'vendor/lib/keep.ts', 'wt/shared.txt'])
  })

  it('没有这些文件时结果与之前一致', async () => {
    await ws.write('.git/HEAD', '')
    await ws.write('a.bak', '')
    await ws.write('b.cache', '')
    expect(await find('*')).toEqual(['a.bak', 'b.cache'])
  })
})
