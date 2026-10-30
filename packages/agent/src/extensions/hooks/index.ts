// 扩展点：工具调用的 hook 链（tool-hooks.ts，M1 起）与外部 Hook 的类型（types.ts，ADR 0013）。
export { composeAfterToolCall, composeBeforeToolCall } from './tool-hooks.ts'
export type { HostBlock, ToolBlockResult, ToolHooks } from './tool-hooks.ts'
export type { HookDecision, HookEvent, HookEventContext, HookSource, HookToolCall, HookVerdict } from './types.ts'
