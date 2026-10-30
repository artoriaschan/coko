import {
  ConfigResponse,
  configPaths,
  ErrorResponse,
  MemoryEntry,
  MemoryListResponse,
  memoryPaths,
  type CapabilityConfigValues,
  type MemoryScope,
} from '@coko/protocol'
import { Type, type Static, type TSchema } from 'typebox'
import { Value } from 'typebox/value'
import { createStore, type StoreApi } from 'zustand/vanilla'

type Fetch = (input: string, init?: RequestInit) => Promise<Response>

/** Memory 接口的失败：code 为协议错误码，或 network / bad-response。 */
export class MemoryRequestError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'MemoryRequestError'
    this.code = code
  }
}

/** /api/memories 与记忆开关（PUT /api/config 的 memory.enabled）的请求；同源相对路径，响应在信任边界按 schema 校验。 */
export function createMemoryClient(fetchImpl: Fetch = (input, init) => fetch(input, init)) {
  async function call<S extends TSchema>(schema: S, method: string, path: string, body?: unknown): Promise<Static<S>> {
    let response: Response
    try {
      response = await fetchImpl(path, {
        method,
        ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
      })
    } catch (error) {
      throw new MemoryRequestError('network', error instanceof Error ? error.message : String(error))
    }
    const value: unknown = response.status === 204 ? undefined : await response.json().catch(() => undefined)
    if (!response.ok) {
      if (Value.Check(ErrorResponse, value)) throw new MemoryRequestError(value.error.code, value.error.message)
      throw new MemoryRequestError('bad-response', `${method} ${path} failed with status ${response.status}`)
    }
    if (!Value.Check(schema, value)) throw new MemoryRequestError('bad-response', `Unexpected response for ${method} ${path}`)
    return value as Static<S>
  }
  const scoped = (path: string, workspaceId?: string) => (workspaceId === undefined ? path : `${path}?workspaceId=${encodeURIComponent(workspaceId)}`)
  return {
    list: async (workspaceId?: string) => (await call(MemoryListResponse, 'GET', scoped(memoryPaths.memories, workspaceId))).memories,
    create: (input: { scope: MemoryScope; workspaceId?: string; content: string }) => call(MemoryEntry, 'POST', memoryPaths.memories, input),
    update: (id: string, content: string, workspaceId?: string) => call(MemoryEntry, 'PUT', scoped(memoryPaths.memory(id), workspaceId), { content }),
    remove: (id: string, workspaceId?: string) => call(Type.Undefined(), 'DELETE', scoped(memoryPaths.memory(id), workspaceId)),
    /** 读取全局值与 revision 后整体替换（PUT /api/config 只接受整份全局值）。 */
    async setEnabled(enabled: boolean, workspaceId?: string): Promise<ConfigResponse> {
      const current = await call(ConfigResponse, 'GET', scoped(configPaths.config, workspaceId))
      const values: CapabilityConfigValues = { ...current.global, memory: { ...current.global.memory, enabled } }
      return call(ConfigResponse, 'PUT', configPaths.config, {
        values,
        expectedRevision: current.globalRevision,
        ...(workspaceId === undefined ? {} : { workspaceId }),
      })
    },
  }
}

export type MemoryClient = ReturnType<typeof createMemoryClient>

export interface MemoryState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  /** 最近一次读取对应的 Workspace；null 时只有用户级。 */
  workspaceId: string | null
  /** 用户级与该 Workspace 的条目，updatedAt 倒序（Sidecar 的次序）。 */
  memories: MemoryEntry[]
}

export interface MemoryActions {
  /** 读取用户级与该 Workspace 的条目；较早发出的请求晚到时被丢弃。 */
  load(workspaceId?: string): Promise<void>
  /** 以下操作成功后重新读取；失败时抛出 MemoryRequestError，列表不变。 */
  create(input: { scope: MemoryScope; content: string }): Promise<void>
  update(id: string, content: string): Promise<void>
  remove(id: string): Promise<void>
}

export type MemoryStore = StoreApi<MemoryState & MemoryActions>

/** 设置页 Memory 分区的 vanilla store（无 React 依赖）。 */
export function createMemoryStore(client: MemoryClient = createMemoryClient()): MemoryStore {
  let latest = 0
  return createStore<MemoryState & MemoryActions>()((set, get) => {
    const current = () => get().workspaceId ?? undefined
    const reload = () => get().load(current())
    return {
      status: 'idle',
      workspaceId: null,
      memories: [],
      async load(workspaceId) {
        const request = ++latest
        set((state) => ({
          status: state.workspaceId === (workspaceId ?? null) && state.status === 'ready' ? 'ready' : 'loading',
          workspaceId: workspaceId ?? null,
        }))
        try {
          const memories = await client.list(workspaceId)
          if (request === latest) set({ status: 'ready', memories })
        } catch {
          if (request === latest) set({ status: 'error', memories: [] })
        }
      },
      async create({ scope, content }) {
        const workspaceId = current()
        await client.create({ scope, content, ...(scope === 'workspace' && workspaceId !== undefined ? { workspaceId } : {}) })
        await reload()
      },
      async update(id, content) {
        await client.update(id, content, current())
        await reload()
      },
      async remove(id) {
        await client.remove(id, current())
        await reload()
      },
    }
  })
}

/** 应用内共用的 store。 */
export const memoryStore: MemoryStore = createMemoryStore()
