// File Reference：expandInput 排在命令之后，解析（展开后的）文本中的 @path，把 <file_reference> 文本块追加到同一条 user message。
// 当时生效的 Read 拒绝规则作用于引用（scope.permissionRules）。块中已登记的明文在生成时替换（与 read 工具的结果一致，ADR 0007），
// 用户输入的文本保持原样。日志只记数量与状态，不记路径与内容。
import { expandFileReferences, type RunInput } from '@coko/agent'
import { getLogger, redactSecretsDeep } from '@coko/logging'
import type { ContextContribution, ContextContributionOptions, ContextScope, ExpandResult } from './types.ts'

const log = getLogger(['application', 'context', 'references'])

export function referencesContribution(_options: ContextContributionOptions): ContextContribution {
  return {
    name: 'references',
    async expandInput(input: RunInput, scope: ContextScope): Promise<ExpandResult | undefined> {
      const rules = (await scope.permissionRules?.()) ?? []
      const expanded = await expandFileReferences(input.text, { cwd: scope.cwd, rules })
      const { references } = expanded
      const blocks = redactSecretsDeep(expanded.blocks)
      if (blocks.length === 0) return undefined
      const statuses: Record<string, number> = {}
      for (const r of references) statuses[r.status] = (statuses[r.status] ?? 0) + 1
      log.info('file references attached', {
        workspaceId: scope.workspaceId,
        ...(scope.sessionId ? { sessionId: scope.sessionId } : {}),
        count: references.length,
        statuses,
        truncated: references.filter((r) => r.truncated).length,
      })
      return { kind: 'input', input: { ...input, content: [...(input.content ?? [{ type: 'text', text: input.text }]), ...blocks] } }
    },
  }
}
