// Memory：<memory> system section 与 memory_* 工具（受 memory.enabled 控制，开启时每个 Run 都注入、没有条目也注入，关闭时不注入、
// 不注册工具；子 Session 与无界面运行只注册 memory_list，段内没有写入引导），以及 /api/memories 共用的 MemoryService。可见范围为用户级与
// 本 Run 的项目记忆 Workspace（ContextScope.memoryWorkspaceId，ADR 0027；不属于项目时只有用户级，工具没有 workspace 作用域）；正文保存前经 redactText 脱敏（ADR 0004）；
// 用户来源的条目模型不能替换或删除。
import { createMemoryTools, MEMORY_SEARCH_LIMIT, memorySection, MemoryToolError, type MemoryEntry as AgentMemory, type MemoryPort } from '@coko/agent'
import { redactText } from '@coko/logging'
import { MEMORY_CONTENT_MAX, type MemoryEntry, type MemoryScope, type MemorySource } from '@coko/protocol'
import type { Memory } from '@coko/session'
import { AppError } from '../errors.ts'
import type { ContextContribution, ContextContributionOptions, ContextScope, MemoryStore, RuleTool } from './types.ts'

const toEntry = (m: Memory): MemoryEntry => ({
  id: m.id,
  scope: m.scope,
  workspaceId: m.workspaceId,
  content: m.content,
  // 库中的 source 只由本服务写入（model / user）。
  source: m.source === 'model' ? 'model' : 'user',
  createdAt: m.createdAt,
  updatedAt: m.updatedAt,
})

/** 去掉首尾空白并脱敏；空或超过上限时 bad-request。 */
function checkContent(content: string): string {
  const text = content.trim()
  if (text === '') throw new AppError('bad-request', 'Memory content is empty')
  if (text.length > MEMORY_CONTENT_MAX) throw new AppError('bad-request', `Memory content exceeds ${MEMORY_CONTENT_MAX} characters`)
  return redactText(text)
}

/** 用户级与某个 Workspace（可省略）的记忆：HTTP 路由与工具端口共用。 */
export class MemoryService {
  readonly #store: MemoryStore
  constructor(store: MemoryStore) {
    this.#store = store
  }

