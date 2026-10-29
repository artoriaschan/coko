// File Reference（票 06）：expandInput 排在命令之后，解析（展开后的）文本中的 @path，把 <file_reference> 文本块追加到同一条 user message。
// 当时生效的 Read 拒绝规则作用于引用（scope.permissionRules）。日志只记数量与状态，不记路径与内容。
import { expandFileReferences, type RunInput } from '@coko/agent'
import { getLogger } from '@coko/logging'
import type { ContextContribution, ContextContributionOptions, ContextScope, ExpandResult } from './types.ts'

const log = getLogger(['application', 'context', 'references'])

export function referencesContribution(_options: ContextContributionOptions): ContextContribution {
  return {
    name: 'references',
    async expandInput(input: RunInput, scope: ContextScope): Promise<ExpandResult | undefined> {
      const rules = (await scope.permissionRules?.()) ?? []
      const { blocks, references } = await expandFileReferences(input.text, { cwd: scope.cwd, rules })
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
