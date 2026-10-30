// 扩展点：工具调用的 hook 链（tool-hooks.ts，M1 起）与外部 Hook（ADR 0013）：配置解析、选择、输出解释、聚合与组合表。
export { composeAfterToolCall, composeBeforeToolCall } from './tool-hooks.ts'
export type { HostBlock, ToolBlockResult, ToolHooks } from './tool-hooks.ts'
export type { HookDecision, HookEvent, HookEventContext, HookOutcome, HookSource, HookToolCall, HookVerdict } from './types.ts'
export {
  HOOK_DEFAULT_TIMEOUT_S,
  HOOK_EVENTS,
  HOOK_MAX_TIMEOUT_S,
  HOOK_NOTIFICATION_TIMEOUT_S,
  hookDigest,
  hookTimeoutMs,
  parseHooksConfig,
  TOOL_HOOK_EVENTS,
  validMatcher,
} from './config.ts'
export type { HookCondition, LoadedHook, ParsedHooks, ParseHooksOptions } from './config.ts'
export { matcherMatches, selectHooks } from './matcher.ts'
export type { HookTarget } from './matcher.ts'
export { interpretHookResult } from './output.ts'
export type { HookProcessResult, HookResult } from './output.ts'
export { aggregateVerdict, blockedByHookText, combinePreToolUse } from './combine.ts'
export type { CombinedDecision, SourcedHookResult } from './combine.ts'
