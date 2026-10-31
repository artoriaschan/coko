import {
  agentPaths,
  AgentDefinitionsResponse,
  apiPaths,
  SessionAgentsResponse,
  type AgentSnapshot,
  type AnswerApprovalRequest,
  type ProgressEvent,
} from '@coko/protocol'
import { Type } from 'typebox'
import { createStore, type StoreApi } from 'zustand/vanilla'
import { ApiError, requestJson, type Fetch } from '../client/api.ts'

// 子代理视图的 store（docs/subsystems/subagents.md#界面）：每个父 Session 的子代理快照（GET /api/sessions/:id/agents 加 WS agent_update）、
// 每个子代理最近一次工具调用（agent_update.activity，只在内存）、Agents tab 的选中项与打开请求、设置分区的定义列表，以及停止与
// 回答子 Session 的审批（父会话输入区接管的审批卡发往子 Session）。

export interface AgentsBackend {
  list(sessionId: string): Promise<AgentSnapshot[]>
  /** 204；已结束 409 agent-not-running。 */
  cancel(sessionId: string, agentId: string): Promise<void>
  definitions(workspaceId: string): Promise<AgentDefinitionsResponse>
  /** 回答子 Session 的审批请求（POST /api/sessions/<child>/approvals/<id>）。 */
  answer(sessionId: string, requestId: string, answer: AnswerApprovalRequest): Promise<void>
}

const NoContent = Type.Undefined()

/** 经 requestJson（错误体与响应在信任边界按 schema 校验）。 */
export function httpAgentsBackend(fetchImpl?: Fetch): AgentsBackend {
  return {
    list: (sessionId) => requestJson(SessionAgentsResponse, 'GET', agentPaths.sessionAgents(sessionId), undefined, fetchImpl),
    cancel: async (sessionId, agentId) => {
      await requestJson(NoContent, 'POST', agentPaths.cancel(sessionId, agentId), undefined, fetchImpl)
    },
    definitions: (workspaceId) => requestJson(AgentDefinitionsResponse, 'GET', agentPaths.definitions(workspaceId), undefined, fetchImpl),
    answer: async (sessionId, requestId, answer) => {
      await requestJson(NoContent, 'POST', apiPaths.sessionApproval(sessionId, requestId), answer, fetchImpl)
    },
  }
}

export interface SessionAgents {
  status: 'loading' | 'ready' | 'error'
  /** 派发顺序。 */
  agents: AgentSnapshot[]
}

export interface AgentActivity {
  toolName: string
  summary: string
}

export interface AgentDefinitionsView {
  status: 'loading' | 'ready' | 'error'
  response?: AgentDefinitionsResponse
}

export interface AgentsState {
  /** 父 Session id → 子代理列表。 */
  sessions: Record<string, SessionAgents>
  /** 子代理 id → 最近一次工具调用（agent_update.activity）。 */
  activity: Record<string, AgentActivity>
  /** 父 Session 的选中项（renderer 内存）。 */
  selected: Record<string, string>
  /** 父 Session 的"打开子代理"请求计数：标题栏按钮据此打开右栏的 Agents tab（工具卡与通知行发起）。 */
  openRequests: Record<string, number>
  /** Workspace id → 定义与诊断（设置 → Agents）。 */
  definitions: Record<string, AgentDefinitionsView>
}

/** chat-store 的 progress 订阅（onProgress）。 */
export interface AgentProgressSource {
  onProgress(listener: (progress: { sessionId: string; runId: string; event: ProgressEvent }) => void): () => void
}

export interface AgentsActions {
  /** 读取父 Session 的子代理列表；较早发出的请求晚到时被丢弃，失败时保留已有列表。 */
  load(sessionId: string): Promise<void>
  select(sessionId: string, agentId: string): void
  /** 选中并请求打开右栏的 Agents tab。 */
  open(sessionId: string, agentId: string): void
  /** 停止（POST cancel）；已结束（409 agent-not-running）视为成功；其他错误抛给调用方。之后重新读取列表。 */
  cancel(sessionId: string, agentId: string): Promise<void>
  /**
   * 回答子 Session 的审批请求。同一请求只发送一次：发送中或已成功的重复调用直接返回 true；失败时可再次回答（已不在等待时不再重发）。
   * 失败时抛给调用方。
   */
  answerApproval(childSessionId: string, requestId: string, answer: AnswerApprovalRequest): Promise<boolean>
  loadDefinitions(workspaceId: string): Promise<void>
  /** 订阅 agent_update 进度；同一来源只订阅一次（引用计数），返回取消订阅。 */
  attach(source: AgentProgressSource): () => void
}

