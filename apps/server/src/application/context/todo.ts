// Todo List 的上下文贡献（docs/subsystems/todo.md）：todo_write 工具（权限类 session-state）与有未完成项时的 <todo_list> system section。
// 当前表是该 Session 最新的 todo_list 条目；条目经 SessionEntryAccess 提交（入库前替换登记明文），结果文本取自入库后的表。
import { createTodoTool, todoListSection, type TodoItem, type TodoListPayload } from '@coko/agent'
import type { ContextContribution, ContextContributionOptions, RuleTool, SessionEntryAccess } from './types.ts'

const TODO_RULE_TOOLS: readonly RuleTool[] = [{ name: 'todo_write', permissionClass: 'session-state' }]

/** 该 Session 最新的 todo_list 条目的表；没有时为空表。 */
export async function currentTodoItems(entries: SessionEntryAccess, sessionId: string): Promise<TodoItem[]> {
  const all = await entries.list(sessionId)
  for (let i = all.length - 1; i >= 0; i--) if (all[i]!.kind === 'todo_list') return (all[i]!.payload as TodoListPayload).items
  return []
}

export function todoContribution(options: ContextContributionOptions): ContextContribution {
  const entries = options.entries
  if (!entries) return { name: 'todo', ruleTools: TODO_RULE_TOOLS }
  return {
    name: 'todo',
    ruleTools: TODO_RULE_TOOLS,
    async systemSections(scope) {
      if (scope.sessionId === undefined) return []
      const section = todoListSection(await currentTodoItems(entries, scope.sessionId))
      return section ? [section] : []
    },
    async tools(scope) {
      const sessionId = scope.sessionId
      if (sessionId === undefined) return []
      const tool = createTodoTool({
        async write(items) {
          const committed = await entries.commit(sessionId, { kind: 'todo_list', payload: { items } })
          return (committed.payload as TodoListPayload).items
        },
      })
      return [{ tool, permissionClass: 'session-state' }]
    },
  }
}
