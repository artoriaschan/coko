// 权限判定（ADR 0005）：纯函数，输入一次调用与当时的模式、规则、Workspace 与可写根，输出 allow / deny / ask。
// 顺序固定：拒绝规则 → 询问规则 → 受保护路径 → 越出可写根的文件写入 → 模式放行 → 允许规则 → 询问。
import { homedir } from 'node:os'
import { relative, sep } from 'node:path'
import type { PermissionMode, PermissionRule } from '../session-entries/index.ts'
import { analyzeCommand, commandMatches, isWithin, literalPathPattern, pathMatches, type CommandAnalysis } from './rules.ts'

export { isWithin } from './rules.ts'

/**
 * 权限类（M3，扩展 ADR 0005 的模式表）：宿主注册工具时给出（RegisterToolOptions.permissionClass），工具对象自身不能声明。
 * read / edit / bash 是内置工具的类；context-read（skill、memory_list、MCP 资源）所有模式放行；memory-write（规则组名 Memory）在
 * accept-edits 与 full-access 放行；external（mcp__*）只在 full-access 放行。
 */
export type PermissionClass = 'read' | 'edit' | 'bash' | 'context-read' | 'memory-write' | 'external'

/** 判定分组；规则以组名（Read、Edit、Bash、Memory）书写，其余工具按原名。 */
export type ToolCategory = 'read' | 'write' | 'command' | 'context-read' | 'memory-write' | 'external' | 'other'

const CATEGORY: Record<string, ToolCategory> = { read: 'read', grep: 'read', find: 'read', ls: 'read', write: 'write', edit: 'write', bash: 'command' }
const CLASS_CATEGORY: Record<PermissionClass, ToolCategory> = {
  read: 'read',
  edit: 'write',
  bash: 'command',
  'context-read': 'context-read',
  'memory-write': 'memory-write',
  external: 'external',
}
const RULE_TOOL: Partial<Record<ToolCategory, string>> = { read: 'Read', write: 'Edit', command: 'Bash', 'memory-write': 'Memory' }

/** MCP 工具名的前缀：`mcp__<server>__<tool>`。 */
export const MCP_TOOL_PREFIX = 'mcp__'

/**
 * 分组：内置工具按名字；宿主注册时给出权限类的按类；`mcp__` 开头的名字为 external（即使当前未注册）；其余（宿主的其他工具）
 * 归为 other，默认询问。
 */
export function toolCategory(toolName: string, permissionClass?: PermissionClass): ToolCategory {
  const builtin = CATEGORY[toolName]
  if (builtin) return builtin
  if (permissionClass) return CLASS_CATEGORY[permissionClass]
  return toolName.startsWith(MCP_TOOL_PREFIX) ? 'external' : 'other'
}

/** 规则中使用的工具名。 */
export function ruleToolName(toolName: string, permissionClass?: PermissionClass): string {
  return RULE_TOOL[toolCategory(toolName, permissionClass)] ?? toolName
}

/** 组名与内置工具名（小写）→ 规则工具名。 */
const RULE_ALIASES: Record<string, string> = Object.fromEntries([
  ...Object.keys(CATEGORY).map((name) => [name, ruleToolName(name)]),
  ...Object.values(RULE_TOOL).flatMap((group) => (group ? [[group.toLowerCase(), group]] : [])),
])

/**
 * 规则工具名的规范写法：内置工具名与组名（不区分大小写）归一为组名（`bash` → `Bash`，`write` / `edit` → `Edit`，
 * `grep` → `Read`，`memory` → `Memory`）；`mcp__` 开头的名字原样接受（MCP Server 可能尚未连接，规则 `mcp__<server>` 匹配该
 * Server 的全部工具）；其余名字按 `known`（宿主注册的其他工具名）不区分大小写匹配。都不是时返回 undefined（未知工具）。
 */
export function canonicalRuleTool(tool: string, known: readonly string[] = []): string | undefined {
  const lower = tool.toLowerCase()
  const alias = RULE_ALIASES[lower] ?? known.find((name) => name.toLowerCase() === lower)
  if (alias !== undefined) return alias
  return lower.startsWith(MCP_TOOL_PREFIX) && lower.length > MCP_TOOL_PREFIX.length ? tool : undefined
}

/**
 * 判定时比较的工具名：内置工具与组名按组名，其余不区分大小写（库中可能有旧的非规范写法）。`mcp__<server>` 的规则匹配该 Server
 * 的全部工具（`mcp__<server>__*`），不匹配名字以它开头的其他 Server。
 */
const matchesTool = (rule: PermissionRule, tool: string) => {
  const ruleTool = (RULE_ALIASES[rule.tool.toLowerCase()] ?? rule.tool).toLowerCase()
  const name = tool.toLowerCase()
  if (ruleTool === name) return true
  return ruleTool.startsWith(MCP_TOOL_PREFIX) && !ruleTool.slice(MCP_TOOL_PREFIX.length).includes('__') && name.startsWith(ruleTool + '__')
}

