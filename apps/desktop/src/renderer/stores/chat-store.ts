import {
  SessionEntry,
  type AnswerApprovalRequest,
  type ConfirmationAnswer,
  type PermissionMode,
  type PermissionRule,
  type ProgressEvent,
  type RewindMode,
  type RewindResponse,
  type RunStatus,
  type ServerMessage,
  type Session,
  type SessionActivity,
  type SessionEntryOf,
  type SessionModel,
  type Workspace,
} from '@coko/protocol'
import { Value } from 'typebox/value'
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

/** 只由 run_end progress 得知的 Run 结束（run_end 条目提交失败）；之后到达的条目会覆盖它。 */
export interface UnrecordedRunEnd {
  runId: string
  status: RunStatus
  error?: { code: string; message: string }
}

export interface Conversation {
  status: 'loading' | 'ready' | 'error'
  /** 已通过 SessionEntry schema 校验的条目；不合格的条目在接收时跳过（lastSeq 仍越过它）。 */
  entries: SessionEntry[]
  lastSeq: number
  running: boolean
  live: LiveRun | null
  unrecordedEnd?: UnrecordedRunEnd
  /** 已发出、尚未由 permission_mode 条目确认的模式（乐观显示）。 */
  pendingMode?: PermissionMode
  /** 本窗口发出、尚未送达的追加指令（按发送顺序）；送达后由 user 条目替代。 */
  steering?: string[]
  /** 已请求暂停，等待本 Run 结束。 */
  pausing?: boolean
  /** Run 结束时退回输入区的未送达追加指令；输入区取走后清除。 */
  returnedDraft?: string
}

export type ChatFailure = {
  kind: 'send' | 'stop' | 'retry' | 'workspace' | 'model' | 'approval' | 'permissions' | 'steer' | 'pause' | 'continue' | 'confirmation' | 'rewind' | 'fork'
  error: ApiError
}

/** 被回退的区间 [targetSeq, rewind 条目)（ADR 0006）；按 rewind 条目顺序。 */
export function rewoundRanges(entries: readonly SessionEntry[]): { from: number; to: number }[] {
  return entries.flatMap((entry) => (entry.kind === 'rewind' ? [{ from: entry.payload.targetSeq, to: entry.seq }] : []))
}

/** 有效条目：不在任何被回退区间内、且不是 rewind 条目本身（与 Sidecar 的模型上下文一致）。 */
export function visibleEntries(entries: readonly SessionEntry[]): SessionEntry[] {
  const ranges = rewoundRanges(entries)
  if (ranges.length === 0) return entries as SessionEntry[]
  return entries.filter((entry) => entry.kind !== 'rewind' && !ranges.some((r) => entry.seq >= r.from && entry.seq < r.to))
}

/** 有效条目中最后一个已结束 Run 的状态（被回退的 Run 不算）；没有时为 undefined。 */
export function lastRunStatus(all: readonly SessionEntry[]): RunStatus | undefined {
  const entries = visibleEntries(all)
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]!
    if (entry.kind === 'run_end') return entry.payload.status
  }
  return undefined
}

/** Session 的当前模式：最后一条 permission_mode 条目；没有时为 default（旧 Session）。 */
export function sessionPermissionMode(entries: readonly SessionEntry[]): PermissionMode {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]!
    if (entry.kind === 'permission_mode') return entry.payload.mode
  }
  return 'default'
}

const sameRule = (a: PermissionRule, b: PermissionRule) => a.behavior === b.behavior && a.tool === b.tool && a.content === b.content

/** Session 规则：按 permission_rule 条目回放。 */
export function sessionRules(entries: readonly SessionEntry[]): PermissionRule[] {
  let rules: PermissionRule[] = []
  for (const entry of entries) {
    if (entry.kind !== 'permission_rule') continue
    const { op, rule } = entry.payload
    rules = op === 'add' ? [...rules.filter((r) => !sameRule(r, rule)), rule] : rules.filter((r) => !sameRule(r, rule))
  }
  return rules
}