export type AgentsStore = StoreApi<AgentsState & AgentsActions>

export const isAgentRunning = (agent: Pick<AgentSnapshot, 'status'>) => agent.status === 'running'

export function createAgentsStore(backend: AgentsBackend = httpAgentsBackend()): AgentsStore {
  const listRequests = new Map<string, number>()
  const definitionRequests = new Map<string, number>()
  const answering = new Map<string, Promise<boolean>>()
  const sources = new Map<AgentProgressSource['onProgress'], { count: number; off: () => void }>()

  return createStore<AgentsState & AgentsActions>()((set, get) => {
    const onProgress = ({ sessionId, event }: { sessionId: string; runId: string; event: ProgressEvent }) => {
      if (event.type !== 'agent_update') return
      if (event.activity) set({ activity: { ...get().activity, [event.agentId]: event.activity } })
      const session = get().sessions[sessionId]
      const known = session?.agents.find((a) => a.agentId === event.agentId)
      if (!session || !known) {
        // 新派发的子代理（或列表尚未读取）：读回完整快照（类型、描述、后台）。
        void get().load(sessionId)
        return
      }
      if (known.status === event.status) return
      const agents = session.agents.map((a) => (a.agentId === event.agentId ? { ...a, status: event.status } : a))
      set({ sessions: { ...get().sessions, [sessionId]: { ...session, agents } } })
      // 结束：读回用量、结束时间与 worktree。
      if (event.status !== 'running') void get().load(sessionId)
    }

    return {
      sessions: {},
      activity: {},
      selected: {},
      openRequests: {},
      definitions: {},

      async load(sessionId) {
        const request = (listRequests.get(sessionId) ?? 0) + 1
        listRequests.set(sessionId, request)
        if (!get().sessions[sessionId]) set({ sessions: { ...get().sessions, [sessionId]: { status: 'loading', agents: [] } } })
        try {
          const listed = await backend.list(sessionId)
          if (listRequests.get(sessionId) !== request) return
          // 列表请求期间到达的 agent_update 可能更新：已结束的状态不被较早的"运行中"覆盖。
          const seen = new Map((get().sessions[sessionId]?.agents ?? []).map((a) => [a.agentId, a]))
          const agents = listed.map((agent) => {
            const before = seen.get(agent.agentId)
            return before && !isAgentRunning(before) && isAgentRunning(agent) ? { ...agent, status: before.status } : agent
          })
          set({ sessions: { ...get().sessions, [sessionId]: { status: 'ready', agents } } })
        } catch {
          if (listRequests.get(sessionId) !== request) return
          set({ sessions: { ...get().sessions, [sessionId]: { status: 'error', agents: get().sessions[sessionId]?.agents ?? [] } } })
        }
      },

      select(sessionId, agentId) {
        set({ selected: { ...get().selected, [sessionId]: agentId } })
      },

      open(sessionId, agentId) {
        set({
          selected: { ...get().selected, [sessionId]: agentId },
          openRequests: { ...get().openRequests, [sessionId]: (get().openRequests[sessionId] ?? 0) + 1 },
        })
      },

      async cancel(sessionId, agentId) {
        try {
          await backend.cancel(sessionId, agentId)
        } catch (error) {
          if (!(error instanceof ApiError && error.code === 'agent-not-running')) throw error
        } finally {
          void get().load(sessionId)
        }
      },

      answerApproval(childSessionId, requestId, answer) {
        const key = `${childSessionId}:${requestId}`
        const inflight = answering.get(key)
        if (inflight) return inflight
        const sent = backend.answer(childSessionId, requestId, answer).then(
          () => true,
          (error: unknown) => {
            // 请求已经结束（例如另一处已回答）：不再允许重答，等决定条目到达。
            if (!(error instanceof ApiError && error.code === 'approval-not-pending')) answering.delete(key)
            throw error
          },
        )
        answering.set(key, sent)
        return sent
      },

      async loadDefinitions(workspaceId) {
        const request = (definitionRequests.get(workspaceId) ?? 0) + 1
        definitionRequests.set(workspaceId, request)
        const current = get().definitions[workspaceId]
        set({ definitions: { ...get().definitions, [workspaceId]: { ...current, status: 'loading' } } })
        try {
          const response = await backend.definitions(workspaceId)
          if (definitionRequests.get(workspaceId) !== request) return
          set({ definitions: { ...get().definitions, [workspaceId]: { status: 'ready', response } } })
        } catch {
          if (definitionRequests.get(workspaceId) !== request) return
          set({ definitions: { ...get().definitions, [workspaceId]: { ...get().definitions[workspaceId], status: 'error' } } })
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
export const agentsStore: AgentsStore = createAgentsStore()
