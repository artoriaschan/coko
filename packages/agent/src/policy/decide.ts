// 权限判定（ADR 0005）：纯函数，输入一次调用与当时的模式、规则、Workspace 与可写根，输出 allow / deny / ask。
// 顺序固定：拒绝规则 → 询问规则 → 受保护路径 → 越出可写根的文件写入 → 模式放行 → 允许规则 → 询问。
import { isAbsolute, relative, sep } from 'node:path'
import type { PermissionMode, PermissionRule } from '../session-entries/index.ts'

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
  /** 文件写入与命令沙箱共用的可写根（真实路径）；read-only 下为空。 */
  writableRoots: readonly string[]
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
  /** suggestions：可保存为"总是允许"的规则；受保护路径、越界写入与询问规则为空。 */
  | { behavior: 'ask'; reason: AskReason; suggestions: PermissionRule[] }

/** child 是否为 root 本身或位于其下（按路径段比较，/ws/project-x 不在 /ws/project 内）。 */
export function isWithin(child: string, root: string): boolean {
  const rel = relative(root, child)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

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

/** 规则内容与调用的匹配：命令精确匹配；路径匹配 Workspace 相对路径、绝对路径或原样参数。完整语法见票 03。 */
function contentMatches(content: string, call: PermissionCall, context: PermissionContext): boolean {
  const category = toolCategory(call.toolName)
  if (category === 'read' || category === 'write') {
    const target = call.target
    if (!target) return false
    const candidates = [target.resolved, target.real]
    for (const path of candidates) if (isWithin(path, context.workspace)) candidates.push(toPosix(relative(context.workspace, path)) || '.')
    return candidates.includes(content) || call.subject === content
  }
  return call.subject === content
}

function findRule(behavior: PermissionRule['behavior'], call: PermissionCall, context: PermissionContext): PermissionRule | undefined {
  const tool = ruleToolName(call.toolName)
  return context.rules.find(
    (rule) => rule.behavior === behavior && rule.tool === tool && (rule.content === undefined || contentMatches(rule.content, call, context)),
  )
}

function modeAllows(call: PermissionCall, context: PermissionContext): boolean {
  const category = toolCategory(call.toolName)
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

function suggest(call: PermissionCall, context: PermissionContext): PermissionRule[] {
  const category = toolCategory(call.toolName)
  const tool = ruleToolName(call.toolName)
  if (category === 'command') return call.subject ? [{ behavior: 'allow', tool, content: call.subject }] : []
  if (category === 'other') return [{ behavior: 'allow', tool }]
  const target = call.target
  if (!target) return []
  const content = isWithin(target.real, context.workspace) ? toPosix(relative(context.workspace, target.real)) || '.' : target.resolved
  return [{ behavior: 'allow', tool, content }]
}

export function decide(call: PermissionCall, context: PermissionContext): PermissionDecision {
  const deny = findRule('deny', call, context)
  if (deny) return { behavior: 'deny', rule: deny }
  if (findRule('ask', call, context)) return { behavior: 'ask', reason: 'ask-rule', suggestions: [] }

  const category = toolCategory(call.toolName)
  const target = call.target
  if (category === 'write') {
    if (!target) return { behavior: 'ask', reason: 'approval-required', suggestions: [] }
    if (isProtectedPath(target)) return { behavior: 'ask', reason: 'protected-path', suggestions: [] }
    if (!context.writableRoots.some((root) => isWithin(target.real, root))) return { behavior: 'ask', reason: 'outside-writable-roots', suggestions: [] }
  }

  if (modeAllows(call, context)) return { behavior: 'allow' }
  if (findRule('allow', call, context)) return { behavior: 'allow' }

  const outside = category === 'read' && target !== undefined && !isWithin(target.real, context.workspace)
  return { behavior: 'ask', reason: outside ? 'outside-workspace' : 'approval-required', suggestions: suggest(call, context) }
}
