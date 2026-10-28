import { Type, type Static } from 'typebox'

/** Sidecar HTTP 与 WebSocket 路径。所有业务路由位于 /api 下，由 main 经 coko-app:// 代理。 */
export const API_ROUTES = {
  /** main 用启动令牌一次性交换会话 cookie；不经 renderer 代理。 */
  authExchange: '/api/auth/exchange',
  health: '/api/health',
  /** WebSocket 升级入口。 */
  stream: '/api/ws',
} as const

export const AuthExchangeRequest = Type.Object({ token: Type.String() }, { additionalProperties: false })
export type AuthExchangeRequest = Static<typeof AuthExchangeRequest>

export const HealthResponse = Type.Object({ status: Type.Literal('ok') }, { additionalProperties: false })
export type HealthResponse = Static<typeof HealthResponse>
