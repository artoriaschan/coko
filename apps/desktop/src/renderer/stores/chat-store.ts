import type { ProgressEvent, ServerMessage, Session, SessionEntry, SessionModel, Workspace } from '@coko/protocol'
import { createStore, type StoreApi } from 'zustand/vanilla'
import { ApiError, type ApiClient } from '../client/api.ts'
import type { StreamClient } from '../client/connection.ts'

/** 进行中的工具：由 progress 维护，最终内容以 toolResult 条目为准。 */
export interface LiveTool {
  toolCallId: string
  toolName: string
  args: unknown
  status: 'running' | 'done' | 'error'
  partialResult?: unknown
  result?: unknown
}

/** 当前 Run 的临时显示状态；不持久化，断线后由条目重建。 */
export interface LiveRun {
  runId: string | null
  /**
   * 是否接收文本增量。中途订阅或重连时已错过前面的增量，置 false，等下一条 assistant 条目提交后
   * 再从空开始接收，避免显示缺头的文本。
   */
  accepting: boolean
  /** 当前 assistant 消息按 contentIndex 累积的文本与思考增量。 */
  blocks: { kind: 'text' | 'thinking'; text: string }[]
  tools: Record<string, LiveTool>
  retry?: { attempt: number; maxRetries: number }
}

export interface Conversation {
  status: 'loading' | 'ready' | 'error'
  entries: SessionEntry[]
  lastSeq: number
  running: boolean
  live: LiveRun | null
}

export type ChatFailure = { kind: 'send' | 'stop' | 'retry' | 'workspace' | 'model'; error: ApiError }

export interface ChatState {
  workspaces: Workspace[]
  sessions: Session[]
  listStatus: 'idle' | 'loading' | 'ready' | 'error'
  /** 当前会话；与 draftWorkspaceId 互斥。 */
  activeSessionId: string | null
  /** 新会话草稿所在的 Workspace：首条消息提交时才创建 Session。 */
  draftWorkspaceId: string | null
  /** 草稿中选择的模型；创建 Session 时使用，null 表示用默认模型。 */
  draftModel: SessionModel | null
  conversations: Record<string, Conversation>
}

export interface ChatActions {
  /** 读取 Workspace 与 Session 列表；首次加载时打开最近的会话。 */
  load(): Promise<void>
  openSession(sessionId: string): void
  startDraft(workspaceId?: string): void
  /** 选择目录并登记；登记成功后在其中开始新会话草稿。 */
  addWorkspace(pickDirectory: () => Promise<string | null>): Promise<void>
  /** 在当前会话（或草稿）中发送；返回是否被接受（失败时保留输入）。 */
  send(text: string): Promise<boolean>
  stop(): Promise<void>
  /** 以出错 Run 的用户文本重新提交。 */
  retry(text: string): Promise<boolean>
  /** 当前会话经协议切换模型；草稿中只记下选择。 */
  selectModel(model: SessionModel): Promise<void>
}

export type ChatStore = StoreApi<ChatState & ChatActions>

export interface ChatStoreOptions {
  api: ApiClient
  stream: StreamClient
  /** 操作失败（界面层负责本地化提示）。 */
  onFailure?: (failure: ChatFailure) => void
  /** 等待订阅确认的上限；超时后照常继续，条目会在补齐时到达。 */
  subscribeTimeoutMs?: number
}

const emptyLive = (runId: string | null, accepting: boolean): LiveRun => ({ runId, accepting, blocks: [], tools: {} })

const toApiError = (error: unknown) => (error instanceof ApiError ? error : new ApiError('network', error instanceof Error ? error.message : String(error), 0))

/** 首条消息的首行作为会话标题。 */
export function titleFromText(text: string): string {
  const line = text.trim().split('\n')[0]!.trim()
  return line.length > 60 ? line.slice(0, 59) + '…' : line
}

/**
 * 对话状态（Zustand vanilla store，无 React 依赖）。HTTP 提交命令，WebSocket 订阅条目与进度；
 * 打开过的会话保持订阅，重连后以各自的 lastSeq 补齐。
 */
