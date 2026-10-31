// 子代理定义（ADR 0014，docs/subsystems/subagents.md）：内置 general / explore，用户 ~/.coko/agents/*.md 与项目 <cwd>/.coko/agents/*.md 的
// Markdown frontmatter 解析与诊断、同名覆盖（project > user > builtin）、项目定义的符号链接检查（指出 Workspace 时不加载），以及工具交集与
// 有效模式的纯函数。字段沿用 claude-code 的子代理文件（name、description、tools、disallowed-tools、model、thinking、permission-mode、max-turns）。
import { realpath } from 'node:fs/promises'
import { isAbsolute, join, relative } from 'node:path'
import { createNodeFiles, diagnostic, parseFrontmatter, type ReadOnlyFiles, type ResourceDiagnostic } from '../instructions/shared/index.ts'
import { THINKING_LEVELS } from '../models/registry.ts'
import type { AgentDefinitionSource, PermissionMode, StandardPermissionMode } from '../session-entries/index.ts'
import { pluginResourceName, type PluginRoot } from '../extensions/plugins/types.ts'

/** 一个已加载的子代理定义。tools 省略时为父级本 Run 的全部可用工具（再减去固定排除集）。 */
export interface AgentDefinition {
  name: string
  description: string
  source: AgentDefinitionSource
  tools?: readonly string[]
  disallowedTools: readonly string[]
  /** <providerId>/<modelId>；省略为 inherit（父 Session 当前模型）。 */
  model?: string
  thinking?: string
  permissionMode?: StandardPermissionMode
  maxTurns: number
  /** 角色提示（正文）。 */
  prompt: string
  /** 文件定义的位置（内置没有）。 */
  path?: string
}

export const AGENT_DEFAULT_MAX_TURNS = 50
export const AGENT_MAX_TURNS_LIMIT = 200
const NAME = /^[a-z0-9-]{1,64}$/
const MODEL = /^[^/\s]+\/[^\s]+$/
const THINKING = new Set<string>(THINKING_LEVELS)

/** 模式的宽窄：read-only < default < accept-edits < full-access；plan 按 read-only 计（ADR 0014）。 */
export const PERMISSION_MODE_ORDER: readonly StandardPermissionMode[] = ['read-only', 'default', 'accept-edits', 'full-access']
const MODES = new Set<string>(PERMISSION_MODE_ORDER)
const modeRank = (mode: PermissionMode) => PERMISSION_MODE_ORDER.indexOf(mode === 'plan' ? 'read-only' : mode)

/** 模式与上限中较窄者（唯一的宽窄比较）；没有上限或上限不更窄时原样返回 mode（plan 不被同样窄的上限改成其他模式）。 */
export function narrowerMode<M extends PermissionMode>(mode: M, cap: StandardPermissionMode | undefined): M | StandardPermissionMode {
  return cap !== undefined && modeRank(cap) < modeRank(mode) ? cap : mode
}

/**
 * 子 Session 固定排除的工具：不能再派发子代理（深度 1）、不能读写 Goal、退出规划、定时任务、后台任务与 Memory 的写入。
 * schedule_* 按前缀排除（含之后新增的定时任务工具）。
 */
export const SUBAGENT_EXCLUDED_TOOLS: readonly string[] = [
  'agent',
  'agent_wait',
  'agent_cancel',
  'get_goal',
  'create_goal',
  'update_goal',
  'exit_plan_mode',
  'job_output',
  'job_list',
  'job_kill',
  'job_input',
  'memory_write',
  'memory_delete',
]
/** 子 Session 固定排除的工具（SUBAGENT_EXCLUDED_TOOLS 与 schedule_* 前缀）：定义的 tools 也不能加回。 */
export const isSubagentExcludedTool = (name: string) => SUBAGENT_EXCLUDED_TOOLS.includes(name) || name.startsWith('schedule_')

