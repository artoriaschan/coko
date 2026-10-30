// Todo List（docs/subsystems/todo.md）：todo_write 整表替换的校验与 id 生成、结果文本与 <todo_list> system section。
// 存储经 TodoPort 由宿主提供（apps/server context/todo.ts 提交 todo_list 条目）；权限类 session-state 由宿主注册时给出。
import { Type, type Static } from 'typebox'
import type { SystemSection } from '../../engine/types.ts'
import type { TodoItem, TodoStatus } from '../../session-entries/index.ts'
import type { CokoTool } from '../../tools/types.ts'

export const TODO_MAX_ITEMS = 50
export const TODO_CONTENT_MAX = 500
export const TODO_RESULT_MAX = 1000
export const TODO_SECTION_NAME = 'todo_list'

/** 不合规则的调用：作为工具错误回给模型，原表不变。 */
export class TodoValidationError extends Error {
  override readonly name = 'TodoValidationError'
}

const statusSchema = Type.Union([Type.Literal('pending'), Type.Literal('in_progress'), Type.Literal('completed'), Type.Literal('cancelled')])

export const todoWriteParameters = Type.Object({
  items: Type.Array(
    Type.Object({
      id: Type.Optional(Type.String({ minLength: 1, description: 'Stable id; omit to use the position (t1, t2, …)' })),
      content: Type.String({ description: 'What to do, at most ' + TODO_CONTENT_MAX + ' characters, unique in the list' }),
      status: statusSchema,
      blockedBy: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { description: 'Ids of items that must be completed or cancelled first' })),
      result: Type.Optional(Type.String({ description: 'Outcome, only on completed or cancelled items, at most ' + TODO_RESULT_MAX + ' characters' })),
    }),
    { description: 'The complete list (replaces the previous one), at most ' + TODO_MAX_ITEMS + ' items' },
  ),
})

export type TodoInputItem = Static<typeof todoWriteParameters>['items'][number]

const finished = (status: TodoStatus) => status === 'completed' || status === 'cancelled'

/**
 * 校验并规范化整张表：id 省略时按位置生成 t1…；content 与 result 去掉首尾空白，空的 result 与 blockedBy 省略。违反任一规则时抛出
 * TodoValidationError：content 1–500 字符且不重复、至多 50 项、id 不重复、至多一个 in_progress、blockedBy 只引用表内 id 且无环、
 * 前置项未完成（completed / cancelled 之外）时不能为 in_progress 或 completed、result ≤ 1000 字符且只在 completed / cancelled 项上。
 */
export function normalizeTodoItems(input: readonly TodoInputItem[]): TodoItem[] {
  if (input.length > TODO_MAX_ITEMS) throw new TodoValidationError('A todo list has at most ' + TODO_MAX_ITEMS + ' items (got ' + input.length + ')')
  const items = input.map((raw, index): TodoItem => {
    const id = raw.id ?? 't' + (index + 1)
    const content = raw.content.trim()
    if (content === '') throw new TodoValidationError('Item ' + id + ': content is empty')
    if (content.length > TODO_CONTENT_MAX) throw new TodoValidationError('Item ' + id + ': content exceeds ' + TODO_CONTENT_MAX + ' characters')
    const result = raw.result?.trim()
    if (result !== undefined && result !== '') {
      if (!finished(raw.status)) throw new TodoValidationError('Item ' + id + ': result is only allowed on completed or cancelled items')
      if (result.length > TODO_RESULT_MAX) throw new TodoValidationError('Item ' + id + ': result exceeds ' + TODO_RESULT_MAX + ' characters')
    }
    const blockedBy = [...new Set(raw.blockedBy ?? [])]
    return {
      id,
      content,
      status: raw.status,
      ...(blockedBy.length > 0 ? { blockedBy } : {}),
      ...(result !== undefined && result !== '' ? { result } : {}),
    }
  })

  const byId = new Map<string, TodoItem>()
  const contents = new Set<string>()
  for (const item of items) {
    if (byId.has(item.id)) throw new TodoValidationError('Duplicate id ' + item.id)
    if (contents.has(item.content)) throw new TodoValidationError('Duplicate content: ' + JSON.stringify(item.content))
    byId.set(item.id, item)
    contents.add(item.content)
  }
  const active = items.filter((i) => i.status === 'in_progress')
  if (active.length > 1) throw new TodoValidationError('At most one item can be in_progress (got ' + active.map((i) => i.id).join(', ') + ')')
  for (const item of items)
    for (const ref of item.blockedBy ?? []) if (!byId.has(ref)) throw new TodoValidationError('Item ' + item.id + ': blockedBy references unknown id ' + ref)

  // 环：沿 blockedBy 深度优先，回到正在访问的项即成环（含引用自己）。
  const state = new Map<string, 'visiting' | 'done'>()
  const visit = (id: string, path: string[]) => {
    if (state.get(id) === 'done') return
    if (state.get(id) === 'visiting') throw new TodoValidationError('blockedBy forms a cycle: ' + [...path.slice(path.indexOf(id)), id].join(' -> '))
    state.set(id, 'visiting')
    for (const ref of byId.get(id)!.blockedBy ?? []) visit(ref, [...path, id])
    state.set(id, 'done')
  }
  for (const item of items) visit(item.id, [])

  for (const item of items) {
    if (item.status !== 'in_progress' && item.status !== 'completed') continue
    const open = (item.blockedBy ?? []).find((ref) => !finished(byId.get(ref)!.status))
    if (open) throw new TodoValidationError('Item ' + item.id + ' cannot be ' + item.status + ': prerequisite ' + open + ' is not finished')
  }
  return items
}

