import { chmod, mkdir, symlink, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTempWorkspace, type TempWorkspace } from '../../testing/workspace.ts'
import {
  createSkillLoader,
  createSkillTool,
  expandSkillInvocation,
  SKILLS_SECTION_BUDGET,
  skillLocations,
  skillsSection,
  type Skill,
  type SkillLocation,
} from './index.ts'

const skillMd = (name: string, description = `Use ${name}`, extra = '') =>
  `---\nname: ${name}\ndescription: ${description}\n${extra}---\n# ${name}\n\nBody of ${name}.\n`

let ws: TempWorkspace
beforeEach(async () => {
  ws = await createTempWorkspace('coko-skills-')
})
afterEach(async () => {
  await ws.dispose()
})

const locations = (): SkillLocation[] => skillLocations({ cwd: ws.path('workspace'), cokoHome: ws.path('home/.coko') })
const brief = (skills: readonly Skill[]) => skills.map((s) => [s.name, s.scope, s.path])

describe('Skill 的位置', () => {
  it('项目 .coko > 项目 .agents > 用户 COKO_HOME/skills > 用户 .agents/skills（COKO_HOME 的同级，缺省即 ~/.agents）', () => {
    expect(skillLocations({ cwd: '/w', cokoHome: '/Users/me/.coko' })).toEqual([
      { dir: '/w/.coko/skills', scope: 'project', boundary: '/w' },
      { dir: '/w/.agents/skills', scope: 'project', boundary: '/w' },
      { dir: '/Users/me/.coko/skills', scope: 'user' },
      { dir: '/Users/me/.agents/skills', scope: 'user' },
    ])
    // COKO_HOME 为空时只有项目级。
    expect(skillLocations({ cwd: '/w', cokoHome: '' }).map((l) => l.scope)).toEqual(['project', 'project'])
  })
})