/** 文件工具的目标：resolved 为按 Workspace 解析的绝对路径，real 为经符号链接解析后的真实路径。 */
export interface PermissionTarget {
  resolved: string
  real: string
}

export interface PermissionCall {
  toolName: string
  /** 宿主注册时给出的权限类（内置工具不需要）。 */
  permissionClass?: PermissionClass
  /** 工具声明的判定对象：路径或命令（permissionSubject）。 */
  subject?: string
  /** 文件工具（read 与 edit 组）解析后的目标。 */
  target?: PermissionTarget
}

export interface PermissionContext {
  mode: PermissionMode
  rules: readonly PermissionRule[]
  /** Workspace 的真实路径。 */
  workspace: string
  /** 文件写入与命令沙箱共用的可写根（真实路径）；read-only 下为空，full-access 下为根目录。 */
  writableRoots: readonly string[]
  /** 额外读取根（真实路径，例如 Skill 目录）：其下的 read 组调用与 Workspace 内读取同样处理。 */
  readRoots?: readonly string[]
  /** `~/` 规则的主目录；缺省为 os.homedir()。 */
  home?: string
}

export type AskReason =
  /** 命中询问规则。 */
  | 'ask-rule'
  /** 写入受保护路径：任何模式都询问，允许规则不能免掉。 */
  | 'protected-path'
  /** 文件写入越出可写根：这次批准即这次提权，不能保存为规则。 */
  | 'outside-writable-roots'
  /** 读取 Workspace 之外的路径。 */
  | 'outside-workspace'
  /** 模式与规则都没有放行。 */
  | 'approval-required'

export type PermissionDecision =
  | { behavior: 'allow' }
  | { behavior: 'deny'; rule: PermissionRule }
  /** suggestions：可保存为"总是允许"的规则；受保护路径、越界写入、询问规则与无法拆分的命令为空。 */
  | { behavior: 'ask'; reason: AskReason; suggestions: PermissionRule[] }

/** 任意深度出现即受保护的目录（Workspace 内的版本库与编辑器配置）。 */
const PROTECTED_DIRS = new Set(['.git', '.coko', '.vscode', '.idea'])
/** 任意位置的 shell、git 与凭据配置。 */
const PROTECTED_NAMES = new Set(['.bashrc', '.zshrc', '.profile', '.bash_profile', '.zprofile', '.gitconfig', '.ssh', '.mcp.json'])
/**
 * 受保护的路径段（小写）：文件写入总要审批；受限档位的命令沙箱在可写根之下也拒绝写入它们（ADR 0005）。
 */
export const PROTECTED_PATH_NAMES: readonly string[] = [...PROTECTED_DIRS, ...PROTECTED_NAMES]

/** 比较前转小写（大小写不敏感的文件系统上 .GIT 即 .git）；解析前后的路径任一命中即受保护。 */
export function isProtectedPath(target: PermissionTarget): boolean {
  return [target.resolved, target.real].some((path) =>
    path
      .toLowerCase()
      .split(/[\\/]+/)
      .some((segment) => PROTECTED_DIRS.has(segment) || PROTECTED_NAMES.has(segment)),
  )
}

const toPosix = (path: string) => path.split(sep).join('/')

/** 一次判定中复用的调用事实。 */
interface Facts {
  call: PermissionCall
  context: PermissionContext
  category: ToolCategory
  home: string
  command: CommandAnalysis | undefined
}

/** 拒绝与询问规则：命令的任一片段（含剥离前后两种形式与完整命令）、路径的解析前或真实路径命中即算。 */
function restrictiveMatch(content: string, facts: Facts): boolean {
  const { call, context, category, command } = facts
  if (category === 'command') {
    if (!command) return false
    return [command.whole, ...command.subcommands.flatMap((s) => [s.raw, s.command])].some((candidate) => commandMatches(content, candidate))
  }
  if (category === 'read' || category === 'write') {
    const target = call.target
    return target !== undefined && [target.resolved, target.real].some((path) => pathMatches(content, path, context.workspace, facts.home))
  }
  return call.subject === content
}

/** 一个子命令是否被某条带内容的允许规则覆盖。 */
const commandAllowed = (command: string, allows: readonly PermissionRule[]) =>
  allows.some((rule) => rule.content !== undefined && commandMatches(rule.content, command))

