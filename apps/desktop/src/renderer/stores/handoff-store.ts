import { AbortRunResponse, apiPaths, GitStatusResponse, handoffPaths, SubmitMessageResponse, worktreePaths, type HandoffTarget } from '@coko/protocol'
import { createStore, type StoreApi } from 'zustand/vanilla'
import { requestJson, type Fetch } from '../client/api.ts'
import type { ChatActions, ChatState } from './chat-store.ts'
import { writeSessionDraft } from './draft-store.ts'

// 交接的 store（docs/subsystems/handoff.md）：开始交接（POST /api/sessions/:id/handoff）、源会话的 git 状态（未提交改动提示）、进行中的交接
// 与停止。进行中的状态由条目派生：源会话的 trigger handoff 的 run_start 开始，run_end 正常结束后等 handoff 条目，其余结束为停止。
// handoff 条目到达时把摘要写入目标会话的输入区草稿（不提交），用户仍在源会话时切到目标会话；失败的 handoff 条目（摘要之后目标没能创建）
// 使进度变为 failed，带错误码与摘要（对话框显示错误、复制摘要与重试）。只处理订阅完成之后到达的条目：打开会话时补发的历史不触发切换。

export interface HandoffBackend {
  start(sessionId: string, input: { instructions: string; target: HandoffTarget }): Promise<{ runId: string }>
  gitStatus(sessionId: string): Promise<GitStatusResponse>
  stop(sessionId: string): Promise<void>
}

export function httpHandoffBackend(fetchImpl?: Fetch): HandoffBackend {
  return {
    start: (sessionId, input) => requestJson(SubmitMessageResponse, 'POST', handoffPaths.handoff(sessionId), input, fetchImpl),
    gitStatus: (sessionId) => requestJson(GitStatusResponse, 'GET', worktreePaths.sessionGitStatus(sessionId), undefined, fetchImpl),
    stop: async (sessionId) => {
      await requestJson(AbortRunResponse, 'POST', apiPaths.sessionAbort(sessionId), {}, fetchImpl)
    },
  }
}

/** 交接没能创建目标时的错误：code 为协议错误码（缺失时为空串），message 为 Sidecar 给出的原文（诊断用）。 */
export interface HandoffFailure {
  code: string
  message?: string
}

/**
 * 会话的交接进度：summarizing（摘要 Run 进行中）→ creating（Run 正常结束，等目标）；摘要 Run 停止或出错为 stopped；
 * 摘要之后目标没能创建为 failed（summary 为已写好的摘要，可复制）。
 */
export type HandoffProgress =
  | { phase: 'summarizing' | 'creating'; runId: string }
  | { phase: 'stopped'; runId: string }
  | { phase: 'failed'; runId: string; error: HandoffFailure; summary?: string }

/** 失败的 handoff 条目（status: 'failed'）的错误与摘要；成功的条目返回 undefined。字段按形状读取，缺失时取空。 */
export function handoffFailure(payload: unknown): { error: HandoffFailure; summary?: string } | undefined {
  if (!payload || typeof payload !== 'object' || (payload as { status?: unknown }).status !== 'failed') return undefined
  const { error, summary } = payload as { error?: unknown; summary?: unknown }
  const code = error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string' ? (error as { code: string }).code : ''
  const message = error && typeof error === 'object' ? (error as { message?: unknown }).message : undefined
  return {
    error: { code, ...(typeof message === 'string' && message !== '' ? { message } : {}) },
    ...(typeof summary === 'string' && summary !== '' ? { summary } : {}),
  }
}

export interface HandoffState {
  /** 按源会话。完成（切到目标）后删除。 */
  progress: Record<string, HandoffProgress>
  /** 源会话的 git 状态；读取失败时 null。 */
  gitStatus: Record<string, GitStatusResponse | null>
}

export interface HandoffActions {
  /** 开始交接；失败时抛 ApiError（调用方本地化提示）。 */
  start(sessionId: string, input: { instructions: string; target: HandoffTarget }): Promise<void>
  /** 停止进行中的摘要 Run（Sidecar 停止后不创建目标）。 */
  stop(sessionId: string): Promise<void>
  loadGitStatus(sessionId: string): Promise<void>
  /** 清除已停止或失败的提示。 */
  dismiss(sessionId: string): void
  /** 接到对话 store：按条目推进交接并在完成时切到目标会话。返回取消订阅。 */
  attach(chat: StoreApi<ChatState & ChatActions>): () => void
}

export type HandoffStore = StoreApi<HandoffState & HandoffActions>