/**
 * 仍在等待回答的审批请求（按提出顺序）：有 approval_request、没有对应的 approval_decision，且所属 Run 尚未结束。
 * 断线重连后由补发的条目重建。
 */
export function pendingApprovals(entries: readonly SessionEntry[]): SessionEntryOf<'approval_request'>[] {
  const decided = new Set<string>()
  const ended = new Set<string>()
  for (const entry of entries) {
    if (entry.kind === 'approval_decision') decided.add(entry.payload.requestId)
    else if (entry.kind === 'run_end' && entry.runId) ended.add(entry.runId)
  }
  return entries.filter(
    (entry): entry is SessionEntryOf<'approval_request'> =>
      entry.kind === 'approval_request' && !decided.has(entry.payload.requestId) && !(entry.runId !== null && ended.has(entry.runId)),
  )
}

/** 恢复时结果不明、等待用户确认的调用（按请求顺序），带 assistant 消息中的工具名与参数。 */
export interface PendingConfirmation {
  toolCallId: string
  toolName: string | undefined
  arguments: unknown
}

export function pendingConfirmations(entries: readonly SessionEntry[]): PendingConfirmation[] {
  const asked = new Set<string>()
  const calls = new Map<string, { name: string; arguments: unknown }>()
  for (const entry of entries) {
    if (entry.kind === 'confirmation_request') asked.add(entry.payload.toolCallId)
    else if (entry.kind === 'confirmation_answer') asked.delete(entry.payload.toolCallId)
    else if (entry.kind === 'message' && entry.payload.role === 'assistant') {
      for (const block of entry.payload.content as { type: string; id?: unknown; name?: unknown; arguments?: unknown }[]) {
        if (block.type === 'toolCall' && typeof block.id === 'string') calls.set(block.id, { name: String(block.name), arguments: block.arguments })
      }
    }
  }
  return [...asked].map((toolCallId) => ({ toolCallId, toolName: calls.get(toolCallId)?.name, arguments: calls.get(toolCallId)?.arguments }))
}

/** 已打开会话的运行状态（由条目与订阅状态派生）。 */
export function conversationActivity(conversation: Pick<Conversation, 'entries' | 'running'>): SessionActivity {
  if (!conversation.running) {
    if (pendingConfirmations(conversation.entries).length > 0) return 'awaiting-confirmation'
    const last = lastRunStatus(conversation.entries)
    return last === 'paused' || last === 'interrupted' ? last : 'idle'
  }
  return pendingApprovals(conversation.entries).length > 0 ? 'awaiting-approval' : 'running'
}

/**
 * 横幅的"继续"是否可用：上一 Run 为 paused / interrupted、没有待确认，且模型可以从最后一条消息接着做（用户消息或工具结果；
 * 以 assistant 文本结束时没有可继续的内容，与运行时的 continue() 判定一致）。
 */
export function canContinue(conversation: Pick<Conversation, 'entries' | 'running'>): boolean {
  const activity = conversationActivity(conversation)
  if (activity !== 'paused' && activity !== 'interrupted') return false
  const entries = visibleEntries(conversation.entries)
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]!
    if (entry.kind === 'message') return entry.payload.role === 'user' || entry.payload.role === 'toolResult'
  }
  return false
}

/**
 * 横幅"继续"的方式：resume 调用 continue（模型从用户消息或工具结果接着做）；prompt 在最后一条是 assistant 文本时提交一条新的
 * 用户消息（运行时的 continue 不能从 assistant 消息开始）。不能继续时为 undefined（不是 paused / interrupted，或有待确认）。
 */