export function createChatStore({ api, stream, onFailure, subscribeTimeoutMs = 10_000 }: ChatStoreOptions): ChatStore {
  const subscribed = new Map<string, Set<() => void>>()
  let loadedOnce = false

  const store = createStore<ChatState & ChatActions>()((set, get) => {
    const updateConversation = (sessionId: string, update: (c: Conversation) => Conversation) =>
      set((state) => {
        const current = state.conversations[sessionId]
        return current ? { conversations: { ...state.conversations, [sessionId]: update(current) } } : {}
      })

    const subscribe = (sessionId: string): Promise<void> => {
      const conversation = get().conversations[sessionId]
      const done = new Promise<void>((resolve) => {
        let waiters = subscribed.get(sessionId)
        if (!waiters) subscribed.set(sessionId, (waiters = new Set()))
        const timer = setTimeout(finish, subscribeTimeoutMs)
        function finish() {
          clearTimeout(timer)
          waiters!.delete(finish)
          resolve()
        }
        waiters.add(finish)
      })
      stream.send({ type: 'subscribe', sessionId, afterSeq: conversation?.lastSeq ?? 0 })
      return done
    }

    const ensureConversation = (sessionId: string) => {
      if (get().conversations[sessionId]) return
      const running = get().sessions.find((s) => s.id === sessionId)?.running ?? false
      set((state) => ({ conversations: { ...state.conversations, [sessionId]: { status: 'loading', entries: [], lastSeq: 0, running, live: null } } }))
      void subscribe(sessionId)
    }

    /**
     * 先乐观地标记运行中再请求：Run 可能在 202 返回前就结束，其 run_end 经 WebSocket 先到，
     * 之后不得再被改回运行中。请求失败时只撤销本次的乐观状态。
     */
    const submit = async (sessionId: string, text: string, kind: ChatFailure['kind']): Promise<boolean> => {
      const before = get().conversations[sessionId]
      const optimistic = before?.running ? before.live : emptyLive(null, true)
      if (before && !before.running) updateConversation(sessionId, (c) => ({ ...c, running: true, live: optimistic }))
      try {
        await api.submitMessage(sessionId, text)
        return true
      } catch (error) {
        if (before && !before.running) updateConversation(sessionId, (c) => (c.live === optimistic ? { ...c, running: false, live: null } : c))
        onFailure?.({ kind, error: toApiError(error) })
        return false
      }
    }

    return {
      workspaces: [],
      sessions: [],
      listStatus: 'idle',
      activeSessionId: null,
      draftWorkspaceId: null,
      draftModel: null,
      conversations: {},

      async load() {
        if (get().listStatus === 'idle') set({ listStatus: 'loading' })
        try {
          const [workspaces, sessions] = await Promise.all([api.listWorkspaces(), api.listSessions()])
          set({ workspaces, sessions, listStatus: 'ready' })
        } catch {
          if (get().listStatus !== 'ready') set({ listStatus: 'error' })
          return
        }
        if (loadedOnce) return
        loadedOnce = true
        const { activeSessionId, draftWorkspaceId, sessions, workspaces } = get()
        if (activeSessionId !== null || draftWorkspaceId !== null) return
        const recent = sessions[0]
        if (recent) get().openSession(recent.id)
        else if (workspaces[0]) set({ draftWorkspaceId: workspaces[0].id })
      },

      openSession(sessionId) {
        set({ activeSessionId: sessionId, draftWorkspaceId: null })
        ensureConversation(sessionId)
      },

      startDraft(workspaceId) {
        const state = get()
        const active = state.sessions.find((s) => s.id === state.activeSessionId)
        const target = workspaceId ?? state.draftWorkspaceId ?? active?.workspaceId ?? state.workspaces[0]?.id ?? null
        set({ activeSessionId: null, draftWorkspaceId: target })
      },

      async addWorkspace(pickDirectory) {
        const path = await pickDirectory()
        if (path === null) return
        try {
          const workspace = await api.registerWorkspace(path)
          set((state) => ({
            workspaces: state.workspaces.some((w) => w.id === workspace.id) ? state.workspaces : [...state.workspaces, workspace],
            activeSessionId: null,
            draftWorkspaceId: workspace.id,
          }))
        } catch (error) {
          onFailure?.({ kind: 'workspace', error: toApiError(error) })
        }
      },

      async send(text) {
        const { activeSessionId, draftWorkspaceId, draftModel } = get()
        if (activeSessionId !== null) return submit(activeSessionId, text, 'send')
        if (draftWorkspaceId === null) return false
        let session: Session
        try {
          session = await api.createSession({ workspaceId: draftWorkspaceId, title: titleFromText(text), ...(draftModel ? { model: draftModel } : {}) })
        } catch (error) {
          onFailure?.({ kind: 'send', error: toApiError(error) })
          return false
        }
        set((state) => ({ sessions: [session, ...state.sessions.filter((s) => s.id !== session.id)] }))
        // 用户在等待期间切换到别处时不抢焦点。
        if (get().draftWorkspaceId === draftWorkspaceId && get().activeSessionId === null) set({ activeSessionId: session.id, draftWorkspaceId: null })
        // 先确认订阅再提交，使首个 Run 的进度不丢。
        set((state) => ({
          conversations: { ...state.conversations, [session.id]: { status: 'loading', entries: [], lastSeq: 0, running: false, live: null } },
        }))
        await subscribe(session.id)
        return submit(session.id, text, 'send')
      },

      async stop() {
        const sessionId = get().activeSessionId
        if (sessionId === null) return
        try {
          await api.abortRun(sessionId)
        } catch (error) {
          onFailure?.({ kind: 'stop', error: toApiError(error) })
        }
      },

      async retry(text) {
        const sessionId = get().activeSessionId
        if (sessionId === null) return false
        return submit(sessionId, text, 'retry')
      },

      async selectModel(model) {
        const sessionId = get().activeSessionId
        if (sessionId === null) {
          set({ draftModel: model })
          return
        }
        try {
          const updated = await api.setSessionModel(sessionId, model)
          set((state) => ({ sessions: state.sessions.map((s) => (s.id === updated.id ? { ...s, model: updated.model } : s)) }))
        } catch (error) {
          onFailure?.({ kind: 'model', error: toApiError(error) })
        }
      },
    }
  })

  const apply = (message: ServerMessage) => {
    const state = store.getState()
    const patchConversation = (sessionId: string, update: (c: Conversation) => Conversation) => {
      const current = store.getState().conversations[sessionId]
      if (current) store.setState({ conversations: { ...store.getState().conversations, [sessionId]: update(current) } })
    }
    const patchSession = (sessionId: string, patch: Partial<Session>) =>
      store.setState({ sessions: store.getState().sessions.map((s) => (s.id === sessionId ? { ...s, ...patch } : s)) })

    switch (message.type) {
      case 'subscribed': {
        patchConversation(message.sessionId, (c) => ({
          ...c,
          status: 'ready',
          running: message.running,
          live: message.running ? (c.live ?? emptyLive(null, false)) : null,
        }))
        patchSession(message.sessionId, { running: message.running })
        for (const finish of subscribed.get(message.sessionId) ?? []) finish()
        return
      }
      case 'entry': {
        const { entry } = message
        patchConversation(message.sessionId, (c) => {
          if (entry.seq <= c.lastSeq) return c
          const entries = [...c.entries, entry]
          if (entry.kind === 'run_end') return { ...c, entries, lastSeq: entry.seq, running: false, live: null }
          const role = (entry.payload as { role?: unknown } | null)?.role
          // assistant 消息已提交：其增量不再需要，下一条消息的增量从空开始接收。
          const live = role === 'assistant' && c.live ? { ...c.live, accepting: true, blocks: [], retry: undefined } : c.live
          return { ...c, entries, lastSeq: entry.seq, live }
        })
        patchSession(message.sessionId, {
          updatedAt: entry.createdAt,
          ...(entry.kind === 'run_end' ? { running: false } : {}),
        })
        return
      }
      case 'progress': {
        if (!state.conversations[message.sessionId]) return
        patchConversation(message.sessionId, (c) => ({ ...c, running: true, live: reduceProgress(c.live, message.runId, message.event) }))
        if (message.event.type === 'run_start') patchSession(message.sessionId, { running: true })
        return
      }
      case 'error': {
        if (message.sessionId === undefined) return
        patchConversation(message.sessionId, (c) => (c.status === 'loading' ? { ...c, status: 'error' } : c))
        for (const finish of subscribed.get(message.sessionId) ?? []) finish()
        return
      }
    }
  }

  stream.onMessage(apply)
  stream.onOpen((reconnected) => {
    // 打开过的会话重新订阅：服务端只补发 lastSeq 之后的条目；中断期间的增量已丢失，暂停接收直到下一条 assistant 条目。
    const conversations = store.getState().conversations
    for (const [sessionId, conversation] of Object.entries(conversations)) {
      if (reconnected && conversation.live) {
        store.setState({
          conversations: { ...store.getState().conversations, [sessionId]: { ...conversation, live: { ...conversation.live, accepting: false, blocks: [] } } },
        })
      }
      stream.send({ type: 'subscribe', sessionId, afterSeq: conversation.lastSeq })
    }
    void store.getState().load()
  })

  return store
}

