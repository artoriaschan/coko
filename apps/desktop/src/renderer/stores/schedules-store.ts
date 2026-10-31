import { Schedule, ScheduleListResponse, schedulePaths, type CreateScheduleRequest, type ProgressEvent, type UpdateScheduleRequest } from '@coko/protocol'
import { Type } from 'typebox'
import { createStore, type StoreApi } from 'zustand/vanilla'
import { ApiError, requestJson, type Fetch } from '../client/api.ts'

// 定时任务的 store（docs/subsystems/schedules.md#界面）：按会话与全部会话的列表（GET /api/schedules）、新建、修改（按已知 revision；
// 冲突时读回）、删除，以及 progress schedule_update 的快照合并。删除不推送进度，由本 store 自己从列表去掉。

export interface SchedulesBackend {
  /** 省略 sessionId 为全部会话。 */
  list(sessionId?: string): Promise<Schedule[]>
  create(sessionId: string, input: CreateScheduleRequest): Promise<Schedule>
  update(id: string, patch: UpdateScheduleRequest): Promise<Schedule>
  remove(id: string): Promise<void>
}

const NoContent = Type.Undefined()

export function httpSchedulesBackend(fetchImpl?: Fetch): SchedulesBackend {
  return {
    list: (sessionId) => requestJson(ScheduleListResponse, 'GET', schedulePaths.list(sessionId), undefined, fetchImpl),
    create: (sessionId, input) => requestJson(Schedule, 'POST', schedulePaths.sessionSchedules(sessionId), input, fetchImpl),
    update: (id, patch) => requestJson(Schedule, 'PATCH', schedulePaths.schedule(id), patch, fetchImpl),
    remove: async (id) => {
      await requestJson(NoContent, 'DELETE', schedulePaths.schedule(id), undefined, fetchImpl)
    },
  }
}

/** 全部会话的列表在 lists 中的键（设置 → 定时任务）。 */
export const ALL_SESSIONS = '*'

export interface ScheduleList {
  status: 'loading' | 'ready' | 'error'
  /** 创建顺序（与接口相同）。 */
  schedules: Schedule[]
}

export type ScheduleSaveResult = { status: 'saved'; schedule: Schedule } | { status: 'conflict' }

export interface SchedulesState {
  /** 键为 sessionId，或 ALL_SESSIONS。 */
  lists: Record<string, ScheduleList>
  /** 设置 → 定时任务的"跳转"：待在该会话打开 Schedules tab（标题栏按钮取走）。 */
  pendingOpen: string | null
}

/** chat-store 的 progress 订阅（onProgress）。 */
export interface ScheduleProgressSource {
  onProgress(listener: (progress: { sessionId: string; runId: string; event: ProgressEvent }) => void): () => void
}

export interface SchedulesActions {
  /** 读取会话（或全部会话）的列表；较早发出的请求晚到时丢弃，失败时保留已有列表。 */
  load(sessionId?: string): Promise<void>
  /** 新建；失败时抛 ApiError（调用方本地化提示，表单保留输入）。 */
  create(sessionId: string, input: CreateScheduleRequest): Promise<Schedule>
  /** 按已知 revision 修改；revision 冲突时读回最新值并返回 conflict，其他错误抛 ApiError。 */
  update(id: string, patch: Omit<UpdateScheduleRequest, 'revision'>): Promise<ScheduleSaveResult>
  /** 删除；已不存在（404）视为已删除，其他错误抛 ApiError。 */
  remove(id: string): Promise<void>
  /** 订阅 schedule_update 进度；同一来源只订阅一次（引用计数），返回取消订阅。 */
  attach(source: ScheduleProgressSource): () => void
  requestOpen(sessionId: string): void
  /** 待打开的正是该会话时取走（清除）并返回 true。 */
  takeOpenRequest(sessionId: string): boolean
}

export type SchedulesStore = StoreApi<SchedulesState & SchedulesActions>

const keyOf = (sessionId?: string) => sessionId ?? ALL_SESSIONS

