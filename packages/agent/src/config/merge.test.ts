// 分层能力配置（票 02）：默认 ← 全局 ← 项目，项目只能收紧（ADR 0008）；诊断不阻止其余键生效。
import { describe, expect, it } from 'vitest'
import { defaultCapabilityConfig, mergeCapabilityConfig, parseProjectSettings, type CapabilityConfig, type ProjectCapabilityValues } from './index.ts'

const PATH = '/w/.coko/settings.json'
const project = (value: unknown) => parseProjectSettings(typeof value === 'string' ? value : JSON.stringify(value), PATH)
const codes = (value: unknown) => project(value).diagnostics.map((d) => [d.code, d.message])

const config = (patch: (c: CapabilityConfig) => void): CapabilityConfig => {
  const c = defaultCapabilityConfig()
  patch(c)
  return c
}

describe('mergeCapabilityConfig', () => {
  it.each([
    ['只有默认', {}, undefined, defaultCapabilityConfig()],
    ['全局关闭 memory', { memory: { enabled: false } }, undefined, config((c) => (c.memory.enabled = false))],
    ['项目关闭全局开启的 mcp', {}, { mcp: { enabled: false } }, config((c) => (c.mcp.enabled = false))],
    ['全局关闭、项目不提：仍关闭', { context: { autoCompact: false } }, {}, config((c) => (c.context.autoCompact = false))],
    [
      '全局与项目的 skills.disabled 合并去重',
      { skills: { disabled: ['a', 'b'] } },
      { skills: { disabled: ['b', 'c'] } },
      config((c) => (c.skills.disabled = ['a', 'b', 'c'])),
    ],
    [
      '全局的部分值只覆盖给出的键',
      { context: { trimOldToolResults: false }, commands: { disabled: ['x'] } },
      undefined,
      config((c) => {
        c.context.trimOldToolResults = false
        c.commands.disabled = ['x']
      }),
    ],
  ])('%s', (_name, global, projectValues, expected) => {
    expect(mergeCapabilityConfig(global, projectValues as ProjectCapabilityValues | undefined)).toEqual(expected)
  })

  it('项目值为 true 不打开全局的 false（解析后被忽略并诊断）', () => {
    const parsed = project({ memory: { enabled: true }, instructions: { enabled: true } })
    expect(parsed.values).toEqual({})
    expect(mergeCapabilityConfig({ memory: { enabled: false } }, parsed.values).memory.enabled).toBe(false)
    expect(parsed.diagnostics.map((d) => d.code)).toEqual(['project-cannot-grant', 'project-cannot-grant'])
  })

  it('每次返回新对象，不改输入与默认值', () => {
    const global = { skills: { disabled: ['a'] } }
    const merged = mergeCapabilityConfig(global, { skills: { disabled: ['b'] } })
    merged.skills.disabled.push('z')
    expect(global).toEqual({ skills: { disabled: ['a'] } })
    expect(defaultCapabilityConfig().skills.disabled).toEqual([])
  })
})

describe('parseProjectSettings', () => {
  it('收紧项与 deny / ask 规则照常读入，没有诊断', () => {
    expect(
      project({
        skills: { enabled: false, disabled: ['deploy'] },
        context: { autoCompact: false },
        permissions: { deny: ['Bash(rm *)'], ask: ['Edit(src/**)'] },
      }),
    ).toEqual({
      values: { skills: { enabled: false, disabled: ['deploy'] }, context: { autoCompact: false } },
      rules: { deny: ['Bash(rm *)'], ask: ['Edit(src/**)'] },
      diagnostics: [],
    })
  })

  it.each([
    [
      'permissions.allow',
      { permissions: { allow: ['Bash(*)'] } },
      [['project-cannot-grant', 'permissions.allow is ignored: project settings cannot grant permissions']],
    ],
    [
      'permissions.defaultMode',
      { permissions: { defaultMode: 'full-access' } },
      [['project-cannot-grant', 'permissions.defaultMode is ignored: project settings cannot grant permissions']],
    ],
    [
      '值为 true 的开关',
      { mcp: { enabled: true } },
      [['project-cannot-grant', 'mcp.enabled: true is ignored: project settings can only turn capabilities off']],
    ],
    ['未知的顶层键', { theme: 'dark' }, [['unknown-key', 'Unknown key theme']]],
    ['未知的下层键', { memory: { enabled: false, scope: 'x' } }, [['unknown-key', 'Unknown key memory.scope']]],
    ['项目不能写 commands.disabled', { commands: { disabled: ['x'] } }, [['unknown-key', 'Unknown key commands.disabled']]],
    ['开关不是布尔值', { memory: { enabled: 'no' } }, [['invalid-value', 'memory.enabled must be a boolean']]],
    ['分区不是对象', { skills: false }, [['invalid-value', 'skills must be an object']]],
    ['skills.disabled 不是字符串数组', { skills: { disabled: 'deploy' } }, [['invalid-value', 'skills.disabled must be an array of non-empty strings']]],
    ['deny 不是数组', { permissions: { deny: 'Bash' } }, [['invalid-value', 'permissions.deny must be an array of rule strings']]],
  ])('%s', (_name, value, expected) => {
    expect(codes(value)).toEqual(expected)
  })

  it('不合 schema 的值只忽略该键，其余键照常生效', () => {
    const parsed = project({ memory: { enabled: 'off' }, mcp: { enabled: false }, permissions: { deny: ['Bash(echo *)', 42, ''], ask: ['Read'] } })
    expect(parsed.values).toEqual({ mcp: { enabled: false } })
    expect(parsed.rules).toEqual({ deny: ['Bash(echo *)'], ask: ['Read'] })
    expect(parsed.diagnostics.map((d) => [d.code, d.message])).toEqual([
      ['invalid-value', 'memory.enabled must be a boolean'],
      ['invalid-value', 'permissions.deny[1] must be a rule string such as Bash(git *)'],
      ['invalid-value', 'permissions.deny[2] must be a rule string such as Bash(git *)'],
    ])
  })

  it('规则文本的校验可由宿主给出（agent 不依赖协议的规则语法）', () => {
    const parsed = parseProjectSettings(JSON.stringify({ permissions: { deny: ['ok', 'bad'] } }), PATH, { isRule: (text) => text === 'ok' })
    expect(parsed.rules.deny).toEqual(['ok'])
    expect(parsed.diagnostics.map((d) => d.code)).toEqual(['invalid-value'])
  })

  it('JSON 解析失败时整个文件被忽略并诊断', () => {
    const parsed = project('{ "memory": { "enabled": false }, ')
    expect(parsed.values).toEqual({})
    expect(parsed.rules).toEqual({ deny: [], ask: [] })
    expect(parsed.diagnostics).toEqual([{ source: 'config', path: PATH, code: 'invalid-json', message: expect.stringMatching(/^Invalid JSON: /) }])
  })

  it('顶层不是对象时整个文件被忽略并诊断', () => {
    expect(codes([1, 2])).toEqual([['invalid-value', 'Project settings must be a JSON object']])
    expect(codes('null')).toEqual([['invalid-value', 'Project settings must be a JSON object']])
  })

  it('诊断带来源 config 与文件路径；BOM 与空对象没有诊断', () => {
    expect(project({ x: 1 }).diagnostics[0]).toMatchObject({ source: 'config', path: PATH })
    expect(project('\ufeff{}')).toEqual({ values: {}, rules: { deny: [], ask: [] }, diagnostics: [] })
  })
})
