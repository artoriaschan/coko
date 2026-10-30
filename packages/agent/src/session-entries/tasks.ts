// Todo List 的条目 payload：todo_write 整表替换（与 @coko/protocol 的 todo.ts 一致）。
import { Type, type Static } from 'typebox'
import { definePayloads } from './define.ts'

const strict = { additionalProperties: false } as const
const Id = Type.String({ minLength: 1 })

export const todoStatusSchema = Type.Union([Type.Literal('pending'), Type.Literal('in_progress'), Type.Literal('completed'), Type.Literal('cancelled')])
export type TodoStatus = Static<typeof todoStatusSchema>

export const todoItemSchema = Type.Object(
  { id: Id, content: Type.String({ minLength: 1 }), status: todoStatusSchema, blockedBy: Type.Optional(Type.Array(Id)), result: Type.Optional(Type.String()) },
  strict,
)
export type TodoItem = Static<typeof todoItemSchema>

export const todoListPayloadSchema = Type.Object({ items: Type.Array(todoItemSchema) }, strict)
export type TodoListPayload = Static<typeof todoListPayloadSchema>

export interface TaskEntryPayloads {
  todo_list: TodoListPayload
}

export const taskEntryPayloads = definePayloads({
  todo_list: [{ schema: todoListPayloadSchema }],
} satisfies Record<keyof TaskEntryPayloads, unknown>)