  async #requireWorkspace(workspaceId: string) {
    if (!(await this.#store.sessions.getWorkspace(workspaceId))) throw new AppError('not-found', `Workspace ${workspaceId} not found`)
  }

  /**
   * 用户级条目，给出 workspaceId 时另加该 Workspace 的条目；按仓库的次序（updatedAt 倒序，同一时刻后写的在前）。
   * scope 只留一种：workspace 须给出 workspaceId（否则 bad-request）。
   */
  async list(workspaceId?: string, scope?: MemoryScope): Promise<MemoryEntry[]> {
    await this.#checkFilter(workspaceId, scope)
    // 一次查询再过滤：两次查询合并会丢掉同一毫秒内条目的写入次序。
    const all = await this.#store.memories.list()
    return all.filter((m) => visible(m, workspaceId) && (scope === undefined || m.scope === scope)).map(toEntry)
  }

  /**
   * 按关键词检索可见的条目（与 list 相同的可见范围与 scope），至多 limit 条（缺省 MEMORY_SEARCH_LIMIT），按仓库的次序：
   * FTS5 可用时按相关度，否则按 updatedAt 倒序（ADR 0003 的降级）。查询只有空白时为空数组。
   */
  async search(query: string, options: { workspaceId?: string; scope?: MemoryScope; limit?: number } = {}): Promise<MemoryEntry[]> {
    const { workspaceId, scope } = options
    await this.#checkFilter(workspaceId, scope)
    const limit = options.limit ?? MEMORY_SEARCH_LIMIT
    if (query.trim() === '' || limit < 1) return []
    if (scope === 'user') return (await this.#store.memories.search(query, { scope: 'user', limit })).map(toEntry)
    if (scope === 'workspace') return (await this.#store.memories.search(query, { scope: 'workspace', workspaceId: workspaceId!, limit })).map(toEntry)
    if (workspaceId === undefined) return (await this.#store.memories.search(query, { scope: 'user', limit })).map(toEntry)
    // 用户级与该 Workspace 一起排序：仓库的一次查询给出全库的次序（bm25 或 updatedAt），过滤掉其他 Workspace 的条目；
    // 过滤后不足 limit 而仓库可能还有更多时放大条数再查，使结果仍是全局次序的前 limit 条。
    for (let fetch = limit * 2; ; fetch *= 4) {
      const found = await this.#store.memories.search(query, { limit: fetch })
      const shown = found.filter((m) => visible(m, workspaceId))
      if (shown.length >= limit || found.length < fetch) return shown.slice(0, limit).map(toEntry)
    }
  }

  async #checkFilter(workspaceId: string | undefined, scope: MemoryScope | undefined) {
    if (scope === 'workspace' && workspaceId === undefined) throw new AppError('bad-request', 'Workspace memories need a workspaceId')
    if (workspaceId !== undefined) await this.#requireWorkspace(workspaceId)
  }

  async create(input: { scope: MemoryScope; workspaceId?: string; content: string; source: MemorySource }): Promise<MemoryEntry> {
    if ((input.scope === 'workspace') !== (input.workspaceId !== undefined))
      throw new AppError('bad-request', 'Workspace memories need a workspaceId; user memories must not have one')
    if (input.workspaceId !== undefined) await this.#requireWorkspace(input.workspaceId)
    const content = checkContent(input.content)
    return toEntry(await this.#store.memories.create({ scope: input.scope, workspaceId: input.workspaceId ?? null, content, source: input.source }))
  }

  /** 条目须存在；给出 workspaceId 时还须属于用户级或该 Workspace，为 null 时须是用户级（否则 not-found）。 */
  async #visible(id: string, workspaceId?: string | null): Promise<Memory> {
    const memory = await this.#store.memories.get(id)
    if (!memory || (workspaceId !== undefined && memory.scope === 'workspace' && memory.workspaceId !== workspaceId))
      throw new AppError('not-found', `Memory entry ${id} not found`)
    return memory
  }

  /** 模型（by model）不能改动用户来源的条目（forbidden）。用户改正文时来源同时改为 user；模型替换不改变来源。 */
  async #writable(id: string, workspaceId: string | null | undefined, by: MemorySource): Promise<Memory> {
    const memory = await this.#visible(id, workspaceId)
    if (by === 'model' && memory.source !== 'model')
      throw new AppError('forbidden', `Memory entry ${id} is maintained by the user and cannot be replaced or deleted; tell the user if it looks outdated`)
    return memory
  }

  async update(id: string, content: string, workspaceId: string | null | undefined, by: MemorySource): Promise<MemoryEntry> {
    await this.#writable(id, workspaceId, by)
    return toEntry(await this.#store.memories.update(id, { content: checkContent(content), ...(by === 'user' ? { source: 'user' } : {}) }))
  }

  async delete(id: string, workspaceId: string | null | undefined, by: MemorySource): Promise<MemoryEntry> {
    const memory = await this.#writable(id, workspaceId, by)
    await this.#store.memories.delete(id)
    return toEntry(memory)
  }
}

/** 一个 Workspace（可省略）能看到的条目：用户级与该 Workspace 的。 */
const visible = (m: Memory, workspaceId: string | undefined) => m.scope === 'user' || (workspaceId !== undefined && m.workspaceId === workspaceId)

const toAgent = (m: MemoryEntry): AgentMemory => ({ id: m.id, scope: m.scope, source: m.source, content: m.content, updatedAt: m.updatedAt })

/** 工具端口：限定在项目记忆 Workspace（省略时只有用户级）；可预期的失败转为 MemoryToolError（作为工具错误回给模型）。 */
export function memoryPort(service: MemoryService, workspaceId: string | undefined): MemoryPort {
  const tool = async <T>(task: () => Promise<T>): Promise<T> => {
    try {
      return await task()
    } catch (error) {
      if (error instanceof AppError && (error.code === 'not-found' || error.code === 'bad-request' || error.code === 'forbidden'))
        throw new MemoryToolError(error.message)
      throw error
    }
  }
  return {
    list: (filter) => tool(async () => (await service.list(workspaceId, filter?.scope)).map(toAgent)),
    search: (query, options) =>
      tool(async () =>
        (
          await service.search(query, { ...(workspaceId ? { workspaceId } : {}), ...(options.scope ? { scope: options.scope } : {}), limit: options.limit })
        ).map(toAgent),
      ),
    create: (input) =>
      tool(async () =>
        toAgent(await service.create({ scope: input.scope, ...(input.scope === 'workspace' ? { workspaceId } : {}), content: input.content, source: 'model' })),
      ),
    update: (id, content) => tool(async () => toAgent(await service.update(id, content, workspaceId ?? null, 'model'))),
    delete: (id) => tool(async () => toAgent(await service.delete(id, workspaceId ?? null, 'model'))),
  }
}

const notConnected = () => Promise.reject(new Error('Memory port is not connected'))
/** memory_* 的名字与权限类取自工具本身的定义（不执行，端口不接通）；Memory 关闭或没有存储时同样声明。 */
const MEMORY_RULE_TOOLS: readonly RuleTool[] = createMemoryTools({
  list: notConnected,
  search: notConnected,
  create: notConnected,
  update: notConnected,
  delete: notConnected,
}).map(({ tool, permissionClass }) => ({ name: tool.name, permissionClass }))

export function memoryContribution(options: ContextContributionOptions): ContextContribution {
  if (!options.memories) return { name: 'memory', ruleTools: MEMORY_RULE_TOOLS }
  const service = new MemoryService(options.memories)
  // 子 Session 与无界面运行只读：只有 memory_list（子 Session 另由子代理的固定排除集去掉写入工具），Memory 段没有写入引导。
  const writable = (scope: ContextScope) => !options.memoryReadOnly && !scope.parentSessionId
  const section = async (scope: ContextScope) =>
    memorySection((await service.list(scope.memoryWorkspaceId)).map(toAgent), {
      writable: writable(scope),
      project: scope.memoryWorkspaceId !== undefined,
    })
  return {
    name: 'memory',
    ruleTools: MEMORY_RULE_TOOLS,
    async systemSections(scope) {
      return scope.config.memory.enabled ? [await section(scope)] : []
    },
    async tools(scope) {
      if (!scope.config.memory.enabled) return []
      const tools = createMemoryTools(memoryPort(service, scope.memoryWorkspaceId), { project: scope.memoryWorkspaceId !== undefined })
      return writable(scope) ? tools : tools.filter(({ tool }) => tool.name === 'memory_list')
    },
    async report(scope) {
      return { breakdown: { memory: scope.config.memory.enabled ? (await section(scope)).text.length : 0 } }
    },
  }
}