describe('Skill 的发现', () => {
  it('四个目录的发现与优先级；同名被遮蔽的记 shadowed；含 SKILL.md 的目录不再向下；跳过 . 目录与 node_modules；真实路径去重', async () => {
    await ws.write('workspace/.coko/skills/review/SKILL.md', skillMd('review', 'Project review'))
    await ws.write('workspace/.coko/skills/pdf/SKILL.md', skillMd('pdf', 'Project pdf'))
    await ws.write('workspace/.agents/skills/review/SKILL.md', skillMd('review', 'Agents review'))
    await ws.write('workspace/.agents/skills/lint/SKILL.md', skillMd('lint'))
    await ws.write('home/.coko/skills/pdf/SKILL.md', skillMd('pdf', 'User pdf'))
    await ws.write('home/.coko/skills/notes/SKILL.md', skillMd('notes', 'User notes'))
    // 嵌套的分组目录：向下找到 SKILL.md；skill 根之下的 SKILL.md 不再加载。
    await ws.write('home/.coko/skills/group/inner/SKILL.md', skillMd('inner'))
    await ws.write('home/.coko/skills/notes/nested/SKILL.md', skillMd('nested'))
    await ws.write('home/.coko/skills/.hidden/secret/SKILL.md', skillMd('secret'))
    await ws.write('home/.coko/skills/node_modules/dep/SKILL.md', skillMd('dep'))
    await ws.write('home/.agents/skills/notes/SKILL.md', skillMd('notes', 'Agents notes'))
    await ws.write('home/.agents/skills/deploy/SKILL.md', skillMd('deploy'))
    // 指向同一个 skill 目录的符号链接：按真实路径去重，不记遮蔽。
    await symlink(ws.path('workspace/.agents/skills/lint'), ws.path('home/.agents/skills/lint'))

    const { skills, diagnostics } = await createSkillLoader().discover(locations())
    expect(brief(skills)).toEqual([
      ['pdf', 'project', ws.path('workspace/.coko/skills/pdf/SKILL.md')],
      ['review', 'project', ws.path('workspace/.coko/skills/review/SKILL.md')],
      ['lint', 'project', ws.path('workspace/.agents/skills/lint/SKILL.md')],
      ['inner', 'user', ws.path('home/.coko/skills/group/inner/SKILL.md')],
      ['notes', 'user', ws.path('home/.coko/skills/notes/SKILL.md')],
      ['deploy', 'user', ws.path('home/.agents/skills/deploy/SKILL.md')],
    ])
    expect(skills.find((s) => s.name === 'pdf')).toMatchObject({ description: 'Project pdf', baseDir: ws.path('workspace/.coko/skills/pdf') })
    expect(diagnostics.map((d) => [d.code, d.path])).toEqual([
      ['shadowed', ws.path('workspace/.agents/skills/review/SKILL.md')],
      ['shadowed', ws.path('home/.coko/skills/pdf/SKILL.md')],
      ['shadowed', ws.path('home/.agents/skills/notes/SKILL.md')],
    ])
    expect(diagnostics.every((d) => d.source === 'skills' && d.message.length > 0)).toBe(true)
  })

  it('项目位置中经符号链接指向 Workspace 之外的 Skill 不加载并诊断；用户位置的符号链接照常加载', async () => {
    await ws.write('outside/tool/SKILL.md', skillMd('tool', 'Outside tool'))
    await ws.write('outside/whole/inner/SKILL.md', skillMd('inner', 'Outside inner'))
    await ws.write('workspace/.coko/skills/ok/SKILL.md', skillMd('ok'))
    await symlink(ws.path('outside/tool'), ws.path('workspace/.coko/skills/tool'))
    // 位置目录本身是链接。
    await mkdir(ws.path('workspace/.agents'), { recursive: true })
    await symlink(ws.path('outside/whole'), ws.path('workspace/.agents/skills'))
    await mkdir(ws.path('home/.coko/skills'), { recursive: true })
    await symlink(ws.path('outside/tool'), ws.path('home/.coko/skills/tool'))
    const { skills, diagnostics } = await createSkillLoader().discover(locations())
    expect(brief(skills)).toEqual([
      ['ok', 'project', ws.path('workspace/.coko/skills/ok/SKILL.md')],
      ['tool', 'user', ws.path('home/.coko/skills/tool/SKILL.md')],
    ])
    expect(diagnostics.map((d) => [d.code, d.path])).toEqual([
      ['skill-outside-workspace', ws.path('workspace/.coko/skills/tool/SKILL.md')],
      ['skill-outside-workspace', ws.path('workspace/.agents/skills/inner/SKILL.md')],
    ])
  })

  it('目录不存在时为空且没有诊断', async () => {
    expect(await createSkillLoader().discover(locations())).toEqual({ skills: [], diagnostics: [] })
  })

  const long = 'n'.repeat(65)
  const invalid: [string, string, string, string][] = [
    ['缺少 name', 'missing-name', 'invalid-name', '---\ndescription: x\n---\nbody\n'],
    ['没有 frontmatter', 'no-frontmatter', 'invalid-name', '# just a body\n'],
    ['name 含大写与下划线', 'Bad_Name', 'invalid-name', skillMd('Bad_Name')],
    ['name 以连字符开头', '-lead', 'invalid-name', skillMd('-lead')],
    ['name 含连续连字符', 'a--b', 'invalid-name', skillMd('a--b')],
    ['name 超过 64 个字符', long, 'invalid-name', skillMd(long)],
    ['name 与目录名不同', 'mine', 'name-mismatch', skillMd('other')],
    ['缺少 description', 'nodesc', 'missing-description', '---\nname: nodesc\n---\nbody\n'],
    ['description 为空白', 'blank', 'missing-description', '---\nname: blank\ndescription: "  "\n---\nbody\n'],
    ['description 超过 1024 个字符', 'long', 'description-too-long', skillMd('long', 'd'.repeat(1025))],
    ['frontmatter 不是合法的 YAML', 'broken', 'invalid-frontmatter', '---\nname: broken\ndescription: [unclosed\n---\nbody\n'],
    ['compatibility 超过 500 个字符', 'compat', 'invalid-value', skillMd('compat', 'ok', `compatibility: ${'c'.repeat(501)}\n`)],
    ['metadata 不是字符串映射', 'meta', 'invalid-value', skillMd('meta', 'ok', 'metadata:\n  count: 3\n')],
    ['allowed-tools 不是字符串或字符串列表', 'tools', 'invalid-value', skillMd('tools', 'ok', 'allowed-tools: 42\n')],
    ['disable-model-invocation 不是布尔值', 'flag', 'invalid-value', skillMd('flag', 'ok', 'disable-model-invocation: "yes"\n')],
  ]

  it.each(invalid)('%s：不加载并诊断', async (_label, dir, code, content) => {
    const path = await ws.write(`workspace/.coko/skills/${dir}/SKILL.md`, content)
    const { skills, diagnostics } = await createSkillLoader().discover(locations())
    expect(skills).toEqual([])
    expect(diagnostics).toEqual([expect.objectContaining({ source: 'skills', code, path })])
  })

  it('合规的可选字段：allowed-tools（空格分隔或列表，只记录）、license、metadata、未知键忽略；argument-hint 与 disable-model-invocation', async () => {
    await ws.write(
      'workspace/.coko/skills/pdf/SKILL.md',
      skillMd('pdf', 'Read PDFs', 'license: MIT\nallowed-tools: Bash(pdftotext:*) Read\nmetadata:\n  author: me\nargument-hint: <file>\nmodel: ignored\n'),
    )
    await ws.write('workspace/.coko/skills/ops/SKILL.md', skillMd('ops', 'Ops', 'allowed-tools:\n  - Bash(*)\n  - Edit\ndisable-model-invocation: true\n'))
    const { skills, diagnostics } = await createSkillLoader().discover(locations())
    expect(diagnostics).toEqual([])
    expect(
      skills.map(({ name, allowedTools, disableModelInvocation, argumentHint }) => ({ name, allowedTools, disableModelInvocation, argumentHint })),
    ).toEqual([
      { name: 'ops', allowedTools: ['Bash(*)', 'Edit'], disableModelInvocation: true, argumentHint: undefined },
      { name: 'pdf', allowedTools: ['Bash(pdftotext:*)', 'Read'], disableModelInvocation: false, argumentHint: '<file>' },
    ])
  })

  it('SKILL.md 无法读取时 read-failed', async () => {
    const path = await ws.write('workspace/.coko/skills/locked/SKILL.md', skillMd('locked'))
    await chmod(path, 0o000)
    try {
      const { skills, diagnostics } = await createSkillLoader().discover(locations())
      expect(skills).toEqual([])
      expect(diagnostics).toEqual([expect.objectContaining({ code: 'read-failed', path })])
    } finally {
      await chmod(path, 0o600)
    }
  })

  it('SKILL.md 未变时复用解析结果；改动后读到新的描述与正文', async () => {
    const path = await ws.write('workspace/.coko/skills/pdf/SKILL.md', skillMd('pdf', 'First'))
    const loader = createSkillLoader()
    const [first] = (await loader.discover(locations())).skills
    expect(first!.description).toBe('First')
    await writeFile(path, skillMd('pdf', 'Second').replace('Body of pdf.', 'Changed body.'))
    const later = new Date(Date.now() + 5_000)
    await utimes(path, later, later)
    const [second] = (await loader.discover(locations())).skills
    expect(second!.description).toBe('Second')
    expect((await loader.content(second!)).body).toBe('# pdf\n\nChanged body.')
  })
})

