import type { ProgressEvent, ServerMessage, SessionEntryRecord } from '@coko/protocol'

type Listener = (message: ServerMessage) => void
type ProgressObserver = (sessionId: string, event: ProgressEvent) => void

/**
 * 按 Session 分发已提交的 entry 与临时 progress。entry 只在提交完成后发布。Session 标题与运行状态发给所有连接（broadcast），
 * 运行状态由 SessionService 观察进度后计算。
 */
export class SessionHub {
  readonly #broadcastListeners = new Set<Listener>()
  readonly #listeners = new Map<string, Set<Listener>>()
  readonly #progressObservers = new Set<ProgressObserver>()

  subscribe(sessionId: string, listener: Listener): () => void {
    let set = this.#listeners.get(sessionId)
    if (!set) this.#listeners.set(sessionId, (set = new Set()))
    set.add(listener)
    return () => {
      set.delete(listener)
      if (set.size === 0) this.#listeners.delete(sessionId)
    }
  }

  /** 不需要订阅的消息：session_title 与 session_status。 */
  subscribeBroadcasts(listener: Listener): () => void {
    this.#broadcastListeners.add(listener)
    return () => {
      this.#broadcastListeners.delete(listener)
    }
  }

  publishTitle(sessionId: string, title: string): void {
    // Every connected list must observe title changes, including clients viewing another Session.
    this.#broadcast({ type: 'session_title', sessionId, title })
  }

  /** 根 Session 运行状态的变化（session_status）；去重由调用方负责。 */
  publishStatus(sessionId: string, status: { running: boolean; agentsRunning: boolean }): void {
    this.#broadcast({ type: 'session_status', sessionId, ...status })
  }

  /** 每次 publishProgress 之后（订阅者已收到该进度）同步调用。 */
  observeProgress(observer: ProgressObserver): () => void {
    this.#progressObservers.add(observer)
    return () => {
      this.#progressObservers.delete(observer)
    }
  }

  publishEntry(entry: SessionEntryRecord): void {
    this.#emit(entry.sessionId, { type: 'entry', sessionId: entry.sessionId, entry })
  }

  publishProgress(sessionId: string, runId: string, event: ProgressEvent): void {
    this.#emit(sessionId, { type: 'progress', sessionId, runId, event })
    for (const observer of this.#progressObservers) observer(sessionId, event)
  }

  #broadcast(message: ServerMessage): void {
    for (const listener of this.#broadcastListeners) {
      try {
        listener(message)
      } catch {
        /* A disconnected observer cannot fail a committed broadcast. */
      }
    }
  }

  #emit(sessionId: string, message: ServerMessage): void {
    for (const listener of this.#listeners.get(sessionId) ?? []) {
      try {
        listener(message)
      } catch {
        // 一个连接的发送失败不影响其他订阅者。
      }
    }
  }
}
