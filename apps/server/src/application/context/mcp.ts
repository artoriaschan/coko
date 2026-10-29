// MCP 工具、资源与提示模板：票 07、08 实现；票 01 为空贡献。
import type { ContextContribution, ContextContributionOptions } from './types.ts'

export function mcpContribution(_options: ContextContributionOptions): ContextContribution {
  return { name: 'mcp' }
}