const skill = (name: string, overrides: Partial<Skill> = {}): Skill => ({
  name,
  description: `Use ${name}`,
  path: `/skills/${name}/SKILL.md`,
  baseDir: `/skills/${name}`,
  scope: 'user',
  allowedTools: [],
  disableModelInvocation: false,
  ...overrides,
})

describe('<available_skills> 索引', () => {
  it('列出 name、description 与 SKILL.md 路径（XML 转义）；disable-model-invocation 的不列；没有可列的时不注入', () => {
    const section = skillsSection([skill('pdf', { description: 'Read <PDF> & "forms"' }), skill('ops', { disableModelInvocation: true })])!
    expect(section.name).toBe('skills')
    expect(section.text.startsWith('<available_skills>\n')).toBe(true)
    expect(section.text.endsWith('</available_skills>')).toBe(true)
    expect(section.text).toContain('skill tool')
    expect(section.text).toContain(
      '<skill>\n<name>pdf</name>\n<description>Read &lt;PDF&gt; &amp; &quot;forms&quot;</description>\n<location>/skills/pdf/SKILL.md</location>\n</skill>',
    )
    expect(section.text).not.toContain('ops')
    expect(skillsSection([skill('ops', { disableModelInvocation: true })])).toBeUndefined()
    expect(skillsSection([])).toBeUndefined()
  })

  it('超过 8000 字符预算时：前面的完整列出，尾部只列名字并注明数量，合计不超过预算', () => {
    const many = Array.from({ length: 40 }, (_, i) => skill(`skill-${String(i).padStart(2, '0')}`, { description: 'x'.repeat(400) }))
    const text = skillsSection(many)!.text
    expect(SKILLS_SECTION_BUDGET).toBe(8000)
    expect(text.length).toBeLessThanOrEqual(8000)
    const full = [...text.matchAll(/<name>(skill-\d\d)<\/name>/g)].map((m) => m[1])
    expect(full.length).toBeGreaterThan(5)
    expect(full).toEqual(many.slice(0, full.length).map((s) => s.name))
    const rest = many.slice(full.length)
    expect(text).toContain(`${rest.length} more skills listed by name only: ${rest.map((s) => s.name).join(', ')}`)
    expect(text.endsWith('</available_skills>')).toBe(true)
  })

  it('名字也放不下时列出能放下的名字并注明其余的数量', () => {
    const many = Array.from({ length: 2000 }, (_, i) => skill(`skill-number-${i}`, { description: 'y'.repeat(100) }))
    const text = skillsSection(many)!.text
    expect(text.length).toBeLessThanOrEqual(8000)
    expect(text).toContain('skill-number-0')
    expect(text).toMatch(/\d+ more skills not listed/)
  })
})

