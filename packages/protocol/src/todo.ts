import { Type, type Static } from 'typebox'

// Todo List 的条目 payload：todo_write 整表替换，每次提交一条完整列表。entries.ts 据 todoEntryPayloadSchemas 组成 SessionEntry。

const strict = { additionalProperties: false } as const
const Id = Type.String({ minLength: 1 })

export const TodoStatus = Type.Union([Type.Literal('pending'), Type.Literal('in_progress'), Type.Literal('completed'), Type.Literal('cancelled')])
export type TodoStatus = Static<typeof TodoStatus>

export const TodoItem = Type.Object(
  { id: Id, content: Type.String({ minLength: 1 }), status: TodoStatus, blockedBy: Type.Optional(Type.Array(Id)), result: Type.Optional(Type.String()) },
  strict,
)
export type TodoItem = Static<typeof TodoItem>

/** todo_list v1：当前的完整列表。 */
export const TodoListPayload = Type.Object({ items: Type.Array(TodoItem) }, strict)
export type TodoListPayload = Static<typeof TodoListPayload>

/** 本领域的 kind → payload schema。 */
export const todoEntryPayloadSchemas = {
  todo_list: TodoListPayload,
}
