// 上下文预算（docs/subsystems/context.md#上下文用量）：有效窗口、自动压缩阈值与预警线。压缩的触发复用这里的数值。

/** 有效窗口为 contextWindow 减去 min(maxTokens, 20 000)（为回复留出的空间）。 */
export const OUTPUT_RESERVE_MAX = 20_000
/** 阈值与预警线之间的距离。 */
export const WARNING_MARGIN = 20_000
/** 自动压缩阈值占上下文窗口的比例。 */
export const COMPACTION_THRESHOLD_RATIO = 0.8

export interface ContextBudget {
  contextWindow: number
  /** contextWindow − min(maxTokens, 20 000)。 */
  effectiveWindow: number
  /** 自动压缩阈值：上下文窗口的 80%。 */
  threshold: number
  /** 预警线：阈值 − 20 000。 */
  warning: number
}

/** 模型的预算；窗口过小时各值取 0 而不为负。 */
export function contextBudget(model: { contextWindow: number; maxTokens: number }): ContextBudget {
  const contextWindow = Math.max(0, model.contextWindow)
  const effectiveWindow = Math.max(0, contextWindow - Math.min(Math.max(0, model.maxTokens), OUTPUT_RESERVE_MAX))
  const threshold = Math.max(0, Math.floor(contextWindow * COMPACTION_THRESHOLD_RATIO))
  const warning = Math.max(0, threshold - WARNING_MARGIN)
  return { contextWindow, effectiveWindow, threshold, warning }
}
