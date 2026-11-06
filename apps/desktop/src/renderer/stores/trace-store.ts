import { ErrorResponse, tracePaths, TraceResponse } from '@coko/protocol'
import { Value } from 'typebox/value'
import { createStore, type StoreApi } from 'zustand/vanilla'
import { ApiError, requestJson, type Fetch } from '../client/api.ts'

// 追踪视图的 store（docs/subsystems/tracing.md#界面）：每个 Session 的 GET …/trace（响应在信任边界按 schema 校验）与导出的 ndjson 文本。
// 轨迹视图在请求、消息、Run、审批与 Hook 条目变化时合并重读；较早发出的请求晚到时被丢弃。

export interface SessionExportFile {
  filename: string
  text: string
}

export interface TraceBackend {
  trace(sessionId: string): Promise<TraceResponse>
  /** GET …/export?children=1：会话与其子 Session 的条目。 */
  export(sessionId: string): Promise<SessionExportFile>
}

const defaultFetch: Fetch = (input, init) => fetch(input, init)

/** content-disposition 的文件名；没有时按 Session id 命名。 */
function filenameOf(response: Response, sessionId: string): string {
  const match = /filename="([^"]+)"/.exec(response.headers.get('content-disposition') ?? '')
  return match?.[1] ?? `coko-session-${sessionId}.ndjson`
}

export function httpTraceBackend(fetchImpl: Fetch = defaultFetch): TraceBackend {
  return {
    trace: (sessionId) => requestJson(TraceResponse, 'GET', tracePaths.trace(sessionId), undefined, fetchImpl),
    async export(sessionId) {
      let response: Response
      try {
        response = await fetchImpl(tracePaths.export(sessionId, true), { method: 'GET' })
      } catch (error) {
        throw new ApiError('network', error instanceof Error ? error.message : String(error), 0)
      }
      const text = await response.text()
      if (!response.ok) {
        let body: unknown
        try {
          body = JSON.parse(text)
        } catch {
          body = undefined
        }
        if (Value.Check(ErrorResponse, body)) throw new ApiError(body.error.code, body.error.message, response.status, body.error.details)
        throw new ApiError('bad-response', `Unexpected response ${response.status}`, response.status)
      }
      return { filename: filenameOf(response, sessionId), text }
    },
  }
}

export interface SessionTrace {
  status: 'loading' | 'ready' | 'error'
  response?: TraceResponse
}

export interface TraceState {
  sessions: Record<string, SessionTrace>
  /** 正在导出的 Session。 */
  exporting: Record<string, boolean>
}

export interface TraceActions {
  /** 读取追踪；失败时保留已有内容（状态为 error）。 */
  load(sessionId: string): Promise<void>
  /** 读取导出文本；同一 Session 导出中时返回 undefined。失败抛给调用方。 */
  exportSession(sessionId: string): Promise<SessionExportFile | undefined>
}

export type TraceStore = StoreApi<TraceState & TraceActions>

export function createTraceStore(backend: TraceBackend = httpTraceBackend()): TraceStore {
  const requests = new Map<string, number>()
  return createStore<TraceState & TraceActions>()((set, get) => ({
    sessions: {},
    exporting: {},

    async load(sessionId) {
      const request = (requests.get(sessionId) ?? 0) + 1
      requests.set(sessionId, request)
      const current = get().sessions[sessionId]
      if (!current) set({ sessions: { ...get().sessions, [sessionId]: { status: 'loading' } } })
      try {
        const response = await backend.trace(sessionId)
        if (requests.get(sessionId) !== request) return
        set({ sessions: { ...get().sessions, [sessionId]: { status: 'ready', response } } })
      } catch {
        if (requests.get(sessionId) !== request) return
        set({ sessions: { ...get().sessions, [sessionId]: { ...get().sessions[sessionId], status: 'error' } } })
      }
    },

    async exportSession(sessionId) {
      if (get().exporting[sessionId]) return undefined
      set({ exporting: { ...get().exporting, [sessionId]: true } })
      try {
        return await backend.export(sessionId)
      } finally {
        set({ exporting: { ...get().exporting, [sessionId]: false } })
      }
    },
  }))
}

/** 应用内共用的 store。 */
export const traceStore: TraceStore = createTraceStore()
