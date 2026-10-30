import { utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Value } from 'typebox/value'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { capabilityConfigSchema, defaultCapabilityConfig } from '../../config/index.ts'
import { createTempWorkspace, type TempWorkspace } from '../../testing/workspace.ts'
import { createMtimeCache, createNodeFiles, diagnostic, parseFrontmatter } from './index.ts'

describe('parseFrontmatter', () => {
  it.each([
    ['没有 frontmatter', 'hello\n', { ok: true, frontmatter: {}, body: 'hello\n' }],
    [
      '映射与正文（CRLF 与 BOM 归一）',
      '\ufeff---\r\ndescription: Review\r\nargument-hint: <path>\r\n---\r\nBody $1\r\n',
      { ok: true, frontmatter: { description: 'Review', 'argument-hint': '<path>' }, body: 'Body $1' },
    ],
    ['空 frontmatter', '---\n---\nbody', { ok: true, frontmatter: {}, body: 'body' }],
    ['未闭合时整段为正文', '---\nname: x\nbody', { ok: true, frontmatter: {}, body: '---\nname: x\nbody' }],
  ])('%s', (_name, input, expected) => {
    expect(parseFrontmatter(input)).toEqual(expected)
  })

  it('YAML 错误与非映射作为结果返回，不抛出', () => {
    expect(parseFrontmatter('---\nname: [unclosed\n---\nbody')).toMatchObject({ ok: false, body: 'body' })
    expect(parseFrontmatter('---\n- a\n- b\n---\nbody')).toEqual({ ok: false, error: 'frontmatter must be a YAML mapping', body: 'body' })
  })
})

describe('createMtimeCache 与 Node 文件端口', () => {
  let ws: TempWorkspace
  beforeEach(async () => {
    ws = await createTempWorkspace('coko-shared-')
  })
  afterEach(async () => {
    await ws.dispose()
  })

  it('文件未变时不再解析；mtime 或大小变化后重新解析；不存在时 undefined', async () => {
    const path = await ws.write('AGENTS.md', 'one')
    let parses = 0
    const cache = createMtimeCache(createNodeFiles(), (text) => {
      parses++
      return text.toUpperCase()
    })
    expect(await cache.load(path)).toBe('ONE')
    expect(await cache.load(path)).toBe('ONE')
    expect(parses).toBe(1)
    await writeFile(path, 'two!')
    const later = new Date(Date.now() + 5_000)
    await utimes(path, later, later)
    expect(await cache.load(path)).toBe('TWO!')
    expect(parses).toBe(2)
    expect(await cache.load(join(ws.dir, 'missing.md'))).toBeUndefined()
    expect(await cache.load(ws.dir)).toBeUndefined()
  })

  it('list：按名字排序，标出文件与目录；目录不存在时 []', async () => {
    await ws.write('b.md', 'x')
    await ws.write('a/inner.md', 'y')
    const files = createNodeFiles()
    expect(await files.list(ws.dir)).toEqual([
      { name: 'a', kind: 'directory' },
      { name: 'b.md', kind: 'file' },
    ])
    expect(await files.list(join(ws.dir, 'nope'))).toEqual([])
    expect(await files.stat(join(ws.dir, 'nope'))).toBeUndefined()
  })

  it('diagnostic 只在给出路径时带 path', () => {
    expect(diagnostic('skills', 'invalid-frontmatter', 'bad', '/s/SKILL.md')).toEqual({
      source: 'skills',
      code: 'invalid-frontmatter',
      message: 'bad',
      path: '/s/SKILL.md',
    })
    expect(diagnostic('config', 'unknown-key', 'x')).toEqual({ source: 'config', code: 'unknown-key', message: 'x' })
  })
})

describe('能力配置默认值', () => {
  it('合 schema、全部开启，每次返回新对象', () => {
    const a = defaultCapabilityConfig()
    expect(Value.Check(capabilityConfigSchema, a)).toBe(true)
    expect(a).toEqual({
      instructions: { enabled: true },
      skills: { enabled: true, disabled: [] },
      commands: { enabled: true, disabled: [] },
      mcp: { enabled: true },
      memory: { enabled: true },
      context: { autoCompact: true, trimOldToolResults: true },
      hooks: { enabled: true },
      agents: { enabled: true },
      schedules: { enabled: true },
    })
    a.skills.disabled.push('x')
    expect(defaultCapabilityConfig().skills.disabled).toEqual([])
  })
})