export const BUILTIN_AGENTS: readonly AgentDefinition[] = [
  {
    name: 'general',
    description: 'General-purpose agent for multi-step research or implementation tasks that should not fill the main context.',
    source: 'builtin',
    disallowedTools: [],
    maxTurns: AGENT_DEFAULT_MAX_TURNS,
    prompt:
      'You are a general-purpose subagent. Complete the task you were given using the available tools, then reply with a concise report of ' +
      'what you found or changed, including file paths.',
  },
  {
    name: 'explore',
    description: 'Read-only agent for searching and reading the codebase; returns findings with file paths and line numbers.',
    source: 'builtin',
    tools: ['read', 'grep', 'find', 'ls', 'bash'],
    disallowedTools: [],
    permissionMode: 'read-only',
    maxTurns: AGENT_DEFAULT_MAX_TURNS,
    prompt:
      'You are an exploration subagent. Only investigate: search and read files, and run read-only commands. Do not change anything. ' +
      'Reply with your conclusions, citing file paths and line numbers.',
  },
]

/** tools / disallowed-tools：逗号分隔的字符串或字符串列表；其他形状为 undefined（invalid-frontmatter）。 */
function toolList(value: unknown): string[] | undefined {
  if (typeof value === 'string')
    return value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  if (Array.isArray(value) && value.every((v) => typeof v === 'string')) return value.map((s) => s.trim()).filter(Boolean)
  return undefined
}

export interface ParseAgentOptions {
  source: Exclude<AgentDefinitionSource, 'builtin'>
  path: string
  /** 工具名是否已知（宿主的基础工具与贡献的工具）；未知的忽略该项并诊断 unknown-tool。省略时全部接受。 */
  knownTool?: (name: string) => boolean
  /** 模型是否在 Model Catalog 中；不在时回到 inherit 并诊断 unknown-model。省略时全部接受。 */
  knownModel?: (model: string) => boolean
}

/**
 * 解析一个定义文件。frontmatter 不合法、缺少 name / description、name 不合格式、permission-mode 或 max-turns 不合法时不加载
 * （invalid-frontmatter；不猜测更宽的值）；未知工具与模型只诊断。
 */
export function parseAgentDefinition(content: string, options: ParseAgentOptions): { definition?: AgentDefinition; diagnostics: ResourceDiagnostic[] } {
  const { path } = options
  const diagnostics: ResourceDiagnostic[] = []
  const invalid = (message: string) => ({ diagnostics: [...diagnostics, diagnostic('agents', 'invalid-frontmatter', message, path)] })
  const parsed = parseFrontmatter(content)
  if (!parsed.ok) return invalid(`Invalid frontmatter: ${parsed.error}`)
  const fm = parsed.frontmatter
  const name = fm.name
  if (typeof name !== 'string' || !NAME.test(name)) return invalid('name is required and must match [a-z0-9-]{1,64}')
  const description = fm.description
  if (typeof description !== 'string' || description.trim() === '') return invalid('description is required')
  let tools: string[] | undefined
  if (fm.tools !== undefined) {
    tools = toolList(fm.tools)
    if (!tools) return invalid('tools must be a comma-separated string or a list of names')
  }
  let disallowed: string[] = []
  if (fm['disallowed-tools'] !== undefined) {
    const list = toolList(fm['disallowed-tools'])
    if (!list) return invalid('disallowed-tools must be a comma-separated string or a list of names')
    disallowed = list
  }
  const known = (list: string[]) =>
    list.filter((tool) => {
      if (!options.knownTool || options.knownTool(tool)) return true
      diagnostics.push(diagnostic('agents', 'unknown-tool', `Unknown tool ${tool} ignored`, path))
      return false
    })
  if (tools) tools = known(tools)
  disallowed = known(disallowed)
  let model: string | undefined
  if (fm.model !== undefined && fm.model !== 'inherit') {
    if (typeof fm.model !== 'string' || !MODEL.test(fm.model) || (options.knownModel && !options.knownModel(fm.model)))
      diagnostics.push(diagnostic('agents', 'unknown-model', `Unknown model ${String(fm.model)}; the parent's model is used`, path))
    else model = fm.model
  }
  let thinking: string | undefined
  if (fm.thinking !== undefined) {
    if (typeof fm.thinking !== 'string' || !THINKING.has(fm.thinking)) return invalid(`thinking must be one of ${THINKING_LEVELS.join(', ')}`)
    thinking = fm.thinking
  }
  let permissionMode: StandardPermissionMode | undefined
  if (fm['permission-mode'] !== undefined) {
    if (typeof fm['permission-mode'] !== 'string' || !MODES.has(fm['permission-mode']))
      return invalid('permission-mode must be read-only, default, accept-edits or full-access')
    permissionMode = fm['permission-mode'] as StandardPermissionMode
  }
  let maxTurns = AGENT_DEFAULT_MAX_TURNS
  if (fm['max-turns'] !== undefined) {
    const value = fm['max-turns']
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > AGENT_MAX_TURNS_LIMIT)
      return invalid(`max-turns must be an integer from 1 to ${AGENT_MAX_TURNS_LIMIT}`)
    maxTurns = value
  }
  return {
    definition: {
      name,
      description: description.trim(),
      source: options.source,
      ...(tools ? { tools } : {}),
      disallowedTools: disallowed,
      ...(model ? { model } : {}),
      ...(thinking ? { thinking } : {}),
      ...(permissionMode ? { permissionMode } : {}),
      maxTurns,
      prompt: parsed.body,
      path,
    },
    diagnostics,
  }
}

