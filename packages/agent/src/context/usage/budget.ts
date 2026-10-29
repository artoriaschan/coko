// 上下文预算（M3 规格"预算与数值"）：有效窗口、自动压缩阈值与预警线。票 11 的压缩触发复用这里的数值。

/** 有效窗口为 contextWindow 减去 min(maxTokens, 20 000)（为回复留出的空间）。 */
export const OUTPUT_RESERVE_MAX = 20_000
/** 阈值与预警线之间的距离。 */
export const WARNING_MARGIN = 20_000

/** 阈值 = 有效窗口 − buffer；buffer 按 contextWindow：≥ 800k 为 50k，≥ 400k 为 30k，其余 13k。 */
export function compactionBuffer(contextWindow: number): number {
  if (contextWindow >= 800_000) return 50_000
  if (contextWindow >= 400_000) return 30_000
  return 13_000
}

export interface ContextBudget {
  contextWindow: number
  /** contextWindow − min(maxTokens, 20 000)。 */
  effectiveWindow: number
  /** 自动压缩阈值：有效窗口 − buffer。 */
  threshold: number
  /** 预警线：阈值 − 20 000。 */
  warning: number
}

/** 模型的预算；窗口过小时各值取 0 而不为负。 */
export function contextBudget(model: { contextWindow: number; maxTokens: number }): ContextBudget {
  const contextWindow = Math.max(0, model.contextWindow)
  const effectiveWindow = Math.max(0, contextWindow - Math.min(Math.max(0, model.maxTokens), OUTPUT_RESERVE_MAX))
  const threshold = Math.max(0, effectiveWindow - compactionBuffer(contextWindow))
  const warning = Math.max(0, threshold - WARNING_MARGIN)
  return { contextWindow, effectiveWindow, threshold, warning }
}
