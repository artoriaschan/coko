// 指令文件（票 03）：发现顺序、@import、预算、section 格式与嵌套按需加载。夹具为真实临时目录；家目录经 homeDir 注入。
import { mkdir, symlink, utimes, writeFile } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTempWorkspace, type TempWorkspace } from '../../testing/workspace.ts'
import {
  createInstructionLoader,
  createNodeInstructionFiles,
  formatInstructionsSection,
  INSTRUCTION_FILE_MAX_CHARS,
  INSTRUCTIONS_TOTAL_MAX_CHARS,
  nestedInstructionsHook,
  type InstructionLoader,
  type LoadedInstructions,
} from './index.ts'

let ws: TempWorkspace
let home: string
let cokoHome: string
let loader: InstructionLoader

beforeEach(async () => {
  ws = await createTempWorkspace('coko-rules-')
  home = ws.path('home')
  cokoHome = ws.path('coko-home')
  await mkdir(home, { recursive: true })
  await mkdir(cokoHome, { recursive: true })
  loader = createInstructionLoader({ files: createNodeInstructionFiles(), homeDir: home })
})
afterEach(async () => {
  await ws.dispose()
})

const summary = (loaded: LoadedInstructions) => loaded.files.map((f) => [f.path.slice(ws.dir.length + 1), f.scope])
const codes = (loaded: LoadedInstructions) => loaded.diagnostics.map((d) => d.code)
const contentOf = (loaded: LoadedInstructions, relative: string) => loaded.files.find((f) => f.path === ws.path(relative))?.content
const fence = '```'

describe('发现与顺序', () => {
  it('用户 → 仓库根 → … → Workspace，越近越靠后；目录链中没有指令文件的层被跳过', async () => {
    await ws.write('coko-home/AGENTS.md', 'user')
    await ws.write('repo/.git/HEAD', 'ref')
    await ws.write('repo/AGENTS.md', 'root')
    await ws.write('repo/apps/AGENTS.md', 'apps')
    await mkdir(ws.path('repo/apps/web/lib'), { recursive: true })
    await ws.write('repo/apps/web/AGENTS.md', 'web')
    // Workspace 之下的子目录不在开始时加载。
    await ws.write('repo/apps/web/src/AGENTS.md', 'nested')
    const loaded = await loader.load({ cwd: ws.path('repo/apps/web'), cokoHome })
    expect(summary(loaded)).toEqual([
      ['coko-home/AGENTS.md', 'user'],
      ['repo/AGENTS.md', 'project'],
      ['repo/apps/AGENTS.md', 'project'],
      ['repo/apps/web/AGENTS.md', 'project'],
    ])
    expect(loaded.diagnostics).toEqual([])
    expect(loaded.totalChars).toBe('userrootappsweb'.length)
  })

  it.each([
    ['只有 AGENTS.md', ['AGENTS.md'], 'AGENTS.md'],
    ['同目录 AGENTS.md 优先于 CLAUDE.md', ['AGENTS.md', 'CLAUDE.md'], 'AGENTS.md'],
    ['没有 AGENTS.md 时读 CLAUDE.md', ['CLAUDE.md'], 'CLAUDE.md'],
    ['文件名大小写不敏感', ['agents.md', 'CLAUDE.md'], 'agents.md'],
  ])('%s', async (_name, names, expected) => {
    for (const name of names) await ws.write('proj/' + name, name)
    const loaded = await loader.load({ cwd: ws.path('proj'), cokoHome })
    expect(summary(loaded)).toEqual([['proj/' + expected, 'project']])
    expect(loaded.files[0]!.content).toBe(expected)
  })

  it('用户级同样缺省读 CLAUDE.md；COKO_HOME 为空时不读用户级', async () => {
    await ws.write('coko-home/CLAUDE.md', 'user claude')
    await ws.write('proj/x.txt', '')
    expect(summary(await loader.load({ cwd: ws.path('proj'), cokoHome }))).toEqual([['coko-home/CLAUDE.md', 'user']])
    expect(summary(await loader.load({ cwd: ws.path('proj'), cokoHome: '' }))).toEqual([])
  })

  it('没有 .git 时只读 Workspace', async () => {
    await ws.write('outer/AGENTS.md', 'outer')
    await ws.write('outer/proj/AGENTS.md', 'proj')
    expect(summary(await loader.load({ cwd: ws.path('outer/proj'), cokoHome }))).toEqual([['outer/proj/AGENTS.md', 'project']])
  })

  it('.git 为文件（worktree）时同样是仓库根', async () => {
    await ws.write('repo/.git', 'gitdir: elsewhere')
    await ws.write('repo/AGENTS.md', 'root')
    await ws.write('repo/sub/AGENTS.md', 'sub')
    expect(summary(await loader.load({ cwd: ws.path('repo/sub'), cokoHome }))).toEqual([
      ['repo/AGENTS.md', 'project'],
      ['repo/sub/AGENTS.md', 'project'],
    ])
  })

  it('仓库根不越过家目录：家目录本身有 .git 时不算仓库', async () => {
    await ws.write('home/.git/HEAD', 'ref')
    await ws.write('home/AGENTS.md', 'home')
    await ws.write('home/code/AGENTS.md', 'code')
    await ws.write('home/code/proj/AGENTS.md', 'proj')
    expect(summary(await loader.load({ cwd: ws.path('home/code/proj'), cokoHome }))).toEqual([['home/code/proj/AGENTS.md', 'project']])
    // Workspace 就是家目录时也不读它的父目录。
    expect(summary(await loader.load({ cwd: home, cokoHome }))).toEqual([['home/AGENTS.md', 'project']])
  })

  it('同一个文件经符号链接出现两次时只加载一次（按真实路径）', async () => {
    await ws.write('repo/.git/HEAD', 'ref')
    await ws.write('repo/AGENTS.md', 'shared')
    await mkdir(ws.path('repo/sub'), { recursive: true })
    await symlink(ws.path('repo/AGENTS.md'), ws.path('repo/sub/AGENTS.md'))
    expect(summary(await loader.load({ cwd: ws.path('repo/sub'), cokoHome }))).toEqual([['repo/AGENTS.md', 'project']])
  })

  it('修改文件后下一次 load 读到新内容（mtime 缓存）', async () => {
    const path = await ws.write('proj/AGENTS.md', 'v1')
    expect(contentOf(await loader.load({ cwd: ws.path('proj'), cokoHome }), 'proj/AGENTS.md')).toBe('v1')
    await writeFile(path, 'v2 longer')
    const later = new Date(Date.now() + 5_000)
    await utimes(path, later, later)
    expect(contentOf(await loader.load({ cwd: ws.path('proj'), cokoHome }), 'proj/AGENTS.md')).toBe('v2 longer')
  })
})

