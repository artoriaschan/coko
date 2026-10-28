import type { CokoTool } from './types.ts'

export const DEFAULT_TOOL_TIMEOUT_MS = 10 * 60 * 1000
/** How long a tool may take to settle after its signal fired before the call is abandoned. */
export const DEFAULT_ABORT_GRACE_MS = 5_000

export interface TimeoutOptions {
  defaultTimeoutMs?: number
  graceMs?: number
}

/**
 * Wrap a tool with the unified timeout and cancellation policy.
 *
 * The tool receives a signal that fires on run cancellation or timeout. A well-behaved tool settles
 * after cleaning up (for bash: after the process group exited). A tool that ignores the signal is
 * abandoned after `graceMs` so the run can still end.
 */
export function withTimeout(tool: CokoTool, options: TimeoutOptions = {}): CokoTool {
  const timeoutMs = tool.timeoutMs ?? options.defaultTimeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS
  const graceMs = options.graceMs ?? DEFAULT_ABORT_GRACE_MS

  return {
    ...tool,
    async execute(toolCallId, params, parentSignal, onUpdate) {
      const controller = new AbortController()
      let timedOut = false
      let graceTimer: NodeJS.Timeout | undefined
      let rejectAbandoned: (error: Error) => void = () => {}
      const abandoned = new Promise<never>((_, reject) => {
        rejectAbandoned = reject
      })
      // Keep the never-settling race arm from surfacing as an unhandled rejection.
      abandoned.catch(() => {})

      const abort = (reason: Error) => {
        if (controller.signal.aborted) return
        controller.abort(reason)
        graceTimer = setTimeout(() => rejectAbandoned(reason), graceMs)
      }
      const onParentAbort = () => abort(new Error('Operation aborted'))
      if (parentSignal?.aborted) onParentAbort()
      else parentSignal?.addEventListener('abort', onParentAbort, { once: true })

      const timer =
        timeoutMs > 0
          ? setTimeout(() => {
              timedOut = true
              abort(new Error(`Tool ${tool.name} timed out after ${timeoutMs}ms`))
            }, timeoutMs)
          : undefined

      try {
        return await Promise.race([tool.execute(toolCallId, params, controller.signal, onUpdate), abandoned])
      } catch (error) {
        if (timedOut) throw new Error(`Tool ${tool.name} timed out after ${timeoutMs}ms`, { cause: error })
        throw error
      } finally {
        if (timer) clearTimeout(timer)
        if (graceTimer) clearTimeout(graceTimer)
        parentSignal?.removeEventListener('abort', onParentAbort)
      }
    },
  }
}
