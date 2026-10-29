// 命令参数：parseCommandArgs 与 substituteArgs 参照 pi coding-agent 的 core/prompt-templates.ts（v1.4.0，
// Copyright (c) 2025 Mario Zechner，MIT License）；"无占位符时追加 ARGUMENTS 行"参照 Claude Code 的做法。

/** 按 bash 习惯切分参数：空白分隔，单引号或双引号内保留空白，空引号是一个空参数。 */
export function parseCommandArgs(argsString: string): string[] {
  const args: string[] = []
  let current = ''
  let hasToken = false
  let inQuote: string | null = null
  for (const char of argsString) {
    if (inQuote) {
      if (char === inQuote) inQuote = null
      else current += char
    } else if (char === '"' || char === "'") {
      inQuote = char
      hasToken = true
    } else if (/\s/.test(char)) {
      if (hasToken) {
        args.push(current)
        current = ''
        hasToken = false
      }
    } else {
      current += char
      hasToken = true
    }
  }
  if (hasToken) args.push(current)
  return args
}

const PLACEHOLDER = /\$\{(\d+|ARGUMENTS|@):-([^}]*)\}|\$\{@:(\d+)(?::(\d+))?\}|\$(ARGUMENTS|@|\d+)/g

/**
 * 展开模板中的参数占位符：`$1`…、`$@` 与 `$ARGUMENTS`（全部参数）、`${N:-默认}`、`${@:-默认}`、`${@:N}`、`${@:N:L}`。
 * 只替换模板本身：参数与默认值中的占位符不再展开。模板没有任何占位符且有参数时，在末尾追加 `ARGUMENTS: <原始参数文本>`，
 * 使参数不被丢弃；raw 省略时按空格拼接 args。
 */
export function substituteArgs(content: string, args: readonly string[], raw?: string): string {
  const all = args.join(' ')
  let matched = false
  const out = content.replace(
    PLACEHOLDER,
    (_match, defaultTarget?: string, defaultValue?: string, sliceStart?: string, sliceLength?: string, simple?: string) => {
      matched = true
      if (defaultTarget) {
        const value = defaultTarget === '@' || defaultTarget === 'ARGUMENTS' ? all : args[Number.parseInt(defaultTarget, 10) - 1]
        return value ? value : (defaultValue ?? '')
      }
      if (sliceStart) {
        const start = Math.max(0, Number.parseInt(sliceStart, 10) - 1)
        return (sliceLength ? args.slice(start, start + Number.parseInt(sliceLength, 10)) : args.slice(start)).join(' ')
      }
      if (simple === 'ARGUMENTS' || simple === '@') return all
      return args[Number.parseInt(simple!, 10) - 1] ?? ''
    },
  )
  const text = raw ?? all
  if (!matched && text.trim() !== '') return `${out}\n\nARGUMENTS: ${text}`
  return out
}

/** 命令名的一段：字母、数字、点、下划线与连字符，首字符不是点；命名空间以 `:` 连接各段。 */
export const COMMAND_NAME_SEGMENT = /^[\p{L}\p{N}_-][\p{L}\p{N}._-]*$/u
const INVOCATION = /^\/([\p{L}\p{N}_-][\p{L}\p{N}._:-]*)(?:[ \t]+|\r?\n|$)/u

export interface CommandInvocation {
  name: string
  /** 名字之后的原始参数文本（去掉首尾空白）。 */
  args: string
}

/**
 * 识别草稿开头的 `/name 参数`：`/` 必须是第一个字符，名字之后是空白或结尾。`/usr/bin` 这类路径与不合法的名字不是调用。
 * 是否为已知命令由注册表判断。
 */
export function parseCommandInvocation(text: string): CommandInvocation | undefined {
  const match = INVOCATION.exec(text)
  if (!match) return undefined
  const name = match[1]!
  if (name.split(':').some((segment) => !COMMAND_NAME_SEGMENT.test(segment))) return undefined
  return { name, args: text.slice(match[0].length).trim() }
}
