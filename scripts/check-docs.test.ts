import { execFile } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { checkDocs, slugify, type Finding, type RuleId } from './check-docs.ts'

const run = promisify(execFile)
const script = fileURLToPath(new URL('./check-docs.ts', import.meta.url))
const tick = '\x60'
const md = (...lines: string[]): string => lines.join('\n') + '\n'
const doc = (fm: string[], ...body: string[]): string => md('---', ...fm, '---', '', ...body)
const meta = (kind = 'reference', ...extra: string[]): string[] => ['kind: ' + kind, 'description: "测试文档"', 'lifecycle: active', ...extra]

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function repo(files: Record<string, string>, symlinks: Record<string, string> = {}): string {
  const root = mkdtempSync(path.join(tmpdir(), 'coko-check-docs-'))
  roots.push(root)
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel)
    mkdirSync(path.dirname(abs), { recursive: true })
    writeFileSync(abs, content)
  }
  for (const [rel, target] of Object.entries(symlinks)) symlinkSync(target, path.join(root, rel))
  return root
}

/** 最小合法仓库：AGENTS → docs/README → docs/a.md。extraLinks 让新增页面从导航可达。 */
function base(extra: Record<string, string> = {}, extraLinks: string[] = []): Record<string, string> {
  return {
    'AGENTS.md': md('# AGENTS', '', '[导航](docs/README.md)'),
    'docs/README.md': doc(meta('index'), '# 导航', '', '- [主题](a.md)', ...extraLinks.map((link) => '- [页](' + link + ')')),
    'docs/a.md': doc(meta(), '# 主题', '', '## 第一 节', '', '正文。'),
    ...extra,
  }
}

const findings = (root: string): Pick<Finding, 'file' | 'line' | 'rule'>[] => checkDocs(root).findings.map(({ file, line, rule }) => ({ file, line, rule }))
const rules = (root: string): RuleId[] => checkDocs(root).findings.map((finding) => finding.rule)

describe('slugify', () => {
  it('matches GitHub anchors used by the docs', () => {
    expect(slugify('第一 节')).toBe('第一-节')
    expect(slugify('文件、轮转与脱敏')).toBe('文件轮转与脱敏')
    expect(slugify('Agent 与应用层的职责')).toBe('agent-与应用层的职责')
    expect(slugify('四 状态与晋升')).toBe('四-状态与晋升')
  })
})