describe('@import', () => {
  beforeEach(async () => {
    await ws.write('repo/.git/HEAD', 'ref')
  })

  it('相对（./、裸路径）、绝对与 ~/ 形式；被引入的文件在引入它的文件之前，作用域相同并记 importedBy；越界不展开', async () => {
    await ws.write('home/notes.md', 'home notes')
    const root = await ws.write(
      'repo/AGENTS.md',
      ['See @./docs/a.md and @docs/b.md.', 'Abs: @' + ws.path('repo/docs/c.md'), 'Home: @~/notes.md', 'Up: @../shared.md'].join('\n'),
    )
    await ws.write('repo/docs/a.md', 'A')
    await ws.write('repo/docs/b.md', 'B')
    await ws.write('repo/docs/c.md', 'C')
    await ws.write('shared.md', 'outside')
    await ws.write('coko-home/AGENTS.md', 'user @./rules/u.md')
    await ws.write('coko-home/rules/u.md', 'U')
    const loaded = await loader.load({ cwd: ws.path('repo'), cokoHome })
    expect(summary(loaded)).toEqual([
      ['coko-home/rules/u.md', 'user'],
      ['coko-home/AGENTS.md', 'user'],
      ['repo/docs/a.md', 'project'],
      ['repo/docs/b.md', 'project'],
      ['repo/docs/c.md', 'project'],
      ['repo/AGENTS.md', 'project'],
    ])
    expect(loaded.files.find((f) => f.path.endsWith('a.md'))!.importedBy).toBe(root)
    expect(loaded.files.find((f) => f.path === root)!.importedBy).toBeUndefined()
    // ~/ 指向家目录（不在仓库根与 COKO_HOME 内）、../ 越出仓库根：都不展开。
    expect(loaded.diagnostics).toEqual([
      expect.objectContaining({ source: 'instructions', code: 'import-outside-boundary', path: root, message: expect.stringContaining('~/notes.md') }),
      expect.objectContaining({ source: 'instructions', code: 'import-outside-boundary', path: root, message: expect.stringContaining('../shared.md') }),
    ])
  })

  it('~/ 指向 COKO_HOME 之内时展开', async () => {
    const homeLoader = createInstructionLoader({ files: createNodeInstructionFiles(), homeDir: ws.dir })
    await ws.write('repo/AGENTS.md', '@~/coko-home/shared.md')
    await ws.write('coko-home/shared.md', 'S')
    const loaded = await homeLoader.load({ cwd: ws.path('repo'), cokoHome })
    expect(summary(loaded)).toEqual([
      ['coko-home/shared.md', 'project'],
      ['repo/AGENTS.md', 'project'],
    ])
  })

  it('代码块、行内代码与 HTML 注释中的 @path 不展开；邮件地址与不像路径的 @word 不是 import', async () => {
    await ws.write(
      'repo/AGENTS.md',
      [
        fence,
        '@./fenced.md',
        fence,
        '~~~md',
        '@./tilde.md',
        '~~~',
        'Use `@./inline.md` here.',
        '<!-- @./comment.md -->',
        'mail me@./x.md',
        '@scope @team',
      ].join('\n'),
    )
    for (const name of ['fenced', 'tilde', 'inline', 'comment', 'x']) await ws.write('repo/' + name + '.md', name)
    const loaded = await loader.load({ cwd: ws.path('repo'), cokoHome })
    expect(summary(loaded)).toEqual([['repo/AGENTS.md', 'project']])
    expect(loaded.diagnostics).toEqual([])
  })

  it('循环被截断并诊断，每个文件只出现一次', async () => {
    const root = await ws.write('repo/AGENTS.md', '@./a.md')
    const b = await ws.write('repo/b.md', 'b @./a.md @./AGENTS.md')
    await ws.write('repo/a.md', 'a @./b.md')
    const loaded = await loader.load({ cwd: ws.path('repo'), cokoHome })
    expect(summary(loaded)).toEqual([
      ['repo/b.md', 'project'],
      ['repo/a.md', 'project'],
      ['repo/AGENTS.md', 'project'],
    ])
    expect(loaded.diagnostics).toEqual([
      expect.objectContaining({ code: 'import-cycle', path: b, message: expect.stringContaining('./a.md') }),
      expect.objectContaining({ code: 'import-cycle', path: b, message: expect.stringContaining('./AGENTS.md') }),
    ])
    expect(root).toBe(ws.path('repo/AGENTS.md'))
  })

  it('同一文件被两处引入时只加载一次且不诊断', async () => {
    await ws.write('repo/AGENTS.md', '@./a.md @./b.md')
    await ws.write('repo/a.md', 'a @./common.md')
    await ws.write('repo/b.md', 'b @./common.md')
    await ws.write('repo/common.md', 'common')
    const loaded = await loader.load({ cwd: ws.path('repo'), cokoHome })
    expect(summary(loaded).map(([p]) => p)).toEqual(['repo/common.md', 'repo/a.md', 'repo/b.md', 'repo/AGENTS.md'])
    expect(loaded.diagnostics).toEqual([])
  })

  it('最多 5 层：第 6 层被截断并诊断', async () => {
    await ws.write('repo/AGENTS.md', '@./l1.md')
    for (let i = 1; i <= 6; i++) await ws.write('repo/l' + i + '.md', i < 6 ? 'level ' + i + ' @./l' + (i + 1) + '.md' : 'level 6')
    const loaded = await loader.load({ cwd: ws.path('repo'), cokoHome })
    expect(summary(loaded).map(([p]) => p)).toEqual(['repo/l5.md', 'repo/l4.md', 'repo/l3.md', 'repo/l2.md', 'repo/l1.md', 'repo/AGENTS.md'])
    expect(loaded.diagnostics).toEqual([
      expect.objectContaining({ code: 'import-depth-exceeded', path: ws.path('repo/l5.md'), message: expect.stringContaining('l6.md') }),
    ])
  })

  it('缺失文件静默跳过并诊断；非文本扩展名不展开', async () => {
    const root = await ws.write('repo/AGENTS.md', '@./missing.md @./logo.png @./ok.md')
    await ws.write('repo/logo.png', 'png')
    await ws.write('repo/ok.md', 'ok')
    const loaded = await loader.load({ cwd: ws.path('repo'), cokoHome })
    expect(summary(loaded).map(([p]) => p)).toEqual(['repo/ok.md', 'repo/AGENTS.md'])
    expect(loaded.diagnostics).toEqual([
      expect.objectContaining({ code: 'import-not-found', path: root, message: expect.stringContaining('missing.md') }),
      expect.objectContaining({ code: 'import-not-text', path: root, message: expect.stringContaining('logo.png') }),
    ])
  })

  it('经符号链接越出仓库根的 import 不展开', async () => {
    await ws.write('secret.md', 'outside')
    await symlink(ws.path('secret.md'), ws.path('repo/link.md'))
    await ws.write('repo/AGENTS.md', '@./link.md')
    const loaded = await loader.load({ cwd: ws.path('repo'), cokoHome })
    expect(summary(loaded)).toEqual([['repo/AGENTS.md', 'project']])
    expect(codes(loaded)).toEqual(['import-outside-boundary'])
  })

  it('没有 .git 时允许的根是 Workspace 与 COKO_HOME', async () => {
    await ws.write('plain/sub/AGENTS.md', '@../up.md @./in.md')
    await ws.write('plain/up.md', 'up')
    await ws.write('plain/sub/in.md', 'in')
    const loaded = await loader.load({ cwd: ws.path('plain/sub'), cokoHome })
    expect(summary(loaded).map(([p]) => p)).toEqual(['plain/sub/in.md', 'plain/sub/AGENTS.md'])
    expect(codes(loaded)).toEqual(['import-outside-boundary'])
  })
})

