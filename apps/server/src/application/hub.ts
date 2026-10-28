import type { ProgressEvent, ServerMessage, SessionEntryRecord } from '@coko/protocol'

type Listener = (message: ServerMessage) => void

/** 按 Session 分发已提交的 entry 与临时 progress。entry 只在提交完成后发布。 */
export class SessionHub {
  readonly #listeners = new Map<string, Set<Listener>>()

  subscribe(sessionId: string, listener: Listener): () => void {
    let set = this.#listeners.get(sessionId)
    if (!set) this.#listeners.set(sessionId, (set = new Set()))
    set.add(listener)
    return () => {
      set.delete(listener)
      if (set.size === 0) this.#listeners.delete(sessionId)
    }
  }

  publishEntry(entry: SessionEntryRecord): void {
    this.#emit(entry.sessionId, { type: 'entry', sessionId: entry.sessionId, entry })
  }

  publishProgress(sessionId: string, runId: string, event: ProgressEvent): void {
    this.#emit(sessionId, { type: 'progress', sessionId, runId, event })
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
