import { API_ROUTES, HealthResponse, ServerMessage, type ClientMessage } from '@coko/protocol'
import { Value } from 'typebox/value'
import type { CokoBridge } from '../../shared/bridge.ts'

/**
 * 连接阶段。failed 的 code 为 sidecar / main 给出的错误码，或 renderer 自身的
 * no-bridge、health、ws-timeout、renderer；detail 是技术详情原文（不翻译）。
 */
export type ConnectionState =
  | { readonly phase: 'connecting' }
  | { readonly phase: 'connected' }
  | { readonly phase: 'disconnected' }
  | { readonly phase: 'failed'; readonly code: string; readonly message: string }

export type ConnectionPhase = ConnectionState['phase']

/** renderer 自己判定的失败；界面说明来自字典，message 只作技术详情。 */
export const RENDERER_FAILURE_CODES = ['no-bridge', 'health', 'ws-timeout', 'renderer'] as const

/** WebSocket 消息通道：连接打开期间发送；每次（重新）打开后通知订阅方重新订阅。 */
export interface StreamClient {
  send(message: ClientMessage): boolean
  onOpen(listener: (reconnected: boolean) => void): () => void
  onMessage(listener: (message: ServerMessage) => void): () => void
}

export interface ConnectOptions {
  bridge: CokoBridge | undefined
  onState: (state: ConnectionState) => void
  /** 首次打开超时；默认 10 秒。 */
  openTimeoutMs?: number
  /** 断线后的重连间隔（毫秒），用尽后保持最后一档。 */
  backoffMs?: readonly number[]
}

const DEFAULT_BACKOFF = [500, 1000, 2000, 5000] as const

/**
 * boot → 经 coko-app:// 代理请求 health → 建立 WebSocket。连接意外关闭后按退避重连，重新打开时通知订阅方
 * 以 afterSeq 补齐。boot 完成后把平台写到 document 的 data-platform（标题栏安全区按平台生效）。
 */
export function connect({ bridge, onState, openTimeoutMs = 10_000, backoffMs = DEFAULT_BACKOFF }: ConnectOptions): StreamClient & { dispose(): void } {
  let disposed = false
  let socket: WebSocket | undefined
  let everOpened = false
  let attempt = 0
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  const openListeners = new Set<(reconnected: boolean) => void>()
  const messageListeners = new Set<(message: ServerMessage) => void>()
  const emit = (state: ConnectionState) => {
    if (!disposed) onState(state)
  }
  const fail = (code: string, message: string) => emit({ phase: 'failed', code, message })

  const open = (url: string) => {
    if (disposed) return
    const ws = new WebSocket(url)
    socket = ws
    const timer = everOpened
      ? undefined
      : setTimeout(() => {
          ws.close()
          fail('ws-timeout', 'WebSocket did not open')
        }, openTimeoutMs)
    let opened = false
    ws.addEventListener('open', () => {
      clearTimeout(timer)
      opened = true
      const reconnected = everOpened
      everOpened = true
      attempt = 0
      emit({ phase: 'connected' })
      for (const listener of openListeners) listener(reconnected)
    })
    ws.addEventListener('message', (event) => {
      let parsed: unknown
      try {
        parsed = JSON.parse(String(event.data))
      } catch {
        return
      }
      if (!Value.Check(ServerMessage, parsed)) return
      for (const listener of messageListeners) listener(parsed)
    })
    ws.addEventListener('close', () => {
      clearTimeout(timer)
      if (disposed || socket !== ws) return
      socket = undefined
      // 从未打开过：首次连接失败，保持 failed（已由超时报告）或报告断开后重试。
      if (!everOpened && !opened) return
      emit({ phase: 'disconnected' })
      const delay = backoffMs[Math.min(attempt, backoffMs.length - 1)] ?? 1000
      attempt++
      retryTimer = setTimeout(() => open(url), delay)
    })
  }

  void (async () => {
    if (bridge === undefined) return fail('no-bridge', 'Desktop bridge is unavailable')
    const boot = await bridge.boot()
    if (boot.ok) document.documentElement.dataset.platform = boot.info.platform
    if (!boot.ok) return fail(boot.error.code, boot.error.message)
    emit({ phase: 'connecting' })
    const response = await fetch(API_ROUTES.health)
    const body: unknown = response.ok ? await response.json() : undefined
    if (!Value.Check(HealthResponse, body)) return fail('health', `Health check failed with status ${response.status}`)
    open(boot.info.wsBaseUrl + API_ROUTES.stream)
  })().catch((error: unknown) => fail('renderer', error instanceof Error ? error.message : String(error)))

  return {
    send(message) {
      if (socket?.readyState !== WebSocket.OPEN) return false
      socket.send(JSON.stringify(message))
      return true
    },
    onOpen(listener) {
      openListeners.add(listener)
      return () => openListeners.delete(listener)
    },
    onMessage(listener) {
      messageListeners.add(listener)
      return () => messageListeners.delete(listener)
    },
    dispose() {
      disposed = true
      clearTimeout(retryTimer)
      socket?.close()
    },
  }
}
