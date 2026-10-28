import { Type, type Static } from 'typebox'

/** Sidecar HTTP 与 WebSocket 路径。所有业务路由位于 /api 下，由 main 经 coko-app:// 代理。 */
export const API_ROUTES = {
  /** main 用启动令牌一次性交换会话 cookie；不经 renderer 代理。 */
  authExchange: '/api/auth/exchange',
  health: '/api/health',
  /** WebSocket 升级入口。 */
  stream: '/api/ws',
  workspaces: '/api/workspaces',
  sessions: '/api/sessions',
  settings: '/api/settings',
  providers: '/api/providers',
  /** GET：预设 Provider 的默认地址与模型目录。 */
  providerPresets: '/api/provider-presets',
  /** GET：已注册 Provider 的可用模型与默认模型。 */
  models: '/api/models',
} as const

export const AuthExchangeRequest = Type.Object({ token: Type.String() }, { additionalProperties: false })
export type AuthExchangeRequest = Static<typeof AuthExchangeRequest>

export const HealthResponse = Type.Object({ status: Type.Literal('ok') }, { additionalProperties: false })
export type HealthResponse = Static<typeof HealthResponse>

/** 带参数的业务路径。 */
export const apiPaths = {
  session: (id: string) => `${API_ROUTES.sessions}/${encodeURIComponent(id)}`,
  /** POST：提交用户消息并开始 Run。 */
  sessionMessages: (id: string) => `${apiPaths.session(id)}/messages`,
  /** POST：停止当前 Run。 */
  sessionAbort: (id: string) => `${apiPaths.session(id)}/abort`,
  /** PUT：切换 Session 的模型。 */
  sessionModel: (id: string) => `${apiPaths.session(id)}/model`,
  setting: (key: string) => `${API_ROUTES.settings}/${encodeURIComponent(key)}`,
  provider: (id: string) => `${API_ROUTES.providers}/${encodeURIComponent(id)}`,
} as const
