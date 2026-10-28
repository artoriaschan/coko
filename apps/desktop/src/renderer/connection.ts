import { API_ROUTES, HealthResponse } from '@coko/protocol'
import { Value } from 'typebox/value'
import type { CokoBridge } from '../shared/bridge.ts'

export type ConnectionState =
  | { readonly phase: 'connecting'; readonly locale: string }
  | { readonly phase: 'connected'; readonly locale: string }
  | { readonly phase: 'disconnected'; readonly locale: string }
  | { readonly phase: 'failed'; readonly locale: string; readonly code: string; readonly message: string }

const WS_OPEN_TIMEOUT_MS = 10_000

/**
 * boot → 经 coko-app:// 代理请求 health → 建立 WebSocket。连接保持打开，关闭时报告 disconnected。
 * @returns 停止并关闭 WebSocket
 */
export function connect(bridge: CokoBridge | undefined, fallbackLocale: string, onState: (state: ConnectionState) => void): () => void {
  let disposed = false
  let socket: WebSocket | undefined
  let locale = fallbackLocale
  const emit = (state: ConnectionState) => {
    if (!disposed) onState(state)
  }
  const fail = (code: string, message: string) => emit({ phase: 'failed', locale, code, message })

  void (async () => {
    if (bridge === undefined) return fail('no-bridge', 'Desktop bridge is unavailable')
    const boot = await bridge.boot()
    if (!boot.ok) return fail(boot.error.code, boot.error.message)
    locale = boot.info.locale
    emit({ phase: 'connecting', locale })
    const response = await fetch(API_ROUTES.health)
    const body: unknown = response.ok ? await response.json() : undefined
    if (!Value.Check(HealthResponse, body)) return fail('health', `Health check failed with status ${response.status}`)
    if (disposed) return
    socket = new WebSocket(boot.info.wsBaseUrl + API_ROUTES.stream)
    const ws = socket
    const timer = setTimeout(() => {
      ws.close()
      fail('ws-timeout', 'WebSocket did not open')
    }, WS_OPEN_TIMEOUT_MS)
    ws.addEventListener('open', () => {
      clearTimeout(timer)
      emit({ phase: 'connected', locale })
    })
    ws.addEventListener('close', () => {
      clearTimeout(timer)
      emit({ phase: 'disconnected', locale })
    })
  })().catch((error: unknown) => fail('renderer', error instanceof Error ? error.message : String(error)))

  return () => {
    disposed = true
    socket?.close()
  }
}
