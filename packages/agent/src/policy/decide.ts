// 权限判定（ADR 0005）：纯函数，输入一次调用与当时的模式、规则、Workspace 与可写根，输出 allow / deny / ask。
// 顺序固定：拒绝规则 → 询问规则 → 受保护路径 → 越出可写根的文件写入 → 模式放行 → 允许规则 → 询问。
import { homedir } from 'node:os'
import { relative, sep } from 'node:path'
import type { PermissionMode, PermissionRule } from '../session-entries/index.ts'
import { analyzeCommand, commandMatches, isWithin, literalPathPattern, pathMatches, type CommandAnalysis } from './rules.ts'

export { isWithin } from './rules.ts'

/** 内置工具的判定分组；规则以组名（Read、Edit、Bash）书写，其余工具按原名。 */
export type ToolCategory = 'read' | 'write' | 'command' | 'other'

const CATEGORY: Record<string, ToolCategory> = { read: 'read', grep: 'read', find: 'read', ls: 'read', write: 'write', edit: 'write', bash: 'command' }
const RULE_TOOL: Record<ToolCategory, string | undefined> = { read: 'Read', write: 'Edit', command: 'Bash', other: undefined }

/** 按工具名分组：未知工具（含宿主新增的工具）归为 other，默认询问。 */
export function toolCategory(toolName: string): ToolCategory {
  return CATEGORY[toolName] ?? 'other'
}

/** 规则中使用的工具名。 */
export function ruleToolName(toolName: string): string {
  return RULE_TOOL[toolCategory(toolName)] ?? toolName
}

/** 文件工具的目标：resolved 为按 Workspace 解析的绝对路径，real 为经符号链接解析后的真实路径。 */
export interface PermissionTarget {
  resolved: string
  real: string
}

export interface PermissionCall {
  toolName: string
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

function modeAllows(facts: Facts): boolean {
  const { category, call, context } = facts
  const target = call.target
  const readInside = category === 'read' && target !== undefined && isWithin(target.real, context.workspace)
  switch (context.mode) {
    case 'read-only':
    case 'default':
      return readInside
    case 'accept-edits':
      return readInside || (category === 'write' && target !== undefined && context.writableRoots.some((root) => isWithin(target.real, root)))
    case 'full-access':
      return true
  }
}

function suggest(facts: Facts, allows: readonly PermissionRule[]): PermissionRule[] {
  const { category, call, context, command } = facts
  const tool = ruleToolName(call.toolName)
  if (category === 'command') {
    if (!command || command.complex) return []
    const missing = [...new Set(command.subcommands.map((s) => s.command))].filter((s) => !commandAllowed(s, allows))
    return missing.map((content) => ({ behavior: 'allow', tool, content }))
  }
  if (category === 'other') return [{ behavior: 'allow', tool }]
  const target = call.target
  if (!target) return []
  if (!isWithin(target.real, context.workspace)) return [{ behavior: 'allow', tool, content: literalPathPattern(target.resolved) }]
  const rel = toPosix(relative(context.workspace, target.real))
  if (rel === '') return [{ behavior: 'allow', tool, content: '.' }]
  // 不含斜杠的 gitignore 模式匹配任意深度：根下的文件以 ./ 锚定。
  return [{ behavior: 'allow', tool, content: literalPathPattern(rel.includes('/') ? rel : `./${rel}`) }]
}

export function decide(call: PermissionCall, context: PermissionContext): PermissionDecision {
  const category = toolCategory(call.toolName)
  const facts: Facts = {
    call,
    context,
    category,
    home: context.home ?? homedir(),
    command: category === 'command' && call.subject !== undefined ? analyzeCommand(call.subject) : undefined,
  }
  const tool = ruleToolName(call.toolName)
  const own = context.rules.filter((rule) => rule.tool === tool)
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

  const outside = category === 'read' && target !== undefined && !isWithin(target.real, context.workspace)
  return { behavior: 'ask', reason: outside ? 'outside-workspace' : 'approval-required', suggestions: suggest(facts, allows) }
}
