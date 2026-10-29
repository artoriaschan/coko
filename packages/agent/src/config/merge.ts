// 分层能力配置（docs/subsystems/configuration.md，ADR 0008）：有效值 = 默认 ← 全局（设置键 config）← 项目（<Workspace>/.coko/settings.json）。
// 项目只能收紧：开关只有 false 生效，skills.disabled 追加，permissions.deny / ask 作为 project 作用域的规则；授予类的键被忽略并诊断。
// 诊断不阻止其余键生效；JSON 解析失败时整个文件被忽略。
import { diagnostic, type ResourceDiagnostic } from '../instructions/shared/index.ts'
import { defaultCapabilityConfig, type CapabilityConfig } from './schema.ts'

type Section = keyof CapabilityConfig

/** 全局值：每个分区的部分键（已按协议 schema 校验；省略的键取默认）。 */
export type CapabilityConfigPatch = { [S in Section]?: Partial<CapabilityConfig[S]> }

/** 项目值：只有收紧项（开关为 false、追加禁用的 Skill）。 */
export interface ProjectCapabilityValues {
  instructions?: { enabled?: false }
  skills?: { enabled?: false; disabled?: string[] }
  commands?: { enabled?: false }
  mcp?: { enabled?: false }
  memory?: { enabled?: false }
  context?: { autoCompact?: false; trimOldToolResults?: false }
}

/** 项目的拒绝与询问规则（规则文本，如 Bash(rm *)），作为只读的 project 作用域参与判定。 */
export interface ProjectRuleTexts {
  deny: string[]
  ask: string[]
}

export interface ProjectSettings {
  values: ProjectCapabilityValues
  rules: ProjectRuleTexts
  diagnostics: ResourceDiagnostic[]
}

export interface ParseProjectSettingsOptions {
  /** 规则文本是否合法（宿主按协议的规则语法给出）；缺省只要求非空字符串。 */
  isRule?: (text: string) => boolean
}

/** 项目文件中可以追加的列表键（commands.disabled 不在其中：项目不能禁用命令以外的写法，见规格）。 */
const PROJECT_LISTS: Partial<Record<Section, readonly string[]>> = { skills: ['disabled'] }
const PERMISSION_RULE_KEYS = ['deny', 'ask'] as const
const PERMISSION_GRANT_KEYS = ['allow', 'defaultMode']

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isNameList = (value: unknown): value is string[] => Array.isArray(value) && value.every((v) => typeof v === 'string' && v.length > 0)

/** 解析项目设置文件的文本；不抛出，问题都作为诊断返回。 */
export function parseProjectSettings(text: string, path: string, options: ParseProjectSettingsOptions = {}): ProjectSettings {
  const isRule = options.isRule ?? ((rule: string) => rule.trim() !== '')
  const result: ProjectSettings = { values: {}, rules: { deny: [], ask: [] }, diagnostics: [] }
  const report = (code: string, message: string) => result.diagnostics.push(diagnostic('config', code, message, path))

  let root: unknown
  try {
    root = JSON.parse(text.replace(/^\ufeff/, ''))
  } catch (error) {
    report('invalid-json', `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`)
    return result
  }
  if (!isObject(root)) {
    report('invalid-value', 'Project settings must be a JSON object')
    return result
  }

  const defaults = defaultCapabilityConfig()
  for (const [key, value] of Object.entries(root)) {
    if (key === 'permissions') {
      readPermissions(value, result, report, isRule)
      continue
    }
    if (!Object.hasOwn(defaults, key)) {
      report('unknown-key', `Unknown key ${key}`)
      continue
    }
    const section = key as Section
    if (!isObject(value)) {
      report('invalid-value', `${key} must be an object`)
      continue
    }
    const target: Record<string, unknown> = {}
    const known = defaults[section] as Record<string, unknown>
    for (const [name, item] of Object.entries(value)) {
      const at = `${key}.${name}`
      if (typeof known[name] === 'boolean') {
        if (typeof item !== 'boolean') report('invalid-value', `${at} must be a boolean`)
        else if (item) report('project-cannot-grant', `${at}: true is ignored: project settings can only turn capabilities off`)
        else target[name] = false
      } else if (PROJECT_LISTS[section]?.includes(name)) {
        if (isNameList(item)) target[name] = [...item]
        else report('invalid-value', `${at} must be an array of non-empty strings`)
      } else report('unknown-key', `Unknown key ${at}`)
    }
    if (Object.keys(target).length > 0) (result.values as Record<string, unknown>)[section] = target
  }
  return result
}

function readPermissions(value: unknown, result: ProjectSettings, report: (code: string, message: string) => void, isRule: (text: string) => boolean) {
  if (!isObject(value)) {
    report('invalid-value', 'permissions must be an object')
    return
  }
  for (const [name, item] of Object.entries(value)) {
    const at = `permissions.${name}`
    if (PERMISSION_GRANT_KEYS.includes(name)) {
      report('project-cannot-grant', `${at} is ignored: project settings cannot grant permissions`)
      continue
    }
    const behavior = PERMISSION_RULE_KEYS.find((k) => k === name)
    if (!behavior) {
      report('unknown-key', `Unknown key ${at}`)
      continue
    }
    if (!Array.isArray(item)) {
      report('invalid-value', `${at} must be an array of rule strings`)
      continue
    }
    item.forEach((rule: unknown, index) => {
      if (typeof rule === 'string' && rule.trim() !== '' && isRule(rule)) result.rules[behavior].push(rule.trim())
      else report('invalid-value', `${at}[${index}] must be a rule string such as Bash(git *)`)
    })
  }
}

/** 有效配置：默认 ← 全局 ← 项目。开关取"与"，禁用列表取并集（去重，保持首次出现的顺序）。每次返回新对象。 */
export function mergeCapabilityConfig(global: CapabilityConfigPatch, project: ProjectCapabilityValues = {}): CapabilityConfig {
  const merged = defaultCapabilityConfig()
  // 全局的开关替换默认值，项目的开关与当前值取"与"；列表都取并集。
  const apply = (section: Section, layer: object | undefined, combine: (current: boolean, value: boolean) => boolean) => {
    const target = merged[section] as Record<string, unknown>
    for (const [name, value] of Object.entries(layer ?? {})) {
      const current = target[name]
      if (typeof current === 'boolean' && typeof value === 'boolean') target[name] = combine(current, value)
      else if (Array.isArray(current) && Array.isArray(value)) target[name] = [...new Set([...(current as string[]), ...(value as string[])])]
    }
  }
  for (const section of Object.keys(merged) as Section[]) {
    apply(section, global[section], (_current, value) => value)
    apply(section, (project as CapabilityConfigPatch)[section], (current, value) => current && value)
  }
  return merged
}