export function reduceProgress(live: LiveRun | null, runId: string, event: ProgressEvent): LiveRun {
  if (event.type === 'run_start') return emptyLive(runId, true)
  const current = live ?? emptyLive(runId, false)
  switch (event.type) {
    case 'assistant_delta': {
      if (!current.accepting || event.kind === 'toolcall') return current
      const blocks = [...current.blocks]
      const existing = blocks[event.contentIndex]
      blocks[event.contentIndex] = { kind: event.kind, text: (existing?.kind === event.kind ? existing.text : '') + event.delta }
      return { ...current, blocks, retry: undefined }
    }
    case 'tool_start':
      return {
        ...current,
        tools: { ...current.tools, [event.toolCallId]: { toolCallId: event.toolCallId, toolName: event.toolName, args: event.args, status: 'running' } },
      }
    case 'tool_update': {
      const tool = current.tools[event.toolCallId] ?? { toolCallId: event.toolCallId, toolName: event.toolName, args: undefined, status: 'running' as const }
      return { ...current, tools: { ...current.tools, [event.toolCallId]: { ...tool, partialResult: event.partialResult } } }
    }
    case 'tool_end': {
      const tool = current.tools[event.toolCallId] ?? { toolCallId: event.toolCallId, toolName: event.toolName, args: undefined, status: 'running' as const }
      return { ...current, tools: { ...current.tools, [event.toolCallId]: { ...tool, status: event.isError ? 'error' : 'done', result: event.result } } }
    }
    case 'retry':
      return { ...current, retry: { attempt: event.attempt, maxRetries: event.maxRetries } }
  }
}