const inside = (root: string, path: string) => {
  const rel = relative(root, path)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

export interface AgentDefinitionsInput {
  /** Session 的工作目录（项目定义在 <cwd>/.coko/agents）。 */
  cwd: string
  cokoHome: string
  knownTool?: (name: string) => boolean
  knownModel?: (model: string) => boolean
  /**
   * 已启用插件的 agents 目录（ADR 0017）：定义以 <plugin>:<name> 登记、source 为 user（插件是用户级资源）；真实路径须在插件目录之内
   * （path-outside-plugin），诊断的 source 为 plugin。
   */
  plugins?: readonly PluginRoot[]
}

export interface AgentCatalog {
  /** 生效的定义（同名只保留优先级最高的一个），按名字排序。 */
  definitions: AgentDefinition[]
  diagnostics: ResourceDiagnostic[]
}

export interface AgentDefinitionLoader {
  load(input: AgentDefinitionsInput): Promise<AgentCatalog>
}

/**
 * 每次调用按目录现读，文件内容按 mtime 与大小缓存（每个 Run 开始时读取）。项目定义（含 .coko/agents 目录本身）的真实路径须在 cwd 的真实
 * 路径之内，否则不加载（agent-outside-workspace）；用户定义不检查（用户自己的目录）。
 */
export function createAgentDefinitionLoader(files: ReadOnlyFiles = createNodeFiles()): AgentDefinitionLoader {
  const cache = new Map<string, { mtimeMs: number; size: number; content: string }>()
  const read = async (path: string) => {
    const info = await files.stat(path)
    if (!info || info.kind !== 'file') throw new Error('not a file')
    const hit = cache.get(path)
    if (hit && hit.mtimeMs === info.mtimeMs && hit.size === info.size) return hit.content
    const content = await files.readText(path)
    cache.set(path, { mtimeMs: info.mtimeMs, size: info.size, content })
    return content
  }
  const list = async (dir: string) => {
    try {
      return (await files.list(dir)).filter((e) => e.kind !== 'directory' && e.name.endsWith('.md')).map((e) => join(dir, e.name))
    } catch {
      return []
    }
  }
  return {
    async load(input) {
      const diagnostics: ResourceDiagnostic[] = []
      const byName = new Map<string, AgentDefinition>()
      for (const builtin of BUILTIN_AGENTS) byName.set(builtin.name, builtin)
      const root = await realpath(input.cwd).catch(() => input.cwd)
      const sources: { source: 'user' | 'project'; dir: string; plugin?: PluginRoot }[] = [
        { source: 'user', dir: join(input.cokoHome, 'agents') },
        { source: 'project', dir: join(input.cwd, '.coko', 'agents') },
        ...(input.plugins ?? []).map((plugin) => ({ source: 'user' as const, dir: plugin.path, plugin })),
      ]
      for (const { source, dir, plugin } of sources) {
        const seen = new Set<string>()
        const boundary = plugin ? await realpath(plugin.path).catch(() => plugin.path) : undefined
        for (const path of (await list(dir)).sort()) {
          if (source === 'project') {
            const real = await realpath(path).catch(() => undefined)
            if (!real || !inside(root, real)) {
              diagnostics.push(diagnostic('agents', 'agent-outside-workspace', 'The definition resolves outside the workspace and was not loaded', path))
              continue
            }
          }
          if (boundary !== undefined) {
            const real = await realpath(path).catch(() => undefined)
            if (!real || !inside(boundary, real)) {
              diagnostics.push(diagnostic('plugin', 'path-outside-plugin', `The definition of plugin ${plugin!.plugin} resolves outside the plugin`, path))
              continue
            }
          }
          let content: string
          try {
            content = await read(path)
          } catch (error) {
            diagnostics.push(diagnostic('agents', 'read-failed', error instanceof Error ? error.message : String(error), path))
            continue
          }
          const parsed = parseAgentDefinition(content, {
            source,
            path,
            ...(input.knownTool ? { knownTool: input.knownTool } : {}),
            ...(input.knownModel ? { knownModel: input.knownModel } : {}),
          })
          diagnostics.push(...(plugin ? parsed.diagnostics.map((d) => ({ ...d, source: 'plugin' as const })) : parsed.diagnostics))
          const definition =
            parsed.definition && plugin ? { ...parsed.definition, name: pluginResourceName(plugin.plugin, parsed.definition.name) } : parsed.definition
          if (!definition) continue
          if (seen.has(definition.name)) {
            diagnostics.push(diagnostic('agents', 'invalid-frontmatter', `Another ${source} definition already uses the name ${definition.name}`, path))
            continue
          }
          seen.add(definition.name)
          const shadowed = byName.get(definition.name)
          if (shadowed)
            diagnostics.push(
              diagnostic('agents', 'shadowed', `The ${shadowed.source} definition ${definition.name} is overridden by this ${source} definition`, path),
            )
          byName.set(definition.name, definition)
        }
      }
      return { definitions: [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)), diagnostics }
    },
  }
}

/** 子 Session 的工具：父级本 Run 可用工具 ∩ 定义 tools（省略为全部）− disallowed-tools − 固定排除集；保持父级的顺序。 */
export function subagentTools(parentTools: readonly string[], definition: Pick<AgentDefinition, 'tools' | 'disallowedTools'>): string[] {
  const allowed = definition.tools ? new Set(definition.tools) : undefined
  const denied = new Set(definition.disallowedTools)
  return parentTools.filter((name) => !isSubagentExcludedTool(name) && !denied.has(name) && (allowed === undefined || allowed.has(name)))
}

/**
 * 子 Session 的有效模式：根 Session 当前模式（plan 按 read-only：子级没有 exit_plan_mode）与定义的 permission-mode 中较窄者。
 * 每次判定时调用（根中途收紧，子级的下一次调用即按新模式）。
 */
export function effectiveSubagentMode(rootMode: StandardPermissionMode | 'plan', cap: StandardPermissionMode | undefined): StandardPermissionMode {
  return narrowerMode(rootMode === 'plan' ? 'read-only' : rootMode, cap)
}
