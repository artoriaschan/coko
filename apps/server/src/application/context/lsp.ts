// 代码智能的上下文贡献：lsp 工具（权限类 lsp，规则组名 Lsp；file_path 按读取判定）。当前没有服务器，只登记规则工具名。
import type { ContextContribution, ContextContributionOptions, RuleTool } from './types.ts'

const LSP_RULE_TOOLS: readonly RuleTool[] = [{ name: 'lsp', permissionClass: 'lsp' }]

export function lspContribution(_options: ContextContributionOptions): ContextContribution {
  return { name: 'lsp', ruleTools: LSP_RULE_TOOLS }
}
