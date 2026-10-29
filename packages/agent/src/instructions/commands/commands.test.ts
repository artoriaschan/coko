import { chmod, utimes, writeFile } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTempWorkspace, type TempWorkspace } from '../../testing/workspace.ts'
import { createCommandRegistry, createCommandTemplateLoader, type CommandDefinition } from './index.ts'

describe('命令模板的发现', () => {
  let ws: TempWorkspace
  beforeEach(async () => {
    ws = await createTempWorkspace('coko-commands-')
  })
  afterEach(async () => {
    await ws.dispose()
  })

  it('递归发现 .md，子目录以 : 拼名；frontmatter 只认 description 与 argument-hint', async () => {
    await ws.write('commands/review.md', '---\ndescription: Review a path\nargument-hint: <path>\nmodel: ignored\n---\nReview $1 carefully.\n')
    await ws.write('commands/git/commit.md', 'Write a commit message.\n')
    await ws.write('commands/git/deep/squash.md', '\n\n  Squash everything into one commit please, keeping the message tidy and short\n')
    await ws.write('commands/notes.txt', 'not a command')
    await ws.write('commands/.hidden/secret.md', 'skipped')
    const { templates, diagnostics } = await createCommandTemplateLoader().load(ws.path('commands'), 'user')
    expect(diagnostics).toEqual([])
    expect(templates.map(({ name, description, argumentHint, source, path }) => ({ name, description, argumentHint, source, path }))).toEqual([
      { name: 'git:commit', description: 'Write a commit message.', argumentHint: undefined, source: 'user', path: ws.path('commands/git/commit.md') },
      {
        name: 'git:deep:squash',
        // 缺省描述：首个非空行，超过 60 个字符截断。
        description: 'Squash everything into one commit please, keeping the messag...',
        argumentHint: undefined,
        source: 'user',
        path: ws.path('commands/git/deep/squash.md'),
      },
      { name: 'review', description: 'Review a path', argumentHint: '<path>', source: 'user', path: ws.path('commands/review.md') },
    ])
    expect(templates.find((t) => t.name === 'review')?.content).toBe('Review $1 carefully.')
  })

  it('目录不存在时为空且没有诊断', async () => {
    expect(await createCommandTemplateLoader().load(ws.path('missing'), 'project')).toEqual({ templates: [], diagnostics: [] })
  })

  it('格式错误的 frontmatter、错误类型的值、不合法的名字、空模板与读取失败产生诊断', async () => {
    const broken = await ws.write('cmds/broken.md', '---\ndescription: [unclosed\n---\nBody\n')
    const typed = await ws.write('cmds/typed.md', '---\ndescription: 42\nargument-hint: [a, b]\n---\nFirst line\n')
    const named = await ws.write('cmds/bad name.md', 'x')
    const empty = await ws.write('cmds/empty.md', '---\ndescription: nothing\n---\n\n')
    const locked = await ws.write('cmds/locked.md', 'secret')
    await chmod(locked, 0o000)
    try {
      const { templates, diagnostics } = await createCommandTemplateLoader().load(ws.path('cmds'), 'project')
      // 只有类型错误的那个仍被加载：忽略该键，描述取首个非空行。
      expect(templates.map((t) => [t.name, t.description, t.argumentHint])).toEqual([['typed', 'First line', undefined]])
      expect(diagnostics.map((d) => [d.code, d.path])).toEqual(
        expect.arrayContaining([
          ['invalid-frontmatter', broken],
          ['invalid-value', typed],
          ['invalid-value', typed],
          ['invalid-name', named],
          ['empty-template', empty],
          ['read-failed', locked],
        ]),
      )
      expect(diagnostics).toHaveLength(6)
      expect(diagnostics.every((d) => d.source === 'commands' && d.message !== '')).toBe(true)
    } finally {
      await chmod(locked, 0o600)
    }
  })

  it('文件未变时复用解析结果；改动后读到新内容', async () => {
    const path = await ws.write('c/a.md', 'one')
    const loader = createCommandTemplateLoader()
    expect((await loader.load(ws.path('c'), 'user')).templates[0]?.content).toBe('one')
    await writeFile(path, 'two!')
    const later = new Date(Date.now() + 5_000)
    await utimes(path, later, later)
    expect((await loader.load(ws.path('c'), 'user')).templates[0]?.content).toBe('two!')
  })
})

const def = (name: string, source: CommandDefinition['source'], extra: Partial<CommandDefinition> = {}): CommandDefinition => ({
  name,
  description: `${source} ${name}`,
  source,
  ...extra,
})

describe('命令注册表', () => {
  const on = { enabled: true, disabled: [] }

  it('同名按 内置 > 项目 > 用户 > Skill > MCP 取一个，被遮蔽的记诊断', () => {
    const registry = createCommandRegistry(
      [
        def('review', 'mcp'),
        def('review', 'user', { path: '/home/.coko/commands/review.md' }),
        def('review', 'project', { path: '/ws/.coko/commands/review.md' }),
        def('pdf', 'skill'),
        def('pdf', 'user', { path: '/home/.coko/commands/pdf.md' }),
        def('compact', 'builtin'),
        def('compact', 'project', { path: '/ws/.coko/commands/compact.md' }),
        def('solo', 'mcp'),
      ],
      on,
    )
    expect(registry.commands.map((c) => [c.name, c.source])).toEqual([
      ['compact', 'builtin'],
      ['review', 'project'],
      ['pdf', 'user'],
      ['solo', 'mcp'],
    ])
    expect(registry.get('review')?.description).toBe('project review')
    expect(registry.diagnostics).toEqual([
      expect.objectContaining({ source: 'commands', code: 'shadowed', path: '/ws/.coko/commands/compact.md' }),
      expect.objectContaining({ code: 'shadowed', path: '/home/.coko/commands/review.md' }),
      expect.objectContaining({ code: 'shadowed' }),
      expect.objectContaining({ code: 'shadowed' }),
    ])
    expect(registry.diagnostics[1]!.message).toContain('/ws/.coko/commands/review.md')
    expect(registry.diagnostics.map((d) => d.path)).toEqual(['/ws/.coko/commands/compact.md', '/home/.coko/commands/review.md', undefined, undefined])
  })

  it('commands.enabled 与 commands.disabled 只停用模板与 MCP 提示模板；内置与 Skill 不受影响；停用的仍遮蔽低优先级的同名命令', () => {
    const defs = [def('compact', 'builtin'), def('a', 'project'), def('b', 'user'), def('pdf', 'skill'), def('greet', 'mcp'), def('a', 'user')]
    const off = createCommandRegistry(defs, { enabled: false, disabled: [] })
    expect(off.commands.map((c) => [c.name, c.enabled])).toEqual([
      ['compact', true],
      ['a', false],
      ['b', false],
      ['pdf', true],
      ['greet', false],
    ])
    const some = createCommandRegistry(defs, { enabled: true, disabled: ['a', 'greet', 'pdf'] })
    expect(some.commands.map((c) => [c.name, c.source, c.enabled])).toEqual([
      ['compact', 'builtin', true],
      ['a', 'project', false],
      ['b', 'user', true],
      ['pdf', 'skill', true],
      ['greet', 'mcp', false],
    ])
    // Skill 来源自己给出的停用（skills.disabled）原样保留。
    expect(createCommandRegistry([def('pdf', 'skill', { enabled: false })], on).get('pdf')?.enabled).toBe(false)
  })
})