describe('预算', () => {
  it('单文件超过 40 000 字符被截断并注明', async () => {
    await ws.write('proj/AGENTS.md', 'x'.repeat(INSTRUCTION_FILE_MAX_CHARS + 10))
    const loaded = await loader.load({ cwd: ws.path('proj'), cokoHome })
    const file = loaded.files[0]!
    expect(file.truncated).toBe(true)
    expect(file.content.startsWith('x'.repeat(INSTRUCTION_FILE_MAX_CHARS))).toBe(true)
    expect(file.content.slice(INSTRUCTION_FILE_MAX_CHARS)).toMatch(/truncated.*40010.*40000/)
    expect(file.chars).toBe(file.content.length)
    expect(codes(loaded)).toEqual(['file-truncated'])
  })

  it('合计超过 120 000 字符时从最远处整文件丢弃并诊断', async () => {
    const big = 'y'.repeat(INSTRUCTION_FILE_MAX_CHARS - 100)
    await ws.write('coko-home/AGENTS.md', big)
    await ws.write('repo/.git/HEAD', 'ref')
    await ws.write('repo/AGENTS.md', big)
    await ws.write('repo/a/AGENTS.md', big)
    await ws.write('repo/a/b/AGENTS.md', big + 'z'.repeat(50))
    const loaded = await loader.load({ cwd: ws.path('repo/a/b'), cokoHome })
    expect(summary(loaded)).toEqual([
      ['repo/AGENTS.md', 'project'],
      ['repo/a/AGENTS.md', 'project'],
      ['repo/a/b/AGENTS.md', 'project'],
    ])
    expect(loaded.totalChars).toBe(3 * (INSTRUCTION_FILE_MAX_CHARS - 100) + 50)
    expect(loaded.totalChars).toBeLessThanOrEqual(INSTRUCTIONS_TOTAL_MAX_CHARS)
    expect(loaded.diagnostics).toEqual([expect.objectContaining({ code: 'budget-exceeded', path: ws.path('coko-home/AGENTS.md') })])
  })
})

