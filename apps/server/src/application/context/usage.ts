// 上下文用量与时间裁剪：transformMessages 在 context.trimOldToolResults 开启时裁剪较旧的大段 toolResult（只改请求）；
// contextUsage 汇总各贡献的 report() 与对话，供 GET /api/sessions/:id/context 与 /api/workspaces/:id/context。
import {
  charsToTokens,
  contextBudget,
  estimateCompactedTokens,
  DEFAULT_SYSTEM_PROMPT,
  effectiveMessages,
  estimateContextTokens,
  estimateMessageChars,
  OLD_TOOL_RESULT_CLEARED,
  trimOldToolResults,
  type ToolRegistry,
} from '@coko/agent'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type { Model } from '@earendil-works/pi-ai'
import { getLogger } from '@coko/logging'
import type { ContextBreakdown, ContextUsageResponse } from '@coko/protocol'
import type { SessionEntry as StoredEntry } from '@coko/session'
import type { ContextAssembly } from './index.ts'
import type { ContextContribution, ContextContributionOptions, ContextScope } from './types.ts'

const log = getLogger(['application', 'context', 'usage'])

export interface UsageContributionOptions extends ContextContributionOptions {
  /** 时钟（测试注入）；缺省 Date.now。 */
  now?: () => number
}

const clearedCount = (messages: readonly AgentMessage[]) =>
  messages.filter((m) => {
    if (m.role !== 'toolResult') return false
    const content = (m as { content: { type: string; text?: string }[] }).content
    return content.length === 1 && content[0]!.text === OLD_TOOL_RESULT_CLEARED
  }).length

export function usageContribution(options: UsageContributionOptions): ContextContribution {
  const now = options.now ?? Date.now
  return {
    name: 'usage',
    transformMessages(messages, scope) {
      if (!scope.config.context.trimOldToolResults) return messages
      const trimmed = trimOldToolResults(messages, { now: now() })
      if (trimmed !== messages)
        log.debug('old tool results trimmed', {
          workspaceId: scope.workspaceId,
          ...(scope.sessionId ? { sessionId: scope.sessionId } : {}),
          cleared: clearedCount(trimmed) - clearedCount(messages),
        })
      return trimmed
    },
  }
}

export interface ContextUsageInput {
  context: Pick<ContextAssembly, 'report' | 'tools'>
  scope: ContextScope
  /** 基础工具集（与运行时相同的工厂）。 */
  baseTools: ToolRegistry
  /** Session 的模型或缺省模型；没有时窗口、阈值与预警为 0。 */
  model: Model<any> | undefined
  /** Session 的条目；草稿为空。 */
  entries: readonly StoredEntry[]
  now?: () => number
  /** 自动压缩因连续失败暂停（压缩的熔断，SessionService.compactionPaused）；缺省 false。 */
  autoCompactPaused?: boolean
}

const toolChars = (tool: { name: string; description: string; parameters: unknown }) =>
  JSON.stringify({ name: tool.name, description: tool.description, parameters: tool.parameters }).length

const lastAssistantTimestamp = (messages: readonly AgentMessage[]) => {
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i]!.role === 'assistant') return (messages[i] as { timestamp: number }).timestamp
  return undefined
}

/**
 * 上下文用量（docs/subsystems/context.md#上下文用量）：分项一律 chars/4；tokens 为最后一次 assistant usage 加其后消息的 chars/4，没有 usage
 * （或时间裁剪将改变下一次请求、usage 已不代表它）时为分项之和。
 */
export async function contextUsage(input: ContextUsageInput): Promise<ContextUsageResponse> {
  const { scope, model } = input
  const now = (input.now ?? Date.now)()
  const [reports, contributed] = await Promise.all([input.context.report(scope), input.context.tools(scope)])

  const chars = { instructions: 0, skills: 0, memory: 0 }
  const instructions: ContextUsageResponse['instructions'] = []
  const diagnostics: ContextUsageResponse['diagnostics'] = []
  for (const report of reports) {
    for (const key of Object.keys(chars) as (keyof typeof chars)[]) chars[key] += report.breakdown?.[key] ?? 0
    instructions.push(...(report.instructions ?? []))
    diagnostics.push(...(report.diagnostics ?? []))
  }

  // 与运行时相同：同名的贡献工具被忽略。
  const seen = new Set<string>()
  let tools = 0
  for (const tool of [...input.baseTools.list(), ...contributed.map((c) => c.tool)]) {
    if (seen.has(tool.name)) continue
    seen.add(tool.name)
    tools += toolChars(tool)
  }

  const raw = effectiveMessages(input.entries)
  const trim = scope.config.context.trimOldToolResults
  const messages = trim ? trimOldToolResults(raw, { now }) : raw
  const breakdown: ContextBreakdown = {
    system: charsToTokens(DEFAULT_SYSTEM_PROMPT.length),
    instructions: charsToTokens(chars.instructions),
    skills: charsToTokens(chars.skills),
    memory: charsToTokens(chars.memory),
    tools: charsToTokens(tools),
    messages: messages.reduce((sum, message) => sum + charsToTokens(estimateMessageChars(message)), 0),
  }
  const sum = Object.values(breakdown).reduce((a, b) => a + b, 0)

  // 最后一次 usage 之后才出现的裁剪点会改变下一次请求：此时 usage 不再代表它，按分项估算。
  const last = lastAssistantTimestamp(raw)
  const stale = trim && last !== undefined && clearedCount(messages) !== clearedCount(trimOldToolResults(raw, { now: last }))
  const estimate = estimateContextTokens(messages)
  // 压缩之后、下一条 assistant 之前：最后一次 usage 量的是被摘要替代的历史。
  const compactedAfterUsage = estimate.usageTokens > 0 && estimateCompactedTokens(input.entries).usageTokens === 0
  const fromUsage = estimate.usageTokens > 0 && !stale && !compactedAfterUsage
  const budget = model ? contextBudget({ contextWindow: model.contextWindow ?? 0, maxTokens: model.maxTokens ?? 0 }) : undefined

  return {
    contextWindow: budget?.contextWindow ?? 0,
    threshold: budget?.threshold ?? 0,
    warning: budget?.warning ?? 0,
    tokens: fromUsage ? estimate.tokens : sum,
    estimated: fromUsage ? estimate.estimated : true,
    breakdown,
    instructions,
    diagnostics,
    autoCompact: { enabled: scope.config.context.autoCompact, paused: input.autoCompactPaused ?? false },
  }
}