describe('checkDocs', () => {
  it('accepts a consistent repository', () => {
    const root = repo(base())
    const result = checkDocs(root)
    expect(result.files).toEqual(['AGENTS.md', 'docs/README.md', 'docs/a.md'])
    expect(result.findings).toEqual([])
  })

  it('reports missing link targets with body line numbers after frontmatter', () => {
    const root = repo(base({ 'docs/a.md': doc(meta(), '# 主题', '', '[缺](missing.md)') }))
    expect(findings(root)).toEqual([{ file: 'docs/a.md', line: 9, rule: 'link-target' }])
  })

  it('checks anchors, including duplicate headings and self links', () => {
    const ok = repo(base({ 'docs/b.md': doc(meta(), '# B', '', '## 重复', '', '## 重复', '', '[a](a.md#第一-节) [b](#重复-1) [c](#b)') }, ['b.md']))
    expect(findings(ok)).toEqual([])
    const bad = repo(base({ 'docs/b.md': doc(meta(), '# B', '', '[a](a.md#不存在)') }, ['b.md']))
    expect(findings(bad)).toEqual([{ file: 'docs/b.md', line: 9, rule: 'link-anchor' }])
  })

  it('ignores links inside code and external URLs', () => {
    const body = ['# B', '', '~~~md', '[x](missing.md)', '~~~', '', tick + '[x](missing.md)' + tick, '', '[外部](https://example.com/x.md)']
    const root = repo(base({ 'docs/b.md': doc(meta(), ...body) }, ['b.md']))
    expect(findings(root)).toEqual([])
  })

  it('rejects formal references to concrete .scratch material but allows path patterns', () => {
    const scratch = { '.scratch/f/map.md': md('# 地图', '', '[主题](../../docs/a.md)') }
    const linked = repo(base({ ...scratch, 'docs/b.md': doc(meta(), '# B', '', '[地图](../.scratch/f/map.md)') }, ['b.md']))
    expect(findings(linked)).toEqual([{ file: 'docs/b.md', line: 9, rule: 'scratch-reference' }])
    const inlineCode = repo(base({ ...scratch, 'docs/b.md': doc(meta(), '# B', '', '见 ' + tick + '.scratch/f/map.md' + tick) }, ['b.md']))
    expect(findings(inlineCode)).toEqual([{ file: 'docs/b.md', line: 9, rule: 'scratch-reference' }])
    const patterns = repo(
      base({ ...scratch, 'docs/b.md': doc(meta(), '# B', '', tick + '.scratch/<feature>/spec.md' + tick + ' 与 ' + tick + '.scratch/' + tick) }, ['b.md']),
    )
    expect(findings(patterns)).toEqual([])
  })

  it('checks links inside .scratch without requiring frontmatter there', () => {
    const root = repo(base({ '.scratch/f/map.md': md('# 地图', '', '[缺](missing.md)') }))
    expect(findings(root)).toEqual([{ file: '.scratch/f/map.md', line: 3, rule: 'link-target' }])
  })

  it('requires docs frontmatter fields and registered values', () => {
    const missing = repo(base({ 'docs/b.md': md('# B') }, ['b.md']))
    expect(rules(missing)).toEqual(['frontmatter'])
    const noLifecycle = repo(base({ 'docs/b.md': doc(['kind: reference', 'description: "x"'], '# B') }, ['b.md']))
    expect(rules(noLifecycle)).toEqual(['frontmatter'])
    const badValues = repo(base({ 'docs/b.md': doc(['kind: note', 'description: "x"', 'lifecycle: current'], '# B') }, ['b.md']))
    expect(findings(badValues)).toEqual([
      { file: 'docs/b.md', line: 2, rule: 'frontmatter-value' },
      { file: 'docs/b.md', line: 4, rule: 'frontmatter-value' },
    ])
  })

  it('validates design status', () => {
    expect(rules(repo(base({ 'docs/b.md': doc(meta('design'), '# B') }, ['b.md'])))).toEqual(['frontmatter'])
    expect(rules(repo(base({ 'docs/b.md': doc(meta('design', 'status: done'), '# B') }, ['b.md'])))).toEqual(['frontmatter-value'])
    expect(rules(repo(base({ 'docs/b.md': doc(meta('design', 'status: draft'), '# B') }, ['b.md'])))).toEqual([])
  })

  it('keeps decision status and implementation consistent', () => {
    const check = (...extra: string[]): RuleId[] => rules(repo(base({ 'docs/b.md': doc(meta('decision', ...extra), '# B') }, ['b.md'])))
    expect(check('status: accepted')).toEqual(['frontmatter'])
    expect(check('status: proposed', 'implementation: partial')).toEqual(['frontmatter-value'])
    expect(check('status: accepted', 'implementation: done')).toEqual(['frontmatter-value'])
    expect(check('status: proposed', 'category: misc')).toEqual(['frontmatter-value'])
    expect(check('status: accepted', 'implementation: implemented', 'category: testing')).toEqual([])
  })

  it('enforces ADR file names and unique numbers', () => {
    const adr = (kind = 'decision'): string => doc(meta(kind, 'status: proposed'), '# 决定')
    const root = repo(
      base({ 'docs/adr/0001-a.md': adr(), 'docs/adr/0001-b.md': adr(), 'docs/adr/use-x.md': adr(), 'docs/adr/0002-c.md': adr('reference') }, [
        'adr/0001-a.md',
        'adr/0001-b.md',
        'adr/use-x.md',
        'adr/0002-c.md',
      ]),
    )
    expect(findings(root)).toEqual([
      { file: 'docs/adr/0001-b.md', line: 1, rule: 'adr-id' },
      { file: 'docs/adr/0002-c.md', line: 1, rule: 'frontmatter-value' },
      { file: 'docs/adr/use-x.md', line: 1, rule: 'adr-id' },
    ])
  })

  it('requires dates and a status notice for deprecated pages, which need not stay reachable', () => {
    const deprecated = ['kind: reference', 'description: "旧页"', 'lifecycle: deprecated']
    const bad = repo(base({ 'docs/old.md': doc(deprecated, '# 旧页') }))
    expect(findings(bad)).toEqual([{ file: 'docs/old.md', line: 4, rule: 'lifecycle-notice' }])
    expect(checkDocs(bad).findings).toHaveLength(1)
    const badMessages = checkDocs(repo(base({ 'docs/old.md': doc(deprecated, '# 旧页') }))).findings.map((f) => f.message)
    expect(badMessages.join('\n')).toContain('deprecated-at')
    const good = repo(base({ 'docs/old.md': doc([...deprecated, 'deprecated-at: 2026-10-28'], '# 旧页', '', '> 文档状态：已弃用，后继见 [主题](a.md)。') }))
    expect(findings(good)).toEqual([])
  })

  it('reports active docs that no entry path reaches', () => {
    const chain = repo(base({ 'docs/a.md': doc(meta(), '# 主题', '', '[c](c.md)'), 'docs/c.md': doc(meta(), '# C') }))
    expect(findings(chain)).toEqual([])
    const orphan = repo(base({ 'docs/orphan.md': doc(meta(), '# 孤页') }))
    expect(findings(orphan)).toEqual([{ file: 'docs/orphan.md', line: 1, rule: 'unreachable' }])
  })

  it('flags template placeholders outside docs/templates', () => {
    const body = ['# 填写设计主题', '', '| 列 | 值 |', '| --- | --- |', '| 填写 | 填写 |']
    const outside = repo(base({ 'docs/b.md': doc(meta(), ...body) }, ['b.md']))
    expect(findings(outside)).toEqual([
      { file: 'docs/b.md', line: 7, rule: 'template-placeholder' },
      { file: 'docs/b.md', line: 11, rule: 'template-placeholder' },
    ])
    const template = repo(base({ 'docs/templates/x.md': doc(meta(), ...body) }, ['templates/x.md']))
    expect(findings(template)).toEqual([])
  })

  it('requires CLAUDE.md to be a symlink to AGENTS.md', () => {
    expect(findings(repo(base({ 'CLAUDE.md': md('# 副本') })))).toEqual([{ file: 'CLAUDE.md', line: 1, rule: 'claude-link' }])
    expect(findings(repo(base(), { 'CLAUDE.md': 'AGENTS.md' }))).toEqual([])
  })
})

async function cli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const result = await run(process.execPath, [script, ...args])
    return { code: 0, stdout: result.stdout, stderr: result.stderr }
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string }
    return { code: failure.code ?? -1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' }
  }
}

describe('check-docs CLI', () => {
  it('exits 0 with a summary on a clean repository', async () => {
    const result = await cli(['--root', repo(base())])
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('检查 3 个 Markdown 文件，发现 0 个问题。')
  })

  it('exits 1 and prints file:line rule for each finding', async () => {
    const result = await cli(['--root', repo(base({ 'docs/a.md': doc(meta(), '# 主题', '', '[缺](missing.md)') }))])
    expect(result.code).toBe(1)
    expect(result.stdout).toContain('docs/a.md:9  link-target  链接目标不存在：missing.md')
  })

  it('fails when there is nothing to check and rejects unknown arguments', async () => {
    expect((await cli(['--root', repo({})])).code).toBe(1)
    expect((await cli(['--bogus'])).code).toBe(2)
  })
})