describe('skill 工具与 /<skill-name> 展开', () => {
  async function pdfSkill() {
    await ws.write('workspace/.coko/skills/pdf/SKILL.md', skillMd('pdf', 'Read PDFs', 'allowed-tools: Bash(*)\n'))
    await ws.write('workspace/.coko/skills/pdf/reference.md', 'ref')
    await ws.write('workspace/.coko/skills/pdf/scripts/extract.sh', 'echo hi')
    await ws.write('workspace/.coko/skills/pdf/.cache/skip.txt', 'skip')
    const loader = createSkillLoader()
    const { skills } = await loader.discover(locations())
    return { loader, skills, baseDir: ws.path('workspace/.coko/skills/pdf') }
  }

  it('返回正文（去掉 frontmatter）、基目录、文件清单（相对路径，不含 SKILL.md 与 . 目录）与 args；权限类 context-read，判定对象为 skill 名', async () => {
    const { loader, skills, baseDir } = await pdfSkill()
    const { tool, permissionClass } = createSkillTool({ skills, loader })
    expect(permissionClass).toBe('context-read')
    expect(tool.name).toBe('skill')
    expect(tool.effect).toBe('read')
    expect(tool.permissionSubject?.({ name: 'pdf' })).toBe('pdf')
    const result = await tool.execute('c1', { name: 'pdf', args: 'report.pdf' })
    const text = (result.content[0] as { text: string }).text
    expect(text).toBe(
      [
        `<skill name="pdf" location="${baseDir}/SKILL.md">`,
        `Base directory for this skill: ${baseDir}`,
        'Relative paths in this skill are relative to the base directory.',
        '',
        '# pdf',
        '',
        'Body of pdf.',
        '',
        '<skill_files>',
        'reference.md',
        'scripts/extract.sh',
        '</skill_files>',
        '</skill>',
        '',
        'ARGUMENTS: report.pdf',
      ].join('\n'),
    )
    expect(result.details).toEqual({ name: 'pdf', path: `${baseDir}/SKILL.md`, baseDir, files: ['reference.md', 'scripts/extract.sh'], filesTruncated: false })
  })

  it('文件清单最多 50 项并注明截断；未知的名字与 disable-model-invocation 的 Skill 作为工具错误', async () => {
    await pdfSkill()
    for (let i = 0; i < 60; i++) await ws.write(`workspace/.coko/skills/pdf/refs/r${String(i).padStart(2, '0')}.md`, 'x')
    await ws.write('workspace/.coko/skills/ops/SKILL.md', skillMd('ops', 'Ops', 'disable-model-invocation: true\n'))
    const loader = createSkillLoader()
    const { skills } = await loader.discover(locations())
    const { tool } = createSkillTool({ skills, loader })
    const result = await tool.execute('c1', { name: 'pdf' })
    expect(result.details.files).toHaveLength(50)
    expect(result.details.filesTruncated).toBe(true)
    const text = (result.content[0] as { text: string }).text
    expect(text).toContain('(file list truncated at 50 entries)')
    expect(text).not.toContain('ARGUMENTS:')
    await expect(tool.execute('c2', { name: 'missing' })).rejects.toThrow(/Unknown skill "missing".*pdf/)
    await expect(tool.execute('c3', { name: 'ops' })).rejects.toThrow(/Unknown skill "ops"/)
  })

  it('/<skill-name> 展开为 <skill …> 块，参数原样附在其后；disable-model-invocation 的 Skill 同样可以显式调用', async () => {
    await ws.write('workspace/.coko/skills/ops/SKILL.md', skillMd('ops', 'Ops', 'disable-model-invocation: true\n'))
    const loader = createSkillLoader()
    const [ops] = (await loader.discover(locations())).skills
    const baseDir = ws.path('workspace/.coko/skills/ops')
    const expanded = expandSkillInvocation(ops!, await loader.content(ops!), 'deploy staging')
    expect(expanded.startsWith(`<skill name="ops" location="${baseDir}/SKILL.md">\nBase directory for this skill: ${baseDir}\n`)).toBe(true)
    expect(expanded).toContain('Body of ops.')
    expect(expanded.endsWith('</skill>\n\ndeploy staging')).toBe(true)
    expect(expandSkillInvocation(ops!, await loader.content(ops!), '')).toMatch(/<\/skill>$/)
  })

  it('子目录不可列出时跳过它，正文与其余文件照常返回', async () => {
    const { loader, skills, baseDir } = await pdfSkill()
    await mkdir(join(baseDir, 'locked'))
    await chmod(join(baseDir, 'locked'), 0o000)
    try {
      const content = await loader.content(skills[0]!)
      expect(content.body).toBe('# pdf\n\nBody of pdf.')
      expect(content.files).toEqual(['reference.md', 'scripts/extract.sh'])
    } finally {
      await chmod(join(baseDir, 'locked'), 0o700)
    }
  })
})
