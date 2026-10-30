// 外部 Hook 的选择（ADR 0013）：matcher 匹配工具注册名或规则组名（不区分大小写；空与 * 匹配全部，名字或 | 分隔的名字列表按名字，
// 其余按正则）；if 用权限规则语法与判定的匹配器（Bash 复合命令任一子命令命中即匹配），由调用方给出 matchesRule。
import { SIMPLE_MATCHER, TOOL_HOOK_EVENTS, type HookCondition, type LoadedHook } from './config.ts'
import type { HookEvent } from './types.ts'

/** matcher 是否匹配候选名字之一（工具注册名、规则组名、子代理类型、压缩 trigger 等）。 */
export function matcherMatches(matcher: string | undefined, candidates: readonly string[]): boolean {
  if (matcher === undefined || matcher === '' || matcher === '*') return true
  const names = candidates.map((name) => name.toLowerCase())
  if (SIMPLE_MATCHER.test(matcher))
    return matcher
      .split('|')
      .map((part) => part.trim().toLowerCase())
      .some((part) => part !== '' && names.includes(part))
  try {
    const regex = new RegExp(matcher, 'i')
    return candidates.some((name) => regex.test(name))
  } catch {
    return false
  }
}

/** 选择一次调用要运行的 Hook 的对象。 */
export interface HookTarget {
  /** matcher 的候选（工具事件为注册名与规则组名）；没有 matcher 对象的事件省略。 */
  names?: readonly string[]
  /** if 条件的匹配（工具事件）；省略时带 if 的 Hook 不运行。 */
  matchesRule?: (condition: HookCondition) => boolean
}

/** 该事件中匹配的 Hook（按配置顺序；同一事件的匹配 Hook 并行执行）。 */
export function selectHooks(hooks: readonly LoadedHook[], event: HookEvent, target: HookTarget = {}): LoadedHook[] {
  return hooks.filter((hook) => {
    if (hook.event !== event) return false
    if (target.names && !matcherMatches(hook.matcher, target.names)) return false
    if (hook.condition && TOOL_HOOK_EVENTS.has(event)) return target.matchesRule?.(hook.condition) ?? false
    return true
  })
}
