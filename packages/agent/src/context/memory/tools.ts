// memory_list / memory_write / memory_delete。权限类由宿主注册时给出（工具自身不能声明）：memory_list 为 context-read，
// 写入与删除为 memory-write（规则组名 Memory）。存储经 MemoryPort 由宿主提供，可见范围为用户级与当前 Workspace。
import { Type } from 'typebox'
import type { PermissionClass } from '../../policy/decide.ts'
import { DEFAULT_MAX_BYTES, truncateHead } from '../../tools/truncate.ts'
import type { CokoTool } from '../../tools/types.ts'
import { formatMemoryEntry, MEMORY_MAX_CHARS, sortMemories, type MemoryEntry, type MemoryScope } from './section.ts'

/** 可预期的失败（条目不存在、作用域不符、正文为空）：作为工具错误回给模型。 */
export class MemoryToolError extends Error {
  override readonly name = 'MemoryToolError'
}

/**
 * 宿主提供的存储：只看得到用户级与当前 Workspace 的条目；update / delete 对不可见或不存在的 id 抛出 MemoryToolError。
 * 正文由宿主在保存前处理（例如脱敏），返回值是实际保存的条目。
 */
export interface MemoryPort {
  list(filter?: { scope?: MemoryScope }): Promise<MemoryEntry[]>
  create(input: { scope: MemoryScope; content: string }): Promise<MemoryEntry>
  update(id: string, content: string): Promise<MemoryEntry>
  /** 返回被删除的条目。 */
  delete(id: string): Promise<MemoryEntry>
}

export interface MemoryToolDetails {
  action: 'created' | 'updated' | 'deleted'
  memory: MemoryEntry
}

const scopeSchema = (description: string) => Type.Union([Type.Literal('user'), Type.Literal('workspace')], { description })

export const memoryListParameters = Type.Object({
  scope: Type.Optional(scopeSchema('Only list entries of this scope (default: both)')),
})

export const memoryWriteParameters = Type.Object({
  content: Type.String({ minLength: 1, maxLength: MEMORY_MAX_CHARS, description: `The fact to remember, at most ${MEMORY_MAX_CHARS} characters` }),
  scope: scopeSchema('user: applies in every workspace (preferences about the user); workspace: facts about this workspace'),
  id: Type.Optional(Type.String({ minLength: 1, description: 'Id of an existing entry to replace; omit to create a new entry' })),
})

export const memoryDeleteParameters = Type.Object({
  id: Type.String({ minLength: 1, description: 'Id of the entry to delete' }),
})

export interface MemoryTool {
  tool: CokoTool
  permissionClass: PermissionClass
}

const notFound = (id: string) => new MemoryToolError(`Memory entry ${id} not found`)

function createListTool(port: MemoryPort): CokoTool<typeof memoryListParameters, undefined> {
  return {
    name: 'memory_list',
    label: 'memory_list',
    description: 'List saved memories (user-level and this workspace) with their ids, newest first.',
    parameters: memoryListParameters,
    effect: 'read',
    async execute(_toolCallId, { scope }) {
      const entries = sortMemories(await port.list(scope ? { scope } : {}))
      if (entries.length === 0) return { content: [{ type: 'text', text: 'No memories saved.' }], details: undefined }
      const truncation = truncateHead(entries.map(formatMemoryEntry).join('\n'))
      const text = truncation.truncated ? `${truncation.content}\n\n[Output truncated at ${DEFAULT_MAX_BYTES / 1024}KB]` : truncation.content
      return { content: [{ type: 'text', text }], details: undefined }
    },
  }
}

function createWriteTool(port: MemoryPort): CokoTool<typeof memoryWriteParameters, MemoryToolDetails> {
  return {
    name: 'memory_write',
    label: 'memory_write',
    description:
      'Save a memory that persists across sessions, or replace an existing one by id. Use it for stable preferences of the user ' +
      '(scope "user") or durable facts about this workspace (scope "workspace"); not for task progress. ' +
      `Content is at most ${MEMORY_MAX_CHARS} characters.`,
    parameters: memoryWriteParameters,
    effect: 'side-effect',
    permissionSubject: (args) => args.content,
    async execute(_toolCallId, { content, scope, id }) {
      const text = content.trim()
      if (text === '') throw new MemoryToolError('Memory content is empty')
      if (id === undefined) {
        const memory = await port.create({ scope, content: text })
        return { content: [{ type: 'text', text: `Remembered (id: ${memory.id}, scope: ${memory.scope}).` }], details: { action: 'created', memory } }
      }
      const existing = (await port.list()).find((e) => e.id === id)
      if (!existing) throw notFound(id)
      if (existing.scope !== scope)
        throw new MemoryToolError(`Memory entry ${id} scope is ${existing.scope}, not ${scope}; delete it and write a new entry to change its scope`)
      const memory = await port.update(id, text)
      return { content: [{ type: 'text', text: `Updated memory ${memory.id}.` }], details: { action: 'updated', memory } }
    },
  }
}

function createDeleteTool(port: MemoryPort): CokoTool<typeof memoryDeleteParameters, MemoryToolDetails> {
  return {
    name: 'memory_delete',
    label: 'memory_delete',
    description: 'Delete a saved memory by id (see the ids in <memory> or memory_list).',
    parameters: memoryDeleteParameters,
    effect: 'side-effect',
    permissionSubject: (args) => args.id,
    async execute(_toolCallId, { id }) {
      const memory = await port.delete(id)
      return { content: [{ type: 'text', text: `Deleted memory ${memory.id}.` }], details: { action: 'deleted', memory } }
    },
  }
}

/** 三个工具及其权限类，按 list、write、delete 的顺序。 */
export function createMemoryTools(port: MemoryPort): MemoryTool[] {
  return [
    { tool: createListTool(port) as CokoTool, permissionClass: 'context-read' },
    { tool: createWriteTool(port) as CokoTool, permissionClass: 'memory-write' },
    { tool: createDeleteTool(port) as CokoTool, permissionClass: 'memory-write' },
  ]
}
