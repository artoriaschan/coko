import type { AfterToolCallContext, AfterToolCallResult, BeforeToolCallContext, BeforeToolCallResult } from '@earendil-works/pi-agent-core'

/**
 * Minimal tool-call dispatch points (M1). Built-in and host tools pass through the same chain;
 * M2 attaches permission checks and observation here.
 */
export interface ToolHooks {
  /** Return `{ block: true, reason }` to stop the call; the model receives an error result. */
  beforeToolCall?: (context: BeforeToolCallContext, signal?: AbortSignal) => Promise<BeforeToolCallResult | undefined>
  /** Return fields to replace in the result (no deep merge). */
  afterToolCall?: (context: AfterToolCallContext, signal?: AbortSignal) => Promise<AfterToolCallResult | undefined>
}

/** Before hooks run in order; the first block wins. */
export function composeBeforeToolCall(hooks: readonly ToolHooks[]) {
  const handlers = hooks.flatMap((hook) => (hook.beforeToolCall ? [hook.beforeToolCall] : []))
  return async (context: BeforeToolCallContext, signal?: AbortSignal): Promise<BeforeToolCallResult | undefined> => {
    for (const handler of handlers) {
      const result = await handler(context, signal)
      if (result?.block) return result
    }
    return undefined
  }
}

/** After hooks run in order; each sees the result as replaced by the previous ones. */
export function composeAfterToolCall(hooks: readonly ToolHooks[]) {
  const handlers = hooks.flatMap((hook) => (hook.afterToolCall ? [hook.afterToolCall] : []))
  return async (context: AfterToolCallContext, signal?: AbortSignal): Promise<AfterToolCallResult | undefined> => {
    let merged: AfterToolCallResult | undefined
    let current = context
    for (const handler of handlers) {
      const update = await handler(current, signal)
      if (!update) continue
      merged = { ...merged, ...update }
      current = { ...current, result: { ...current.result, ...update }, isError: update.isError ?? current.isError }
    }
    return merged
  }
}
