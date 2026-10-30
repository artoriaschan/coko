// 外部 Hook 的配置（ADR 0013）：形状与 claude-code 相同 { [event]: [{ matcher?, hooks: [{ type: 'command', command, if?, timeout? }] }] }。
// 解析不抛出：问题作为诊断返回，未知 type 的 Hook 被忽略，其余照常加载。hookId 为来源 + 事件 + 位置；digest 为 event、matcher、if、command、
// timeout 的摘要（项目 Hook 按它逐条批准，改动后须重新批准）。
import { createHash } from 'node:crypto'
import { diagnostic, type ResourceDiagnostic } from '../../instructions/shared/index.ts'
import type { HookEvent, HookSource } from './types.ts'

export const HOOK_EVENTS: readonly HookEvent[] = [
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PermissionRequest',
  'UserPromptSubmit',
  'Stop',
  'SubagentStart',
  'SubagentStop',
  'PreCompact',
  'Notification',
]

/** 以工具为对象的事件：matcher 匹配工具注册名或规则组名，if 按权限规则匹配。 */
export const TOOL_HOOK_EVENTS: ReadonlySet<HookEvent> = new Set(['PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PermissionRequest'])

/** 超时（秒）：缺省 60，Notification 10，上限 600。 */
export const HOOK_DEFAULT_TIMEOUT_S = 60
export const HOOK_NOTIFICATION_TIMEOUT_S = 10
export const HOOK_MAX_TIMEOUT_S = 600

/** if 条件解析后的规则（与权限规则同形：工具组名与可选内容）。 */
export interface HookCondition {
  tool: string
  content?: string
}

/** 加载后的一条 Hook。 */
export interface LoadedHook {
  hookId: string
  source: HookSource
  event: HookEvent
  matcher?: string
  /** if 的原文。 */
  if?: string
  condition?: HookCondition
  command: string
  /** 配置中的超时（秒）；省略时按事件取缺省值。 */
  timeout?: number
  digest: string
}

export interface ParseHooksOptions {
  /** 规则文本的解析（宿主按协议的规则语法给出）；缺省接受 Tool 与 Tool(content)。 */
  parseRule?: (text: string) => HookCondition | undefined
  /** 诊断中的文件路径（项目文件）。 */
  path?: string
}

export interface ParsedHooks {
  hooks: LoadedHook[]
  diagnostics: ResourceDiagnostic[]
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** 缺省的规则解析：Tool 或 Tool(content)（不处理转义；宿主应注入协议的解析）。 */
const defaultParseRule = (text: string): HookCondition | undefined => {
  const match = /^([^()\s]+)(?:\((.*)\))?$/s.exec(text.trim())
  if (!match) return undefined
  const content = match[2]?.trim()
  return content ? { tool: match[1]!, content } : { tool: match[1]! }
}

/** 简单 matcher（名字或 | 分隔的名字列表）；其余按正则。 */
export const SIMPLE_MATCHER = /^[A-Za-z0-9_|]+$/

/** matcher 是否可用：空、*、名字列表，或能编译的正则。 */
export function validMatcher(matcher: string): boolean {
  if (matcher === '' || matcher === '*' || SIMPLE_MATCHER.test(matcher)) return true
  try {
    new RegExp(matcher, 'i')
    return true
  } catch {
    return false
  }
}

/** 项目 Hook 批准所用的摘要：event、matcher、if、command、timeout。 */
export function hookDigest(hook: {
  event: HookEvent
  matcher?: string | undefined
  if?: string | undefined
  command: string
  timeout?: number | undefined
}): string {
  const fields = [hook.event, hook.matcher ?? null, hook.if ?? null, hook.command, hook.timeout ?? null]
  return createHash('sha256').update(JSON.stringify(fields)).digest('hex')
}

/** 一条 Hook 的超时（毫秒）。 */
export function hookTimeoutMs(hook: Pick<LoadedHook, 'event' | 'timeout'>): number {
  const seconds = hook.timeout ?? (hook.event === 'Notification' ? HOOK_NOTIFICATION_TIMEOUT_S : HOOK_DEFAULT_TIMEOUT_S)
  return Math.min(seconds, HOOK_MAX_TIMEOUT_S) * 1000
}

/**
 * 解析 Hook 配置（全局设置的 hooks 值或项目文件的 hooks 键）。诊断：unsupported-hook-type（该 Hook 被忽略）、unknown-event、invalid-matcher、
 * invalid-if、invalid-value（该项被忽略）。键 enabled 是能力开关（只在全局，见 configuration.md），不是事件。
 */
export function parseHooksConfig(value: unknown, source: HookSource, options: ParseHooksOptions = {}): ParsedHooks {
  const parseRule = options.parseRule ?? defaultParseRule
  const result: ParsedHooks = { hooks: [], diagnostics: [] }
  const report = (code: string, message: string) => result.diagnostics.push(diagnostic('config', code, message, options.path))
  if (value === undefined) return result
  if (!isObject(value)) {
    report('invalid-value', 'hooks must be an object of events')
    return result
  }
  for (const [event, groups] of Object.entries(value)) {
    if (event === 'enabled') continue
    if (!(HOOK_EVENTS as readonly string[]).includes(event)) {
      report('unknown-event', `Unknown hook event ${event}`)
      continue
    }
    if (!Array.isArray(groups)) {
      report('invalid-value', `hooks.${event} must be an array of matcher groups`)
      continue
    }
    groups.forEach((group: unknown, g) => {
      const at = `hooks.${event}[${g}]`
      if (!isObject(group) || !Array.isArray(group.hooks)) {
        report('invalid-value', `${at} must be an object with a hooks array`)
        return
      }
      const matcher = group.matcher
      if (matcher !== undefined && (typeof matcher !== 'string' || !validMatcher(matcher))) {
        report('invalid-matcher', `${at}.matcher is not a tool name, a list of names or a valid regular expression`)
        return
      }
      group.hooks.forEach((hook: unknown, h) => {
        const where = `${at}.hooks[${h}]`
        if (!isObject(hook)) {
          report('invalid-value', `${where} must be an object`)
          return
        }
        if (hook.type !== 'command') {
          report('unsupported-hook-type', `${where}: type ${JSON.stringify(hook.type)} is not supported; only command hooks run`)
          return
        }
        if (typeof hook.command !== 'string' || hook.command.trim() === '') {
          report('invalid-value', `${where}.command must be a non-empty string`)
          return
        }
        const timeout = hook.timeout
        if (timeout !== undefined && (typeof timeout !== 'number' || !Number.isInteger(timeout) || timeout < 1 || timeout > HOOK_MAX_TIMEOUT_S)) {
          report('invalid-value', `${where}.timeout must be an integer number of seconds from 1 to ${HOOK_MAX_TIMEOUT_S}`)
          return
        }
        let condition: HookCondition | undefined
        if (hook.if !== undefined) {
          condition = typeof hook.if === 'string' ? parseRule(hook.if) : undefined
          if (!condition) {
            report('invalid-if', `${where}.if must be a permission rule such as Bash(git *)`)
            return
          }
        }
        const loaded: LoadedHook = {
          hookId: `${source}:${event}:${g}:${h}`,
          source,
          event: event as HookEvent,
          ...(matcher === undefined ? {} : { matcher }),
          ...(typeof hook.if === 'string' ? { if: hook.if } : {}),
          ...(condition ? { condition } : {}),
          command: hook.command,
          ...(timeout === undefined ? {} : { timeout }),
          digest: '',
        }
        loaded.digest = hookDigest(loaded)
        result.hooks.push(loaded)
      })
    })
  }
  return result
}
