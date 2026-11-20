// File Reference 与 Session Reference：expandInput 排在命令之后，解析（展开后的）文本中的 @path 与 @session:<id>，按出现顺序把
// <file_reference> / <session_reference> 文本块追加到同一条 user message。当时生效的 Read 拒绝规则作用于文件引用（scope.permissionRules）；
// 会话引用的范围在这里判定（同一 Project 的另一个根 Session），不依赖界面的过滤。块中已登记的明文在生成时替换（与 read 工具的结果一致，
// ADR 0007），用户输入的文本保持原样。日志只记数量与状态，不记路径、会话 id、标题与内容。
import { expandFileReferences, type RunInput, type SessionReferenceResolution } from '@coko/agent'
import { getLogger, redactSecretsDeep } from '@coko/logging'
import type { ContextContribution, ContextContributionOptions, ContextScope, ExpandResult } from './types.ts'

const log = getLogger(['application', 'context', 'references'])

const tally = (references: readonly { status: string; truncated: boolean }[]) => {
  const statuses: Record<string, number> = {}
  for (const r of references) statuses[r.status] = (statuses[r.status] ?? 0) + 1
  return { count: references.length, statuses, truncated: references.filter((r) => r.truncated).length }
}

/**
 * 范围（docs/subsystems/context.md#session-reference）：与当前会话同一 Project 的根 Session（含 Worktree Session 与已归档的）；当前会话不属于
 * 任何 Project 时为其他同样不属于任何 Project 的根 Session。范围外只给标题；不存在（或已删除）时 undefined。只读已提交的条目。
 */
async function resolveSession(
  sessions: NonNullable<ContextContributionOptions['sessions']>,
  scope: ContextScope,
  id: string,
): Promise<SessionReferenceResolution | undefined> {
  const session = await sessions.getSession(id)
  if (!session) return undefined
  const { title } = session
  if (session.id === scope.sessionId || session.parentSessionId !== null) return { status: 'not-referable', title }
  if ((session.projectId ?? undefined) !== scope.projectId) return { status: 'out-of-project', title }
  return { status: 'attached', title, entries: await sessions.listEntries(id) }
}

export function referencesContribution(options: ContextContributionOptions): ContextContribution {
  const { sessions } = options
  return {
    name: 'references',
    async expandInput(input: RunInput, scope: ContextScope): Promise<ExpandResult | undefined> {
      const rules = (await scope.permissionRules?.()) ?? []
      const expanded = await expandFileReferences(input.text, {
        cwd: scope.cwd,
        rules,
        ...(sessions ? { resolveSession: (id: string) => resolveSession(sessions, scope, id) } : {}),
      })
      const blocks = redactSecretsDeep(expanded.blocks)
      if (blocks.length === 0) return undefined
      log.info('file references attached', {
        workspaceId: scope.workspaceId,
        ...(scope.sessionId ? { sessionId: scope.sessionId } : {}),
        ...tally(expanded.references),
        sessions: tally(expanded.sessionReferences),
      })
      return { kind: 'input', input: { ...input, content: [...(input.content ?? [{ type: 'text', text: input.text }]), ...blocks] } }
    },
  }
}