/** 表中每项一行（结果另起一行缩进）；空表为 (empty)。 */
export function formatTodoItems(items: readonly TodoItem[]): string {
  if (items.length === 0) return '(empty)'
  return items
    .map((item) => {
      const blocked = item.blockedBy?.length ? ' (blocked by ' + item.blockedBy.join(', ') + ')' : ''
      const line = '- [' + item.status + '] ' + item.id + ': ' + item.content + blocked
      return item.result === undefined ? line : line + '\n  result: ' + item.result
    })
    .join('\n')
}

/** todo_write 的结果：各状态计数加当前表。 */
export function todoResultText(items: readonly TodoItem[]): string {
  const count = (status: TodoStatus) => items.filter((i) => i.status === status).length
  const summary =
    'Updated todo list: ' +
    count('pending') +
    ' pending, ' +
    count('in_progress') +
    ' in progress, ' +
    count('completed') +
    ' completed, ' +
    count('cancelled') +
    ' cancelled.'
  return summary + '\n\n' + formatTodoItems(items)
}

/** 有未完成项（pending / in_progress）时的 <todo_list> system section；全部完成、取消或为空时 undefined。 */
export function todoListSection(items: readonly TodoItem[]): SystemSection | undefined {
  if (!items.some((i) => !finished(i.status))) return undefined
  const text = [
    '<todo_list>',
    'Your current todo list. Keep it up to date with todo_write (it replaces the whole list): mark an item in_progress before you start it ' +
      '(at most one at a time) and completed as soon as it is done, with a short result.',
    formatTodoItems(items),
    '</todo_list>',
  ].join('\n')
  return { name: TODO_SECTION_NAME, text }
}

/** 宿主的存储：保存整张表（例如提交 todo_list 条目）并返回实际保存的表（保存前可能替换了内容，例如脱敏）。 */
export interface TodoPort {
  write(items: TodoItem[]): Promise<TodoItem[]>
}

export function createTodoTool(port: TodoPort): CokoTool<typeof todoWriteParameters, undefined> {
  return {
    name: 'todo_write',
    label: 'todo_write',
    description:
      'Create or update your todo list for this session. Use it for multi-step work (3 or more steps) so the user can see your plan and ' +
      'progress. Each call replaces the whole list. Statuses: pending, in_progress (at most one), completed, cancelled. blockedBy lists ids ' +
      'that must be completed or cancelled first; add a short result when an item is completed or cancelled.',
    parameters: todoWriteParameters,
    effect: 'side-effect',
    async execute(_toolCallId, { items }) {
      const saved = await port.write(normalizeTodoItems(items))
      return { content: [{ type: 'text', text: todoResultText(saved) }], details: undefined }
    },
  }
}
