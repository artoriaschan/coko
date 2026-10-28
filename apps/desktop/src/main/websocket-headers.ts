import { APP_ORIGIN, type SidecarEndpoint } from './app-protocol.ts'

export interface WebSocketUpgrade {
  readonly mainWebContentsId: number | undefined
  /** 发起请求的 webContents；Electron 对部分请求不提供。 */
  readonly webContentsId: number | undefined
  readonly url: string
  readonly requestHeaders: Readonly<Record<string, string>>
  readonly endpoint: SidecarEndpoint | undefined
}

/** onBeforeSendHeaders 的回调参数：{} 原样放行，cancel 取消，requestHeaders 改写。 */
export type WebSocketDecision = { readonly cancel: true } | { readonly requestHeaders: Record<string, string> } | Record<string, never>

/**
 * 决定一次 WebSocket 升级如何处理（ADR 0002）。只有主窗口、目标为 sidecar authority、来源为 coko-app://app 的升级
 * 被注入 cookie 与同源 Origin；发往 sidecar 的其他升级被取消；与 sidecar 无关的连接不注入凭据。
 */
export function decideWebSocketHeaders(upgrade: WebSocketUpgrade): WebSocketDecision {
  const endpoint = upgrade.endpoint
  if (endpoint === undefined) return {}
  let requested: URL
  try {
    requested = new URL(upgrade.url)
  } catch {
    return {}
  }
  const target = new URL(endpoint.origin)
  if (requested.protocol !== 'ws:' || requested.host !== target.host) return {}
  if (upgrade.webContentsId === undefined || upgrade.webContentsId !== upgrade.mainWebContentsId) return { cancel: true }
  const headers: Record<string, string> = {}
  let origin: string | undefined
  for (const [name, value] of Object.entries(upgrade.requestHeaders)) {
    const lower = name.toLowerCase()
    if (lower === 'origin') origin = value
    if (lower === 'origin' || lower === 'cookie' || lower === 'sec-fetch-site') continue
    headers[name] = value
  }
  if (origin !== APP_ORIGIN) return { cancel: true }
  return { requestHeaders: { ...headers, Origin: target.origin, Cookie: endpoint.cookie, 'Sec-Fetch-Site': 'same-origin' } }
}