describe('formatInstructionsSection', () => {
  it('没有文件时为空；否则为 <instructions>，前导语之后每个文件一个 <instruction_file path scope>（属性转义）', () => {
    expect(formatInstructionsSection([])).toBe('')
    const text = formatInstructionsSection([
      { path: '/u/AGENTS.md', scope: 'user', content: 'u rules\n', chars: 8, truncated: false },
      { path: '/p/a&"b".md', scope: 'project', content: 'p', chars: 1, truncated: false },
    ])
    expect(text).toBe(
      [
        '<instructions>',
        'Codebase and user instructions are shown below. Be sure to adhere to these instructions. IMPORTANT: These instructions OVERRIDE any default behavior and you MUST follow them exactly as written. When instructions conflict, files that appear later (closer to the working directory) take precedence.',
        '',
        '<instruction_file path="/u/AGENTS.md" scope="user">',
        'u rules',
        '</instruction_file>',
        '',
        '<instruction_file path="/p/a&amp;&quot;b&quot;.md" scope="project">',
        'p',
        '</instruction_file>',
        '</instructions>',
      ].join('\n'),
    )
  })
})

describe('nestedInstructionsHook', () => {
  let cwd: string
  const assistant = () => ({ role: 'assistant', content: [] }) as never
  type Message = { role: string; content: { type: string; text?: string }[] }
  const call = (
    hook: ReturnType<typeof nestedInstructionsHook>,
    input: { tool: string; args: Record<string, unknown>; assistantMessage?: unknown; messages?: Message[]; isError?: boolean },
  ) =>
    hook.afterToolCall!({
      assistantMessage: (input.assistantMessage ?? assistant()) as never,
      toolCall: { type: 'toolCall', id: 't', name: input.tool, arguments: input.args } as never,
      args: input.args,
      result: { content: [{ type: 'text', text: 'tool output' }], details: undefined },
      isError: input.isError ?? false,
      context: { messages: (input.messages ?? []) as never },
    })
  const texts = (update: Awaited<ReturnType<typeof call>>) => update?.content?.map((b) => (b.type === 'text' ? b.text : '')) ?? []
  const block = (relative: string, body: string) => '<instruction_file path="' + ws.path(relative) + '" scope="nested">\n' + body + '\n</instruction_file>'

  beforeEach(async () => {
    await ws.write('repo/.git/HEAD', 'ref')
    await ws.write('repo/AGENTS.md', 'root')
    await ws.write('repo/pkg/AGENTS.md', 'pkg rules @./extra.md')
    await ws.write('repo/pkg/extra.md', 'extra')
    await ws.write('repo/pkg/deep/CLAUDE.md', 'deep rules')
    await ws.write('repo/pkg/deep/a.ts', 'code')
    await ws.write('repo/pkg/b.ts', 'code')
    await ws.write('repo/other/x.ts', 'code')
    cwd = ws.path('repo')
  })

  it('read 子目录文件：目录链上的指令（含其 import）按远到近附在该次结果末尾，原内容保留', async () => {
    const loads: string[][] = []
    const hook = nestedInstructionsHook({ loader, cwd, cokoHome, onLoad: (l) => loads.push(l.files.map((f) => f.path)) })
    const update = await call(hook, { tool: 'read', args: { path: 'pkg/deep/a.ts' } })
    expect(texts(update)).toEqual([
      'tool output',
      block('repo/pkg/extra.md', 'extra'),
      block('repo/pkg/AGENTS.md', 'pkg rules @./extra.md'),
      block('repo/pkg/deep/CLAUDE.md', 'deep rules'),
    ])
    expect(loads).toEqual([[ws.path('repo/pkg/extra.md'), ws.path('repo/pkg/AGENTS.md'), ws.path('repo/pkg/deep/CLAUDE.md')]])
  })

  it('已在上下文中的嵌套指令不重复附加；同一批的并行调用只附加一次', async () => {
    const hook = nestedInstructionsHook({ loader, cwd, cokoHome })
    const first = await call(hook, { tool: 'read', args: { path: 'pkg/b.ts' } })
    const previous: Message = { role: 'toolResult', content: first!.content as never }
    // 下一批：上下文中已有 pkg 的指令，只附加 deep 的。
    const later = await call(hook, { tool: 'ls', args: { path: 'pkg/deep' }, messages: [previous] })
    expect(texts(later).slice(1)).toEqual([block('repo/pkg/deep/CLAUDE.md', 'deep rules')])
    expect(await call(hook, { tool: 'read', args: { path: 'pkg/b.ts' }, messages: [previous] })).toBeUndefined()

    const batch = assistant()
    const [a, b] = await Promise.all([
      call(hook, { tool: 'read', args: { path: 'pkg/b.ts' }, assistantMessage: batch }),
      call(hook, { tool: 'grep', args: { pattern: 'x', path: 'pkg' }, assistantMessage: batch }),
    ])
    expect([a, b].filter(Boolean)).toHaveLength(1)
  })

  it.each([
    ['write', { path: 'pkg/new.ts', content: '' }],
    ['edit', { path: 'pkg/b.ts', edits: [] }],
    ['grep', { pattern: 'x', path: 'pkg' }],
    ['find', { pattern: '*.ts', path: 'pkg' }],
    ['ls', { path: 'pkg' }],
    ['grep', { pattern: 'x', path: 'pkg/b.ts' }],
  ])('%s 触及 pkg 时附加 pkg/AGENTS.md', async (tool, args) => {
    const update = await call(nestedInstructionsHook({ loader, cwd, cokoHome }), { tool, args })
    expect(texts(update)).toContain(block('repo/pkg/AGENTS.md', 'pkg rules @./extra.md'))
  })

  it.each([
    ['Workspace 根（已在系统提示中）', 'read', { path: 'x.ts' }, false],
    ['没有指令文件的目录', 'read', { path: 'other/x.ts' }, false],
    ['Workspace 之外', 'read', { path: '../outside.ts' }, false],
    ['不在列表中的工具', 'bash', { command: 'cat pkg/b.ts' }, false],
    ['调用出错', 'read', { path: 'pkg/b.ts' }, true],
    ['grep 没有给 path（Workspace 根）', 'grep', { pattern: 'x' }, false],
  ])('%s：不附加', async (_name, tool, args, isError) => {
    expect(await call(nestedInstructionsHook({ loader, cwd, cokoHome }), { tool, args, isError })).toBeUndefined()
  })
})