export function createSchedulesStore(backend: SchedulesBackend = httpSchedulesBackend()): SchedulesStore {
  const latest = new Map<string, number>()
  let counter = 0
  const sources = new Map<ScheduleProgressSource['onProgress'], { count: number; off: () => void }>()

  return createStore<SchedulesState & SchedulesActions>()((set, get) => {
    const known = (id: string): Schedule | undefined => {
      for (const list of Object.values(get().lists)) {
        const found = list.schedules.find((s) => s.id === id)
        if (found) return found
      }
      return undefined
    }

    /** 快照并入会话的列表与全部会话的列表（已读取过的）；revision 较旧的不覆盖。 */
    const upsert = (schedule: Schedule) =>
      set((state) => {
        const lists = { ...state.lists }
        for (const key of [schedule.sessionId, ALL_SESSIONS]) {
          const list = lists[key]
          if (!list) continue
          const at = list.schedules.findIndex((s) => s.id === schedule.id)
          if (at >= 0 && list.schedules[at]!.revision > schedule.revision) continue
          const schedules = at < 0 ? [...list.schedules, schedule] : list.schedules.map((s, i) => (i === at ? schedule : s))
          lists[key] = { ...list, schedules }
        }
        return { lists }
      })

    const drop = (id: string) =>
      set((state) => ({
        lists: Object.fromEntries(Object.entries(state.lists).map(([key, list]) => [key, { ...list, schedules: list.schedules.filter((s) => s.id !== id) }])),
      }))

    const load = async (sessionId?: string) => {
      const key = keyOf(sessionId)
      const id = ++counter
      latest.set(key, id)
      if (!get().lists[key]) set((s) => ({ lists: { ...s.lists, [key]: { status: 'loading', schedules: [] } } }))
      try {
        const schedules = await backend.list(sessionId)
        if (latest.get(key) !== id) return
        set((s) => ({ lists: { ...s.lists, [key]: { status: 'ready', schedules } } }))
      } catch {
        if (latest.get(key) !== id) return
        set((s) => ({ lists: { ...s.lists, [key]: { status: 'error', schedules: s.lists[key]?.schedules ?? [] } } }))
      }
    }

    /** 冲突后读回：该任务所在会话的列表与全部会话的列表（已读取过的）。 */
    const reloadFor = async (sessionId: string | undefined) => {
      const keys = new Set([...(sessionId === undefined ? [] : [sessionId]), ...(get().lists[ALL_SESSIONS] ? [ALL_SESSIONS] : [])])
      await Promise.all([...keys].map((key) => load(key === ALL_SESSIONS ? undefined : key)))
    }

    const onProgress = ({ event }: { event: ProgressEvent }) => {
      if (event.type === 'schedule_update') upsert(event.schedule)
    }

    return {
      lists: {},
      pendingOpen: null,
      load,

      async create(sessionId, input) {
        const created = await backend.create(sessionId, input)
        upsert(created)
        return created
      },

      async update(id, patch) {
        const current = known(id)
        try {
          const updated = await backend.update(id, { ...patch, revision: current?.revision ?? 1 })
          upsert(updated)
          return { status: 'saved', schedule: updated }
        } catch (error) {
          if (!(error instanceof ApiError && error.code === 'revision-conflict')) throw error
          await reloadFor(current?.sessionId)
          return { status: 'conflict' }
        }
      },

      async remove(id) {
        try {
          await backend.remove(id)
        } catch (error) {
          if (!(error instanceof ApiError && error.code === 'not-found')) throw error
        }
        drop(id)
      },

      attach(source) {
        const key = source.onProgress
        let entry = sources.get(key)
        if (!entry) {
          entry = { count: 0, off: source.onProgress(onProgress) }
          sources.set(key, entry)
        }
        entry.count++
        let attached = true
        return () => {
          if (!attached) return
          attached = false
          const current = sources.get(key)
          if (!current) return
          current.count--
          if (current.count === 0) {
            current.off()
            sources.delete(key)
          }
        }
      },

      requestOpen(sessionId) {
        set({ pendingOpen: sessionId })
      },

      takeOpenRequest(sessionId) {
        if (get().pendingOpen !== sessionId) return false
        set({ pendingOpen: null })
        return true
      },
    }
  })
}

/** 应用内共用的 store（组件经 context 取用，测试可换成自己的）。 */
export const schedulesStore: SchedulesStore = createSchedulesStore()
