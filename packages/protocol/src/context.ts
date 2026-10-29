// 上下文用量（GET /api/sessions/:id/context、/api/workspaces/:id/context，票 10）。
// 票 01 建立本文件并在 index.ts 一次性 re-export；之后只改本文件。
import { Type, type Static } from 'typebox'
import { ResourceDiagnostic } from './config.ts'
import { LoadedInstructionFile } from './instructions.ts'

const strict = { additionalProperties: false } as const
const Tokens = Type.Integer({ minimum: 0 })

/** 分项（一律 chars/4 的 token 数）：基础系统提示、指令、Skills 索引、Memory、工具定义、对话消息。 */
export const ContextBreakdown = Type.Object({ system: Tokens, instructions: Tokens, skills: Tokens, memory: Tokens, tools: Tokens, messages: Tokens }, strict)
export type ContextBreakdown = Static<typeof ContextBreakdown>

/**
 * 上下文用量。tokens = 最后一次 assistant usage + 其后消息的 chars/4（没有 usage 时为分项之和），estimated 表示含估算部分。
 * threshold 为自动压缩阈值、warning 为预警线（有效窗口 = contextWindow − min(maxTokens, 20 000)）；没有可用模型时三者为 0。
 */
export const ContextUsageResponse = Type.Object(
  {
    contextWindow: Tokens,
    threshold: Tokens,
    warning: Tokens,
    tokens: Tokens,
    estimated: Type.Boolean(),
    breakdown: ContextBreakdown,
    instructions: Type.Array(LoadedInstructionFile),
    diagnostics: Type.Array(ResourceDiagnostic),
    /** 自动压缩：enabled 为有效配置 context.autoCompact；paused 为连续失败熔断后暂停（票 11）。 */
    autoCompact: Type.Object({ enabled: Type.Boolean(), paused: Type.Boolean() }, strict),
  },
  strict,
)
export type ContextUsageResponse = Static<typeof ContextUsageResponse>

export type ContextUsageLevel = 'normal' | 'warning' | 'critical'

/** 用量档位：达到阈值为 critical，达到预警线为 warning；没有窗口时 normal。 */
export function contextUsageLevel(usage: Pick<ContextUsageResponse, 'contextWindow' | 'threshold' | 'warning' | 'tokens'>): ContextUsageLevel {
  if (usage.contextWindow <= 0) return 'normal'
  if (usage.tokens >= usage.threshold) return 'critical'
  if (usage.tokens >= usage.warning) return 'warning'
  return 'normal'
}

/** 占 contextWindow 的百分比（0–100 的整数，向下取整，超出时为 100）；没有窗口时 undefined。 */
export function contextUsagePercent(usage: Pick<ContextUsageResponse, 'contextWindow' | 'tokens'>): number | undefined {
  if (usage.contextWindow <= 0) return undefined
  return Math.min(100, Math.floor((usage.tokens / usage.contextWindow) * 100))
}

export const contextPaths = {
  /** GET：该 Session 的用量；不存在时 404。 */
  session: (sessionId: string) => `/api/sessions/${encodeURIComponent(sessionId)}/context`,
  /** GET：还没有 Session 的 Workspace 草稿（没有消息，按缺省模型）；不存在时 404。 */
  workspace: (workspaceId: string) => `/api/workspaces/${encodeURIComponent(workspaceId)}/context`,
} as const