export function continueMode(conversation: Pick<Conversation, 'entries' | 'running'>): 'resume' | 'prompt' | undefined {
  const activity = conversationActivity(conversation)
  if (activity !== 'paused' && activity !== 'interrupted') return undefined
  return canContinue(conversation) ? 'resume' : 'prompt'
}

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
  /** 草稿中选择的 Permission Mode；null 表示用设置中的默认模式。 */
  draftPermissionMode: PermissionMode | null
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
  /** 重新执行当前会话出错的上一轮（不追加用户消息）。 */
  retry(): Promise<boolean>
  /** Run 进行中发送追加指令；先显示为待送达。返回是否被接受（失败时保留输入）。 */
  steer(text: string): Promise<boolean>
  /** 暂停当前会话的 Run（当前步骤完成后停下）。 */
  pause(): Promise<void>
  /**
   * 接着暂停或中断的上一 Run。continueMode 为 prompt 时提交 promptText（界面传入本地化的"继续"）作为新的用户消息。
   */
  continueRun(promptText?: string): Promise<boolean>
  /** 输入区取走退回的未送达追加指令。 */
  takeReturnedDraft(sessionId: string): void
  /** 当前会话经协议切换模型；草稿中只记下选择。 */
  selectModel(model: SessionModel): Promise<void>
  /**
   * 回答当前会话的待审批请求。同一请求只发送一次：发送中或已成功的重复调用直接返回 true；失败时可再次回答。
   * 返回是否已被接受。
   */
  answerApproval(requestId: string, answer: AnswerApprovalRequest): Promise<boolean>
  /**
   * 回答当前会话中结果不明的调用。同一调用只发送一次：发送中或已成功的重复调用直接返回 true；失败时可再次回答，
   * 已不在等待（not-found）时不再重发。返回是否已被接受。
   */
  answerConfirmation(toolCallId: string, answer: ConfirmationAnswer): Promise<boolean>
  /** 当前会话经协议切换 Permission Mode（立即显示，失败时撤回）；草稿中只记下选择。 */
  setPermissionMode(mode: PermissionMode): Promise<void>
  /** 删除当前会话的一条 Session 规则。 */
  removeSessionRule(rule: PermissionRule): Promise<boolean>
  /** 回退当前会话的预览（dryRun）：将恢复、删除、Agent 之外改过与未追踪的文件。失败时报告并返回 undefined。 */
  previewRewind(targetSeq: number, mode: RewindMode): Promise<RewindResponse | undefined>
  /** 回退当前会话；回退对话（或两者）时目标消息的文本回到输入区。失败时报告并返回 undefined。 */
  rewind(targetSeq: number, mode: RewindMode): Promise<RewindResponse | undefined>
  /** 从当前会话的某条用户消息分叉：打开新会话，目标文本放入其输入区。返回是否成功。 */
  fork(targetSeq: number): Promise<boolean>
}

export type ChatStore = StoreApi<ChatState & ChatActions>

export interface ChatStoreOptions {
  api: ApiClient
  stream: StreamClient
  /** 操作失败（界面层负责本地化提示）。 */
  onFailure?: (failure: ChatFailure) => void
  /** 等待订阅确认的上限；超时后照常继续，条目会在补齐时到达。 */
  subscribeTimeoutMs?: number
  /** 分叉出的新会话的标题（界面按当前语言生成，原标题为空时由它决定显示）；省略时 Sidecar 沿用原标题。 */
  forkTitle?: (sourceTitle: string) => string
}

const emptyLive = (runId: string | null, accepting: boolean): LiveRun => ({ runId, accepting, blocks: [], tools: {} })

/** 消息内容的文本（字符串或 text 块）。 */
const contentText = (content: unknown): string =>
  typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.map((block: { type?: unknown; text?: unknown }) => (block?.type === 'text' && typeof block.text === 'string' ? block.text : '')).join('\n')
      : ''

/**
 * Run 结束：本窗口仍待送达的追加指令退回输入区（与 run_end.undeliveredSteering 一致；只退回本窗口发出的，
 * 其他窗口或历史记录中的不退回），暂停请求结束。
 */