/** 允许规则：命令须能可靠拆分且每个子命令都被允许；路径按真实路径匹配。 */
function allowedByRules(allows: readonly PermissionRule[], facts: Facts): boolean {
  if (allows.some((rule) => rule.content === undefined)) return true
  const { call, context, category, command } = facts
  if (category === 'command') {
    if (!command || command.complex || command.subcommands.length === 0) return false
    return command.subcommands.every((s) => commandAllowed(s.command, allows))
  }
  if (category === 'read' || category === 'write') {
    const target = call.target
    return target !== undefined && allows.some((rule) => pathMatches(rule.content!, target.real, context.workspace, facts.home))
  }
  return allows.some((rule) => rule.content === call.subject)
}

/** 读取目标在 Workspace 或某个额外读取根之内。 */
const readable = (real: string, context: PermissionContext) =>
  isWithin(real, context.workspace) || (context.readRoots ?? []).some((root) => isWithin(real, root))

function modeAllows(facts: Facts): boolean {
  const { category, call, context } = facts
  if (category === 'context-read') return true
  const target = call.target
  const readInside = category === 'read' && target !== undefined && readable(target.real, context)
  switch (context.mode) {
    case 'read-only':
    case 'default':
      return readInside
    case 'accept-edits':
      return (
        readInside ||
        category === 'memory-write' ||
        (category === 'write' && target !== undefined && context.writableRoots.some((root) => isWithin(target.real, root)))
      )
    case 'full-access':
      return true
  }
}

function suggest(facts: Facts, allows: readonly PermissionRule[]): PermissionRule[] {
  const { category, call, context, command } = facts
  const tool = ruleToolName(call.toolName, call.permissionClass)
  if (category === 'command') {
    if (!command || command.complex) return []
    const missing = [...new Set(command.subcommands.map((s) => s.command))].filter((s) => !commandAllowed(s, allows))
    return missing.map((content) => ({ behavior: 'allow', tool, content }))
  }
  if (category !== 'read' && category !== 'write') return [{ behavior: 'allow', tool }]
  const target = call.target
  if (!target) return []
  if (!isWithin(target.real, context.workspace)) return [{ behavior: 'allow', tool, content: literalPathPattern(target.resolved) }]
  const rel = toPosix(relative(context.workspace, target.real))
  if (rel === '') return [{ behavior: 'allow', tool, content: '.' }]
  // 不含斜杠的 gitignore 模式匹配任意深度：根下的文件以 ./ 锚定。
  return [{ behavior: 'allow', tool, content: literalPathPattern(rel.includes('/') ? rel : `./${rel}`) }]
}

/**
 * 目录工具（grep、find、ls）的结果过滤：路径是否被某条 Read 拒绝规则覆盖。没有带内容的 Read 拒绝规则时为 undefined
 * （不带内容的 Read 拒绝规则在判定时已拒绝整个调用）。
 */
export function readDenial(rules: readonly PermissionRule[], workspace: string, home: string = homedir()): ((path: string) => boolean) | undefined {
  const denies = rules.filter((rule) => rule.behavior === 'deny' && rule.content !== undefined && matchesTool(rule, 'Read'))
  if (denies.length === 0) return undefined
  return (path) => denies.some((rule) => pathMatches(rule.content!, path, workspace, home))
}

export function decide(call: PermissionCall, context: PermissionContext): PermissionDecision {
  const category = toolCategory(call.toolName, call.permissionClass)
  const facts: Facts = {
    call,
    context,
    category,
    home: context.home ?? homedir(),
    command: category === 'command' && call.subject !== undefined ? analyzeCommand(call.subject) : undefined,
  }
  const tool = ruleToolName(call.toolName, call.permissionClass)
  const own = context.rules.filter((rule) => matchesTool(rule, tool))
  const restrictive = (behavior: 'deny' | 'ask') =>
    own.find((rule) => rule.behavior === behavior && (rule.content === undefined || restrictiveMatch(rule.content, facts)))

  const deny = restrictive('deny')
  if (deny) return { behavior: 'deny', rule: deny }
  if (restrictive('ask')) return { behavior: 'ask', reason: 'ask-rule', suggestions: [] }

  const target = call.target
  if (category === 'write') {
    if (!target) return { behavior: 'ask', reason: 'approval-required', suggestions: [] }
    if (isProtectedPath(target)) return { behavior: 'ask', reason: 'protected-path', suggestions: [] }
    if (!context.writableRoots.some((root) => isWithin(target.real, root))) return { behavior: 'ask', reason: 'outside-writable-roots', suggestions: [] }
  }

  if (modeAllows(facts)) return { behavior: 'allow' }
  const allows = own.filter((rule) => rule.behavior === 'allow')
  if (allowedByRules(allows, facts)) return { behavior: 'allow' }

  const outside = category === 'read' && target !== undefined && !readable(target.real, context)
  return { behavior: 'ask', reason: outside ? 'outside-workspace' : 'approval-required', suggestions: suggest(facts, allows) }
}
