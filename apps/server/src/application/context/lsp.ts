// 代码智能的上下文贡献：lsp 工具（权限类 lsp，规则组名 Lsp；file_path 按读取判定，结果经登记明文替换）。只在 lsp.enabled 且该 Session 有服务器
// （全局、Workspace 或已启用插件）时注册；端口由 LspService 给出。
import { createLspTool } from '@coko/agent'
import type { ContextContribution, ContextContributionOptions, RuleTool } from './types.ts'

const LSP_RULE_TOOLS: readonly RuleTool[] = [{ name: 'lsp', permissionClass: 'lsp' }]

export function lspContribution(options: ContextContributionOptions): ContextContribution {
  const service = options.lsp
  if (!service) return { name: 'lsp', ruleTools: LSP_RULE_TOOLS }
  return {
    name: 'lsp',
    ruleTools: LSP_RULE_TOOLS,
    async tools(scope) {
      const port = await service.port(scope)
      return port ? [{ tool: createLspTool({ cwd: scope.cwd, port }), permissionClass: 'lsp' }] : []
    },
  }
}
