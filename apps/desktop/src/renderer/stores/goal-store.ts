import { ErrorResponse, GoalResponse, goalPaths, type GoalActionRequest, type GoalUsage } from '@coko/protocol'
import { Value } from 'typebox/value'
import { createStore, type StoreApi } from 'zustand/vanilla'
import { ApiError } from '../client/api.ts'

// Goal 卡的 store（docs/subsystems/goal.md#界面）：Goal 快照本身取自会话条目（最新的 goal 条目），这里只保存 GET /api/sessions/:id/goal
// 派生的五维已用量、进行中的动作，以及卡片的界面状态（展开、经 /goal 打开、关闭）。界面状态只在 renderer 内存中，不入记录。

export interface GoalBackend {
  get(sessionId: string): Promise<GoalResponse>
  /** revision 过期 409 revision-conflict；当前阶段不允许 409 invalid-transition。 */
  act(sessionId: string, request: GoalActionRequest): Promise<GoalResponse>
}

/** 同源相对路径，经 coko-app:// 代理附加认证；响应在信任边界按 schema 校验。 */
export function httpGoalBackend(fetchImpl: (input: string, init?: RequestInit) => Promise<Response> = (input, init) => fetch(input, init)): GoalBackend {
  async function call(method: string, path: string, body?: unknown): Promise<GoalResponse> {
    let response: Response
    try {
      response = await fetchImpl(path, {
        method,
        ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
      })
    } catch (error) {
      throw new ApiError('network', error instanceof Error ? error.message : String(error), 0)
    }
    const value: unknown = await response.json().catch(() => undefined)
    if (!response.ok) {
      if (Value.Check(ErrorResponse, value)) throw new ApiError(value.error.code, value.error.message, response.status, value.error.details)
      throw new ApiError('bad-response', `Request failed with status ${response.status}`, response.status)
    }
    if (!Value.Check(GoalResponse, value)) throw new ApiError('bad-response', `Unexpected response for ${method} ${path}`, response.status)
    return value
  }
  return {
    get: (sessionId) => call('GET', goalPaths.sessionGoal(sessionId)),
    act: (sessionId, request) => call('POST', goalPaths.sessionGoal(sessionId), request),
  }
}

export type GoalActionName = GoalActionRequest['action']

export interface GoalState {
  /** 各会话最近一次读到的已用量（goalId 为响应中 Goal 的 id；没有 Goal 时 null）。 */
  usage: Record<string, { goalId: string | null; usage: GoalUsage }>
  /** 进行中的动作（同一时刻一个）。 */
  pending: Record<string, GoalActionName | undefined>
  /** 卡片是否展开（缺省收起）。 */
  expanded: Record<string, boolean>
  /** 经 /goal 打开时的条目 seq：此后没有新的 Run 开始之前，已终结或不存在的 Goal 也显示卡片。 */
  opened: Record<string, number | undefined>
  /** 用户关闭卡片时的条目 seq：此后没有新的 goal 条目之前不显示已终结的 Goal 或空状态。 */
  dismissed: Record<string, number | undefined>
}

export interface GoalActions {
  /** 读取已用量；同一会话并发的读取只采用最后发出的那次。 */
  load(sessionId: string): Promise<void>
  /** 用户的动作；成功时更新已用量并返回响应，失败时抛出 ApiError（调用方提示）。 */
  act(sessionId: string, request: GoalActionRequest): Promise<GoalResponse>
  setExpanded(sessionId: string, expanded: boolean): void
  /** /goal 无参数：打开并展开卡片；seq 为当前最后一条条目的 seq。 */
  open(sessionId: string, seq: number): void
  close(sessionId: string, seq: number): void
}

export type GoalStore = StoreApi<GoalState & GoalActions>

export function createGoalStore(backend: GoalBackend = httpGoalBackend()): GoalStore {
  const requests = new Map<string, number>()
  return createStore<GoalState & GoalActions>()((set, get) => {
    const patch = <K extends keyof GoalState>(key: K, sessionId: string, value: GoalState[K][string]) =>
      set({ [key]: { ...get()[key], [sessionId]: value } } as unknown as Partial<GoalState>)
    const apply = (sessionId: string, response: GoalResponse) => patch('usage', sessionId, { goalId: response.goal?.id ?? null, usage: response.usage })
    return {
      usage: {},
      pending: {},
      expanded: {},
      opened: {},
      dismissed: {},
      async load(sessionId) {
        const token = (requests.get(sessionId) ?? 0) + 1
        requests.set(sessionId, token)
        try {
          const response = await backend.get(sessionId)
          if (requests.get(sessionId) === token) apply(sessionId, response)
        } catch {
          // 读取失败时保留上一次的用量；下一条条目到达时再读。
        }
      },
      async act(sessionId, request) {
        patch('pending', sessionId, request.action)
        // 动作的响应比之前发出的读取更新：之前的读取结果不再采用。
        requests.set(sessionId, (requests.get(sessionId) ?? 0) + 1)
        try {
          const response = await backend.act(sessionId, request)
          apply(sessionId, response)
          return response
        } finally {
          patch('pending', sessionId, undefined)
        }
      },
      setExpanded: (sessionId, expanded) => patch('expanded', sessionId, expanded),
      open(sessionId, seq) {
        set({
          opened: { ...get().opened, [sessionId]: seq },
          expanded: { ...get().expanded, [sessionId]: true },
          dismissed: { ...get().dismissed, [sessionId]: undefined },
        })
      },
      close(sessionId, seq) {
        set({ opened: { ...get().opened, [sessionId]: undefined }, dismissed: { ...get().dismissed, [sessionId]: seq } })
      },
    }
  })
}

/** 应用内共用的 Goal store（测试经 GoalStoreProvider 换成自己的）。 */
export const goalStore = createGoalStore()