function endRun(c: Conversation): Conversation {
  const { steering, pausing: _pausing, ...rest } = c
  if (!steering?.length) return { ...rest, pausing: false }
  const returned = steering.join('\n')
  return { ...rest, pausing: false, returnedDraft: c.returnedDraft ? c.returnedDraft + '\n' + returned : returned }
}

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
export function createChatStore({ api, stream, onFailure, subscribeTimeoutMs = 10_000, forkTitle }: ChatStoreOptions): ChatStore {
  const subscribed = new Map<string, Set<() => void>>()
  /** 已发出或已被接受的审批回答（requestId 唯一）。 */
  const answering = new Set<string>()
  /** 已发出或已被接受的结果确认（按 Session 与 toolCallId）。 */
  const confirming = new Map<string, Promise<boolean>>()
  /** 每个 Session 的模式切换按调用顺序发送（Shift+Tab 连按时最后一次为准）。 */
  const modeChains = new Map<string, Promise<unknown>>()
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
    const submit = async (sessionId: string, request: () => Promise<unknown>, kind: ChatFailure['kind']): Promise<boolean> => {
      const before = get().conversations[sessionId]
      const optimistic = before?.running ? before.live : emptyLive(null, true)
      if (before && !before.running) updateConversation(sessionId, (c) => ({ ...c, running: true, live: optimistic }))
      try {
        await request()
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
      draftPermissionMode: null,
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
        const { activeSessionId, draftWorkspaceId, draftModel, draftPermissionMode } = get()
        if (activeSessionId !== null) return submit(activeSessionId, () => api.submitMessage(activeSessionId, text), 'send')
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
        // 草稿中选过模式：新 Session 以默认模式创建，提交前切换（两条 permission_mode 条目）。
        if (draftPermissionMode !== null) {
          set({ draftPermissionMode: null })
          try {
            await api.setPermissionMode(session.id, draftPermissionMode)
          } catch (error) {
            onFailure?.({ kind: 'permissions', error: toApiError(error) })
            return false
          }
        }
        return submit(session.id, () => api.submitMessage(session.id, text), 'send')
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

      async retry() {
        const sessionId = get().activeSessionId
        if (sessionId === null) return false
        return submit(sessionId, () => api.retryRun(sessionId), 'retry')
      },

      async steer(text) {
        const sessionId = get().activeSessionId
        if (sessionId === null) return false
        updateConversation(sessionId, (c) => ({ ...c, steering: [...(c.steering ?? []), text] }))
        try {
          await api.steerRun(sessionId, text)
          return true
        } catch (error) {
          // 只撤回本次的一条（同文本的其他追加指令保留）。
          updateConversation(sessionId, (c) => {
            const steering = [...(c.steering ?? [])]
            const at = steering.lastIndexOf(text)
            if (at >= 0) steering.splice(at, 1)
            return { ...c, steering }
          })
          onFailure?.({ kind: 'steer', error: toApiError(error) })
          return false
        }
      },

      async pause() {
        const sessionId = get().activeSessionId
        if (sessionId === null) return
        updateConversation(sessionId, (c) => (c.running ? { ...c, pausing: true } : c))
        try {
          await api.pauseRun(sessionId)
        } catch (error) {
          updateConversation(sessionId, (c) => ({ ...c, pausing: false }))
          onFailure?.({ kind: 'pause', error: toApiError(error) })
        }
      },

      async continueRun(promptText) {
        const sessionId = get().activeSessionId
        if (sessionId === null) return false
        const conversation = get().conversations[sessionId]
        if (conversation && continueMode(conversation) === 'prompt' && promptText !== undefined)
          return submit(sessionId, () => api.submitMessage(sessionId, promptText), 'continue')
        return submit(sessionId, () => api.continueRun(sessionId), 'continue')
      },

      takeReturnedDraft(sessionId) {
        updateConversation(sessionId, (c) => (c.returnedDraft === undefined ? c : { ...c, returnedDraft: undefined }))
      },

      async answerApproval(requestId, answer) {
        const sessionId = get().activeSessionId
        if (sessionId === null) return false
        if (answering.has(requestId)) return true
        answering.add(requestId)
        try {
          await api.answerApproval(sessionId, requestId, answer)
          return true
        } catch (error) {
          const failure = toApiError(error)
          // 请求已经结束（例如另一处已回答）：不再允许重答，等决定条目到达。
          if (failure.code !== 'approval-not-pending') answering.delete(requestId)
          onFailure?.({ kind: 'approval', error: failure })
          return false
        }
      },

      answerConfirmation(toolCallId, answer) {
        const sessionId = get().activeSessionId
        if (sessionId === null) return Promise.resolve(false)
        const key = `${sessionId}:${toolCallId}`
        const inflight = confirming.get(key)
        if (inflight) return inflight.then((accepted) => accepted || confirming.get(key) !== undefined)
        const sent = api.answerConfirmation(sessionId, toolCallId, answer).then(
          () => true,
          (error: unknown) => {
            const failure = toApiError(error)
            // 已不在等待（另一处已回答）：不再允许重发，等条目到达。
            if (failure.code !== 'not-found') confirming.delete(key)
            onFailure?.({ kind: 'confirmation', error: failure })
            return false
          },
        )
        confirming.set(key, sent)
        return sent
      },

      setPermissionMode(mode) {
        const sessionId = get().activeSessionId
        if (sessionId === null) {
          set({ draftPermissionMode: mode })
          return Promise.resolve()
        }
        const current = get().conversations[sessionId]
        if (current && (current.pendingMode ?? sessionPermissionMode(current.entries)) === mode) return Promise.resolve()
        updateConversation(sessionId, (c) => ({ ...c, pendingMode: mode }))
        const send = async () => {
          try {
            await api.setPermissionMode(sessionId, mode)
            // 条目可能先于响应到达，也可能没有条目（与当时模式相同）：此时按条目即可。
            updateConversation(sessionId, (c) => (c.pendingMode === mode && sessionPermissionMode(c.entries) === mode ? { ...c, pendingMode: undefined } : c))
          } catch (error) {
            // 只撤回仍是本次的乐观状态（之后的切换会覆盖它）。
            updateConversation(sessionId, (c) => (c.pendingMode === mode ? { ...c, pendingMode: undefined } : c))
            onFailure?.({ kind: 'permissions', error: toApiError(error) })
          }
        }
        const next = (modeChains.get(sessionId) ?? Promise.resolve()).then(send)
        modeChains.set(sessionId, next)
        return next
      },

      async removeSessionRule(rule) {
        const sessionId = get().activeSessionId
        if (sessionId === null) return false
        try {
          await api.removeSessionRule(sessionId, rule)
          return true
        } catch (error) {
          onFailure?.({ kind: 'permissions', error: toApiError(error) })
          return false
        }
      },

      async previewRewind(targetSeq, mode) {
        const sessionId = get().activeSessionId
        if (sessionId === null) return undefined
        try {
          return await api.rewind(sessionId, { targetSeq, mode, dryRun: true })
        } catch (error) {
          onFailure?.({ kind: 'rewind', error: toApiError(error) })
          return undefined
        }
      },

      async rewind(targetSeq, mode) {
        const sessionId = get().activeSessionId
        if (sessionId === null) return undefined
        let result: RewindResponse
        try {
          result = await api.rewind(sessionId, { targetSeq, mode })
        } catch (error) {
          onFailure?.({ kind: 'rewind', error: toApiError(error) })
          return undefined
        }
        // rewind 条目经订阅到达（时间线折叠）；目标消息回到输入区，接在已有草稿之前。
        if (mode !== 'code')
          updateConversation(sessionId, (c) => ({ ...c, returnedDraft: c.returnedDraft ? result.text + '\n' + c.returnedDraft : result.text }))
        return result
      },

      async fork(targetSeq) {
        const sessionId = get().activeSessionId
        if (sessionId === null) return false
        let forked: { sessionId: string; text: string }
        try {
          const source =
            get()
              .sessions.find((s) => s.id === sessionId)
              ?.title.trim() ?? ''
          forked = forkTitle ? await api.fork(sessionId, targetSeq, forkTitle(source)) : await api.fork(sessionId, targetSeq)
        } catch (error) {
          onFailure?.({ kind: 'fork', error: toApiError(error) })
          return false
        }
        // 新会话由列表读回（标题与模型以 Sidecar 为准），之后打开并订阅。
        await get().load()
        get().openSession(forked.sessionId)
        updateConversation(forked.sessionId, (c) => ({ ...c, returnedDraft: forked.text }))
        return true
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
        const subscribedTo = store.getState().conversations[message.sessionId]
        patchSession(message.sessionId, {
          running: message.running,
          ...(subscribedTo ? { activity: conversationActivity(subscribedTo) } : {}),
        })
        for (const finish of subscribed.get(message.sessionId) ?? []) finish()
        return
      }
      case 'entry': {
        const record = message.entry
        // 信任边界：payload 按 kind 的 schema 校验；不合格的条目不渲染，但 lastSeq 越过它，重连时不再补发。
        const entry = Value.Check(SessionEntry, record) ? record : undefined
        patchConversation(message.sessionId, (c) => {
          if (record.seq <= c.lastSeq) return c
          if (!entry) return { ...c, lastSeq: record.seq }
          const entries = [...c.entries, entry]
          if (entry.kind === 'permission_mode' && c.pendingMode === entry.payload.mode) return { ...c, entries, lastSeq: entry.seq, pendingMode: undefined }
          if (entry.kind === 'run_end') return { ...endRun(c), entries, lastSeq: entry.seq, running: false, live: null, unrecordedEnd: undefined }
          // 追加指令送达：同文本的待送达项由这条 user 条目替代。
          if (entry.kind === 'message' && entry.payload.role === 'user' && c.steering?.length) {
            const text = contentText(entry.payload.content)
            const at = c.steering.indexOf(text)
            if (at >= 0) return { ...c, entries, lastSeq: entry.seq, steering: c.steering.filter((_, i) => i !== at) }
          }
          // assistant 消息已提交：其增量不再需要，下一条消息的增量从空开始接收。
          const committedAssistant = entry.kind === 'message' && entry.payload.role === 'assistant'
          const live = committedAssistant && c.live ? { ...c.live, accepting: true, blocks: [], retry: undefined } : c.live
          return { ...c, entries, lastSeq: entry.seq, live }
        })
        const after = store.getState().conversations[message.sessionId]
        patchSession(message.sessionId, {
          updatedAt: record.createdAt,
          ...(entry?.kind === 'run_end' ? { running: false } : {}),
          ...(after ? { activity: conversationActivity(after) } : {}),
        })
        return
      }
      case 'progress': {
        if (!state.conversations[message.sessionId]) return
        const event = message.event
        if (event.type === 'run_end') {
          // run_end 条目通常已先到；没有到（提交失败）时也结束运行中状态，并显示只由进度得知的结束状态。
          patchConversation(message.sessionId, (c) => {
            const recorded = c.entries.some((e) => e.kind === 'run_end' && e.runId === message.runId)
            const unrecordedEnd: UnrecordedRunEnd = { runId: message.runId, status: event.status, ...(event.error ? { error: event.error } : {}) }
            return { ...endRun(c), running: false, live: null, unrecordedEnd: recorded ? undefined : unrecordedEnd }
          })
          const ended = store.getState().conversations[message.sessionId]
          patchSession(message.sessionId, { running: false, activity: ended ? conversationActivity(ended) : 'idle' })
          return
        }
        patchConversation(message.sessionId, (c) => ({
          ...c,
          running: true,
          live: reduceProgress(c.live, message.runId, event),
          ...(event.type === 'run_start' ? { unrecordedEnd: undefined } : {}),
        }))
        if (event.type === 'run_start') patchSession(message.sessionId, { running: true, activity: 'running' })
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

export function reduceProgress(live: LiveRun | null, runId: string, event: Exclude<ProgressEvent, { type: 'run_end' }>): LiveRun {
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
