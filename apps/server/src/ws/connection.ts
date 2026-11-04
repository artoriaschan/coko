import { Value } from 'typebox/value'
import { ClientMessage, type ServerMessage } from '@coko/protocol'
import type { SessionStore } from '@coko/session'
import type { SessionHub } from '../application/hub.ts'

export interface StreamContext {
  store: SessionStore
  hub: SessionHub
  isRunning(sessionId: string): boolean
}

/**
 * 一个 WebSocket 连接的订阅状态。subscribe 时先挂实时监听并缓冲，再补发 seq > afterSeq 的已提交条目，
 * 最后冲刷缓冲中更新的条目：既不漏也不重复。
 */
export class StreamConnection {
  readonly #offBroadcasts: () => void
  readonly #context: StreamContext
  readonly #send: (message: ServerMessage) => void
  readonly #subscriptions = new Map<string, () => void>()

  constructor(context: StreamContext, send: (message: ServerMessage) => void) {
    this.#context = context
    this.#send = send
    this.#offBroadcasts = context.hub.subscribeBroadcasts(send)
  }

  async receive(data: unknown): Promise<void> {
    let parsed: unknown
    try {
      parsed = typeof data === 'string' ? JSON.parse(data) : undefined
    } catch {
      parsed = undefined
    }
    if (!Value.Check(ClientMessage, parsed)) return this.#send({ type: 'error', code: 'bad-request', message: 'Invalid client message' })
    if (parsed.type === 'unsubscribe') return this.#unsubscribe(parsed.sessionId)
    await this.#subscribe(parsed.sessionId, parsed.afterSeq)
  }

  close(): void {
    this.#offBroadcasts()
    for (const sessionId of this.#subscriptions.keys()) this.#unsubscribe(sessionId)
  }

  #unsubscribe(sessionId: string): void {
    this.#subscriptions.get(sessionId)?.()
    this.#subscriptions.delete(sessionId)
  }

  async #subscribe(sessionId: string, afterSeq: number): Promise<void> {
    this.#unsubscribe(sessionId)
    const { store, hub } = this.#context
    const session = await store.sessions.getSession(sessionId).catch(() => undefined)
    if (!session) return this.#send({ type: 'error', code: 'not-found', message: `Session ${sessionId} not found`, sessionId })

    let lastSeq = afterSeq
    let buffer: ServerMessage[] | undefined = []
    const deliver = (message: ServerMessage) => {
      if (message.type === 'entry') {
        if (message.entry.seq <= lastSeq) return
        lastSeq = message.entry.seq
      }
      this.#send(message)
    }
    const off = hub.subscribe(sessionId, (message) => (buffer ? buffer.push(message) : deliver(message)))
    let active = true
    this.#subscriptions.set(sessionId, () => {
      active = false
      off()
    })

    const backlog = await store.sessions.listEntries(sessionId, { afterSeq })
    if (!active) return
    for (const entry of backlog) deliver({ type: 'entry', sessionId, entry })
    const queued = buffer
    buffer = undefined
    for (const message of queued) deliver(message)
    this.#send({ type: 'subscribed', sessionId, lastSeq, running: this.#context.isRunning(sessionId) })
  }
}