export interface HandoffStoreOptions {
  backend?: HandoffBackend
  /** 写入目标会话草稿（测试注入）；缺省为应用内的草稿存储。 */
  writeDraft?: (sessionId: string, text: string) => void
  /** 交接完成的处理结束之后（草稿已写、会话列表已读取、已决定是否切换）调用；测试据此等待。 */
  onFinished?: (result: { sourceId: string; targetSessionId: string; switched: boolean }) => void
}

export function createHandoffStore({ backend = httpHandoffBackend(), writeDraft = writeSessionDraft, onFinished }: HandoffStoreOptions = {}): HandoffStore {
  /** 每个会话已处理到的 seq；第一次见到已就绪的会话时从它当时的末尾开始（不处理历史）。 */
  const seen = new Map<string, number>()
  /** 已结束（或已完成交接）的摘要 Run：start 的响应晚于它们的条目到达时不再记为进行中。 */
  const ended = new Set<string>()
  let attached: { chat: StoreApi<ChatState & ChatActions>; count: number; off: () => void } | undefined
  return createStore<HandoffState & HandoffActions>()((set, get) => {
    const setProgress = (sessionId: string, progress: HandoffProgress | undefined) =>
      set((s) => {
        const { [sessionId]: _old, ...rest } = s.progress
        return { progress: progress ? { ...s.progress, [sessionId]: progress } : rest }
      })

    const finish = async (chat: StoreApi<ChatState & ChatActions>, sourceId: string, targetSessionId: string, summary: string) => {
      setProgress(sourceId, undefined)
      writeDraft(targetSessionId, summary)
      await chat.getState().load()
      const switched = chat.getState().activeSessionId === sourceId
      if (switched) chat.getState().openSession(targetSessionId)
      onFinished?.({ sourceId, targetSessionId, switched })
    }

    const observe = (chat: StoreApi<ChatState & ChatActions>) => {
      const { conversations } = chat.getState()
      for (const [sessionId, conversation] of Object.entries(conversations)) {
        if (conversation.status !== 'ready') continue
        const last = seen.get(sessionId)
        if (last === undefined) {
          seen.set(sessionId, conversation.lastSeq)
          continue
        }
        if (conversation.lastSeq <= last) continue
        seen.set(sessionId, conversation.lastSeq)
        for (const entry of conversation.entries) {
          if (entry.seq <= last) continue
          const current = get().progress[sessionId]
          if (entry.kind === 'run_start' && entry.payload.trigger === 'handoff' && entry.runId) {
            setProgress(sessionId, { phase: 'summarizing', runId: entry.runId })
          } else if (entry.kind === 'run_end' && current && current.runId === entry.runId) {
            ended.add(current.runId)
            setProgress(
              sessionId,
              entry.payload.status === 'completed' ? { phase: 'creating', runId: current.runId } : { phase: 'stopped', runId: current.runId },
            )
          } else if (entry.kind === 'handoff') {
            if (entry.runId) ended.add(entry.runId)
            const failure = handoffFailure(entry.payload)
            if (failure) setProgress(sessionId, { phase: 'failed', runId: entry.runId ?? current?.runId ?? '', ...failure })
            else void finish(chat, sessionId, entry.payload.targetSessionId, entry.payload.summary)
          }
        }
      }
    }

    return {
      progress: {},
      gitStatus: {},
      async start(sessionId, input) {
        const { runId } = await backend.start(sessionId, input)
        // run_start 条目通常随后到达；先记下，使对话框立即显示进行中。
        if (!ended.has(runId) && get().progress[sessionId]?.runId !== runId) setProgress(sessionId, { phase: 'summarizing', runId })
      },
      async stop(sessionId) {
        await backend.stop(sessionId)
      },
      async loadGitStatus(sessionId) {
        try {
          const status = await backend.gitStatus(sessionId)
          set((s) => ({ gitStatus: { ...s.gitStatus, [sessionId]: status } }))
        } catch {
          set((s) => ({ gitStatus: { ...s.gitStatus, [sessionId]: null } }))
        }
      },
      dismiss(sessionId) {
        const phase = get().progress[sessionId]?.phase
        if (phase === 'stopped' || phase === 'failed') setProgress(sessionId, undefined)
      },
      attach(chat) {
        // 多个按钮挂载时共用一次订阅（同一个对话 store）。
        if (attached && attached.chat === chat) attached.count++
        else {
          attached?.off()
          observe(chat)
          attached = { chat, count: 1, off: chat.subscribe(() => observe(chat)) }
        }
        let released = false
        return () => {
          if (released || !attached || attached.chat !== chat) return
          released = true
          if (--attached.count === 0) {
            attached.off()
            attached = undefined
          }
        }
      },
    }
  })
}

/** 应用内共用的 store（组件经 context 取用，测试可换成自己的）。 */
export const handoffStore = createHandoffStore()
