import { teamPaths, TeamSnapshot, type ProgressEvent } from '@coko/protocol'
import { createStore, type StoreApi } from 'zustand/vanilla'
import { requestJson, type Fetch } from '../client/api.ts'

// 团队视图的 store（docs/subsystems/teams.md#界面）：每个根 Session 的 TeamSnapshot（GET /api/sessions/:id/team 加 progress team_update）。
// 标题栏的团队按钮与右栏 Team tab 读取它；成员的只读时间线经 chat-store 的 subscribeSession 订阅子 Session，不在这里。

export interface TeamBackend {
  get(sessionId: string): Promise<TeamSnapshot>
}

/** 经 requestJson（响应在信任边界按 schema 校验）。 */
export function httpTeamBackend(fetchImpl?: Fetch): TeamBackend {
  return { get: (sessionId) => requestJson(TeamSnapshot, 'GET', teamPaths.team(sessionId), undefined, fetchImpl) }
}

export interface SessionTeam {
  status: 'loading' | 'ready' | 'error'
  /** 最近一次读取或 team_update 的快照；读取失败时保留已有的。 */
  team?: TeamSnapshot
}

/** chat-store 的 progress 订阅（onProgress）。 */
export interface TeamProgressSource {
  onProgress(listener: (progress: { sessionId: string; runId: string; event: ProgressEvent }) => void): () => void
}

export interface TeamState {
  /** 根 Session id → 团队快照。 */
  teams: Record<string, SessionTeam>
  /** 读取快照；较早发出的请求晚到时（或其间到达 team_update）被丢弃，失败时保留已有快照。 */
  load(sessionId: string): Promise<void>
  /** 订阅 team_update 进度；同一来源只订阅一次（引用计数），返回取消订阅。 */
  attach(source: TeamProgressSource): () => void
}

export type TeamStore = StoreApi<TeamState>

export const isMemberRunning = (member: { status: string }) => member.status === 'running'

export function createTeamStore(backend: TeamBackend = httpTeamBackend()): TeamStore {
  /** 每个会话的版本：每次读取与 team_update 加一，响应只在版本未变时写入。 */
  const versions = new Map<string, number>()
  const bump = (sessionId: string) => {
    const next = (versions.get(sessionId) ?? 0) + 1
    versions.set(sessionId, next)
    return next
  }
  const sources = new Map<TeamProgressSource['onProgress'], { count: number; off: () => void }>()

  return createStore<TeamState>()((set, get) => {
    const put = (sessionId: string, value: SessionTeam) => set({ teams: { ...get().teams, [sessionId]: value } })
    const onProgress = ({ sessionId, event }: { sessionId: string; runId: string; event: ProgressEvent }) => {
      if (event.type !== 'team_update') return
      bump(sessionId)
      put(sessionId, { status: 'ready', team: event.team })
    }

    return {
      teams: {},

      async load(sessionId) {
        const version = bump(sessionId)
        const current = get().teams[sessionId]
        if (!current) put(sessionId, { status: 'loading' })
        try {
          const team = await backend.get(sessionId)
          if (versions.get(sessionId) === version) put(sessionId, { status: 'ready', team })
        } catch {
          if (versions.get(sessionId) !== version) return
          const kept = get().teams[sessionId]?.team
          put(sessionId, kept ? { status: 'error', team: kept } : { status: 'error' })
        }
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
    }
  })
}

/** 应用内共用的 store。 */
export const teamStore: TeamStore = createTeamStore()
