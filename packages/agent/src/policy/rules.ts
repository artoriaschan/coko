// 规则内容的匹配（permissions.md 的规则语法）：bash 命令的拆分、env 前缀剥离与精确 / 前缀匹配；read 与 edit 组的 gitignore 风格路径。
import { isAbsolute, relative, sep } from 'node:path'
import ignore, { type Ignore } from 'ignore'

/** 子命令超过此数时不凭允许规则放行（仍检查拒绝与询问规则）。 */
export const MAX_SUBCOMMANDS = 50

/** child 是否为 root 本身或位于其下（按路径段比较，/ws/project-x 不在 /ws/project 内）。 */
export function isWithin(child: string, root: string): boolean {
  const rel = relative(root, child)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

const toPosix = (path: string) => path.split(sep).join('/')

// ---- bash ----

export interface Subcommand {
  /** 规范空白后的原文。 */
  raw: string
  /** 剥掉安全的 env 赋值前缀后的命令；允许规则与建议按它匹配。 */
  command: string
}

export interface CommandAnalysis {
  /** 规范空白后的完整命令。 */
  whole: string
  /** 按 &&、||、;、|、&、换行以及命令替换的边界拆出的子命令。 */
  subcommands: Subcommand[]
  /**
   * 含命令替换（$(…)、反引号）、进程替换、子 shell、未闭合的引号，或子命令超过上限：结构不能可靠拆分，
   * 允许规则不能放行（拒绝与询问规则仍按拆出的片段检查）。
   */
  complex: boolean
}

const normalize = (text: string) => text.replace(/\s+/g, ' ').trim()

/** 可改变被执行程序本身或其加载内容的变量：作为前缀时保留，命令不按剥离后的形式匹配。 */
const UNSAFE_ENV =
  /^(?:LD_\w*|DYLD_\w*|PATH|BASH_ENV|ENV|IFS|SHELLOPTS|BASHOPTS|PROMPT_COMMAND|NODE_OPTIONS|PYTHONPATH|PYTHONSTARTUP|PERL5OPT|PERL5LIB|RUBYOPT|RUBYLIB|GIT_SSH|GIT_SSH_COMMAND|GIT_EXEC_PATH)$/

/** 剥离开头的安全 `NAME=value` 赋值（值可带引号）；遇到不安全的变量名即停止。只有赋值时原样返回。 */
export function stripEnvPrefix(command: string): string {
  let rest = command.trim()
  for (;;) {
    const name = /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(rest)
    if (!name || UNSAFE_ENV.test(name[1]!)) break
    let i = name[0].length
    let quote: string | undefined
    for (; i < rest.length; i++) {
      const c = rest[i]!
      if (quote) {
        if (c === quote) quote = undefined
        else if (c === '\\' && quote === '"') i++
      } else if (c === "'" || c === '"') quote = c
      else if (c === '\\') i++
      else if (/\s/.test(c)) break
    }
    if (quote) break
    const next = rest.slice(i).trimStart()
    if (next === '') break
    rest = next
  }
  return rest
}

/** 按 shell 的引号规则拆分复合命令。 */
export function analyzeCommand(command: string): CommandAnalysis {
  const pieces: string[] = []
  let current = ''
  let complex = false
  let quote: "'" | '"' | undefined
  const cut = () => {
    if (current.trim() !== '') pieces.push(current)
    current = ''
  }
  for (let i = 0; i < command.length; i++) {
    const c = command[i]!
    const next = command[i + 1]
    const prev = command[i - 1]
    if (quote === "'") {
      current += c
      if (c === "'") quote = undefined
      continue
    }
    if (c === '\\') {
      current += c + (next ?? '')
      i++
      continue
    }
    if (quote === '"') {
      if (c === '"') quote = undefined
      if (c === '`' || (c === '$' && next === '(')) {
        complex = true
        cut()
        if (c === '$') i++
        continue
      }
      current += c
      continue
    }
    if (c === "'" || c === '"') {
      quote = c
      current += c
      continue
    }
    if (c === '`' || (c === '$' && next === '(') || ((c === '<' || c === '>') && next === '(')) {
      complex = true
      cut()
      if (c !== '`') i++
      continue
    }
    if (c === '(' || c === ')') {
      complex = true
      cut()
      continue
    }
    if (c === ';' || c === '\n' || c === '\r') {
      cut()
      continue
    }
    if (c === '|') {
      // >| 是重定向。
      if (prev === '>') current += c
      else {
        cut()
        if (next === '|' || next === '&') i++
      }
      continue
    }
    if (c === '&') {
      // 2>&1、&> 与 <& 是重定向。
      if (prev === '>' || prev === '<' || next === '>') current += c
      else {
        cut()
        if (next === '&') i++
      }
      continue
    }
    current += c
  }
  if (quote) complex = true
  cut()
  const subcommands = pieces.map((piece) => {
    const raw = normalize(piece)
    return { raw, command: normalize(stripEnvPrefix(raw)) }
  })
  if (subcommands.length > MAX_SUBCOMMANDS) complex = true
  return { whole: normalize(command), subcommands, complex }
}

/** Bash 规则内容：精确匹配，或以 " *" 结尾的前缀（`git *` 匹配 `git` 与 `git …`）；单独的 `*` 匹配任何命令。 */
export function commandMatches(content: string, command: string): boolean {
  const pattern = normalize(content)
  if (pattern === '*') return true
  if (pattern.endsWith(' *')) {
    const prefix = pattern.slice(0, -2).trimEnd()
    return command === prefix || command.startsWith(`${prefix} `)
  }
  return command === pattern
}

// ---- 路径 ----

const matchers = new Map<string, Ignore>()
function matcher(pattern: string): Ignore {
  let found = matchers.get(pattern)
  if (!found) {
    if (matchers.size > 500) matchers.clear()
    found = ignore().add(pattern)
    matchers.set(pattern, found)
  }
  return found
}

/**
 * 路径规则内容（gitignore 语法，大小写不敏感）：相对模式相对 Workspace 根（不含斜杠的模式匹配任意深度，`./` 开头锚定在根）；
 * `/` 开头为绝对路径；`~/` 开头相对主目录。模式匹配一个目录即覆盖其下全部路径。`.`、`~`、`/` 匹配该位置本身及其下。
 */
export function pathMatches(content: string, path: string, workspace: string, home: string): boolean {
  let pattern = content.trim()
  let base = workspace
  if (pattern === '~' || pattern.startsWith('~/')) {
    base = home
    pattern = `/${pattern.slice(2)}`
  } else if (pattern.startsWith('/')) base = '/'
  else if (pattern.startsWith('./')) pattern = `/${pattern.slice(2)}`
  else if (pattern === '.') pattern = '/'
  if (!isWithin(path, base)) return false
  if (/^\/*$/.test(pattern)) return true
  const rel = toPosix(relative(base, path))
  if (rel === '') return false
  try {
    return matcher(pattern).ignores(rel)
  } catch {
    return false
  }
}

/** 把一个具体路径写成只匹配它本身（及其下）的规则内容：转义 gitignore 的特殊字符。 */
export function literalPathPattern(path: string): string {
  return path.replace(/[\\*?[\]]/g, (c) => `\\${c}`).replace(/^([!#])/, '\\$1')
}
