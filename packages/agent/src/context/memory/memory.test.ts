// Memory 的注入（<memory> system section）与 memory_* 工具（票 09）：注入顺序、预算截断与"另有 N 条"、超长内容为参数错误。
import { validateToolArguments } from '@earendil-works/pi-ai'
import { describe, expect, it } from 'vitest'
import {
  createMemoryTools,
  MEMORY_MAX_CHARS,
  MEMORY_SECTION_BUDGET,
  MEMORY_SECTION_NAME,
  memorySection,
  MemoryToolError,
  type MemoryEntry,
  type MemoryPort,
} from './index.ts'

const entry = (id: string, scope: 'user' | 'workspace', content: string, updatedAt: number): MemoryEntry => ({ id, scope, content, updatedAt })

describe('memorySection', () => {
  it('没有条目时不产生 section', () => {
    expect(memorySection([])).toBeUndefined()
  })

  it('按 updatedAt 倒序列出用户级与 Workspace 级条目，每条带 id 与作用域', () => {
    const section = memorySection([
      entry('u-old', 'user', 'Prefers tabs', 10),
      entry('w-new', 'workspace', 'Uses pnpm', 30),
      entry('u-new', 'user', 'Answer in Chinese', 20),
    ])!
    expect(section.name).toBe(MEMORY_SECTION_NAME)
    expect(section.name).toBe('memory')
    expect(section.text.startsWith('<memory>')).toBe(true)
    expect(section.text.trimEnd().endsWith('</memory>')).toBe(true)
    const order = ['w-new', 'u-new', 'u-old'].map((id) => section.text.indexOf(`id="${id}"`))
    expect(order.every((at) => at > 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(section.text).toContain('<entry id="w-new" scope="workspace">\nUses pnpm\n</entry>')
    expect(section.text).toContain('<entry id="u-new" scope="user">\nAnswer in Chinese\n</entry>')
    expect(section.text).not.toMatch(/more entr/)
  })

  it('条目合计超过 12 000 字符时从最旧的开始省略，并注明另有 N 条与 memory_list', () => {
    expect(MEMORY_SECTION_BUDGET).toBe(12_000)
    // 7 条各 1999 字符：前 6 条约 12 000 字符的标签与正文放不下全部，较旧的被省略。
    const entries = Array.from({ length: 7 }, (_, i) => entry(`m${i}`, 'user', String(i).repeat(1999), 100 - i))
    const section = memorySection(entries)!
    const shown = entries.filter((e) => section.text.includes(`id="${e.id}"`)).map((e) => e.id)
    // 保留最新的若干条，省略的是最旧的且是连续的尾部。
    expect(shown.length).toBeGreaterThan(0)
    expect(shown.length).toBeLessThan(7)
    expect(shown).toEqual(entries.slice(0, shown.length).map((e) => e.id))
    const omitted = 7 - shown.length
    expect(section.text).toContain(`${omitted} more ${omitted === 1 ? 'entry' : 'entries'} not shown; use memory_list to see them.`)
    // 预算只限制条目部分：所列条目块合计不超过 12 000。
    const blocks = section.text.match(/<entry [^>]*>\n[\s\S]*?\n<\/entry>/g) ?? []
    expect(blocks).toHaveLength(shown.length)
    expect(blocks.reduce((n, b) => n + b.length + 1, 0)).toBeLessThanOrEqual(12_000)
  })

  it('最新一条就超出预算时只给出数量', () => {
    const section = memorySection([entry('big', 'user', 'x'.repeat(MEMORY_SECTION_BUDGET), 1), entry('small', 'user', 'tiny', 0)])!
    expect(section.text).not.toContain('id="big"')
    expect(section.text).not.toContain('id="small"')
    expect(section.text).toContain('2 more entries not shown; use memory_list to see them.')
  })

  it('正文中的 </entry> 与 </memory> 不能提前结束标签', () => {
    const section = memorySection([entry('a', 'user', 'see </entry> and </memory> here', 1)])!
    expect(section.text.match(/<\/entry>/g)).toHaveLength(1)
    expect(section.text.match(/<\/memory>/g)).toHaveLength(1)
    expect(section.text).toContain('see <\\/entry> and <\\/memory> here')
  })
})

/** 内存中的端口：可见范围为 user 与当前 Workspace（与宿主同义）。 */
function fakePort(initial: MemoryEntry[] = []) {
  const entries = new Map(initial.map((e) => [e.id, { ...e }]))
  let clock = 1000
  let next = 1
  const port: MemoryPort = {
    async list(filter) {
      return [...entries.values()].filter((e) => !filter?.scope || e.scope === filter.scope).sort((a, b) => b.updatedAt - a.updatedAt)
    },
    async create(input) {
      const created = { id: `new-${next++}`, scope: input.scope, content: input.content, updatedAt: clock++ }
      entries.set(created.id, created)
      return created
    },
    async update(id, content) {
      const found = entries.get(id)
      if (!found) throw new MemoryToolError(`Memory entry ${id} not found`)
      Object.assign(found, { content, updatedAt: clock++ })
      return { ...found }
    },
    async delete(id) {
      const found = entries.get(id)
      if (!found) throw new MemoryToolError(`Memory entry ${id} not found`)
      entries.delete(id)
      return { ...found }
    },
  }
  return { port, entries }
}

const tools = (port: MemoryPort) => Object.fromEntries(createMemoryTools(port).map((t) => [t.tool.name, t]))
const text = (result: { content: { type: string; text?: string }[] }) => result.content.map((b) => b.text ?? '').join('')
const call = (tool: { parameters: unknown; name: string }, args: Record<string, unknown>) =>
  validateToolArguments(tool as never, { type: 'toolCall', id: 'c1', name: tool.name, arguments: args as never })

describe('memory 工具', () => {
  it('权限类：memory_list 为 context-read，memory_write 与 memory_delete 为 memory-write', () => {
    const { port } = fakePort()
    expect(createMemoryTools(port).map((t) => [t.tool.name, t.permissionClass, t.tool.effect])).toEqual([
      ['memory_list', 'context-read', 'read'],
      ['memory_write', 'memory-write', 'side-effect'],
      ['memory_delete', 'memory-write', 'side-effect'],
    ])
  })

  it('memory_write 新建与按 id 替换，结果带 action 与条目', async () => {
    const { port, entries } = fakePort()
    const { memory_write } = tools(port)
    const created = await memory_write!.tool.execute('c1', { content: '  Uses pnpm  ', scope: 'workspace' })
    expect(created.details).toEqual({ action: 'created', memory: { id: 'new-1', scope: 'workspace', content: 'Uses pnpm', updatedAt: 1000 } })
    expect(text(created)).toBe('Remembered (id: new-1, scope: workspace).')
    const updated = await memory_write!.tool.execute('c2', { content: 'Uses pnpm 12', scope: 'workspace', id: 'new-1' })
    expect(updated.details).toMatchObject({ action: 'updated', memory: { id: 'new-1', content: 'Uses pnpm 12' } })
    expect(text(updated)).toBe('Updated memory new-1.')
    expect([...entries.values()].map((e) => e.content)).toEqual(['Uses pnpm 12'])
  })

  it('memory_write 的 id 不存在、作用域不符或正文为空时报错，不改动条目', async () => {
    const { port, entries } = fakePort([entry('u1', 'user', 'Prefers tabs', 1)])
    const { memory_write } = tools(port)
    await expect(memory_write!.tool.execute('c1', { content: 'x', scope: 'user', id: 'missing' })).rejects.toThrow('Memory entry missing not found')
    await expect(memory_write!.tool.execute('c2', { content: 'x', scope: 'workspace', id: 'u1' })).rejects.toThrow(/scope is user/)
    await expect(memory_write!.tool.execute('c3', { content: '   ', scope: 'user' })).rejects.toThrow(/empty/)
    expect([...entries.values()]).toEqual([entry('u1', 'user', 'Prefers tabs', 1)])
  })

  it('超过 2000 字符的内容在参数校验时被拒绝（参数错误，不执行）', () => {
    expect(MEMORY_MAX_CHARS).toBe(2000)
    const { port } = fakePort()
    const { memory_write } = tools(port)
    expect(() => call(memory_write!.tool, { content: 'a'.repeat(2000), scope: 'user' })).not.toThrow()
    expect(() => call(memory_write!.tool, { content: 'a'.repeat(2001), scope: 'user' })).toThrow(/Validation failed for tool "memory_write"/)
    expect(() => call(memory_write!.tool, { content: 'ok', scope: 'team' })).toThrow(/Validation failed/)
  })

  it('memory_delete 删除并回报；不存在时报错', async () => {
    const { port, entries } = fakePort([entry('w1', 'workspace', 'Uses pnpm', 1)])
    const { memory_delete } = tools(port)
    const result = await memory_delete!.tool.execute('c1', { id: 'w1' })
    expect(text(result)).toBe('Deleted memory w1.')
    expect(result.details).toEqual({ action: 'deleted', memory: entry('w1', 'workspace', 'Uses pnpm', 1) })
    expect(entries.size).toBe(0)
    await expect(memory_delete!.tool.execute('c2', { id: 'w1' })).rejects.toThrow('Memory entry w1 not found')
  })

  it('memory_list 按作用域列出（带 id），没有条目时说明', async () => {
    const { port } = fakePort([entry('u1', 'user', 'Prefers tabs', 1), entry('w1', 'workspace', 'Uses pnpm', 2)])
    const { memory_list } = tools(port)
    const all = text(await memory_list!.tool.execute('c1', {}))
    expect(all.indexOf('id="w1"')).toBeLessThan(all.indexOf('id="u1"'))
    expect(all).toContain('<entry id="u1" scope="user">\nPrefers tabs\n</entry>')
    const user = text(await memory_list!.tool.execute('c2', { scope: 'user' }))
    expect(user).toContain('id="u1"')
    expect(user).not.toContain('id="w1"')
    const empty = fakePort()
    expect(text(await tools(empty.port).memory_list!.tool.execute('c3', {}))).toBe('No memories saved.')
  })

  it('审批对象：memory_write 为正文，memory_delete 为 id', () => {
    const { port } = fakePort()
    const { memory_write, memory_delete, memory_list } = tools(port)
    expect(memory_write!.tool.permissionSubject?.({ content: 'Uses pnpm', scope: 'user' })).toBe('Uses pnpm')
    expect(memory_delete!.tool.permissionSubject?.({ id: 'w1' })).toBe('w1')
    expect(memory_list!.tool.permissionSubject).toBeUndefined()
  })
})
