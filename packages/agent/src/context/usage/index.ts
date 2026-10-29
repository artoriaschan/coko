// 上下文用量（票 10）：预算与阈值、Token 估算、时间裁剪。压缩（票 11）复用预算与估算。
export { compactionBuffer, contextBudget, OUTPUT_RESERVE_MAX, WARNING_MARGIN, type ContextBudget } from './budget.ts'
export { charsToTokens, estimateContextTokens, estimateMessageChars, usageTokens, type ContextTokenEstimate } from './estimate.ts'
export { OLD_TOOL_RESULT_CLEARED, TRIM_GAP_MS, TRIM_KEEP_RECENT, TRIM_MIN_BYTES, trimOldToolResults } from './trim.ts'
