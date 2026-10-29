import { API_ROUTES, type AuthExchangeRequest } from '@coko/protocol'

/**
 * 用一次性启动令牌换取 sidecar 会话 cookie（ADR 0002）。只在 main 中调用，cookie 不交给 renderer。
 * @param origin - sidecar 的 http://127.0.0.1:<port>
 * @param signal - 中止时请求立即结束；监管在停止 sidecar 之前中止它
 * @returns 用于 Cookie 请求头的 name=value
 */
export async function exchangeLaunchToken(origin: string, token: string, signal?: AbortSignal): Promise<string> {
  const body: AuthExchangeRequest = { token }
  const response = await fetch(new URL(API_ROUTES.authExchange, origin), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    redirect: 'manual',
    signal,
  })
  await response.body?.cancel()
  const cookie = response.headers.getSetCookie()[0]
  if (!response.ok || cookie === undefined) throw new Error(`Sidecar token exchange failed with status ${response.status}`)
  const end = cookie.indexOf(';')
  return end < 0 ? cookie : cookie.slice(0, end)
}
