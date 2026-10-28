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

/** 只供 main 调用的路由前缀：renderer 经 coko-app:// 代理的任何请求都不得到达。 */
export const MAIN_ONLY_PREFIX = '/api/auth'

/**
 * 判定路由用的规范路径：反复百分号解码（至多 3 次，覆盖双重编码）、合并重复斜杠、去掉末尾斜杠、转小写。
 * 解码失败返回 undefined，调用方应拒绝请求。
 */
export function normalizeRoutePath(pathname: string): string | undefined {
  let path = pathname
  for (let i = 0; i < 3 && path.includes('%'); i++) {
    try {
      path = decodeURIComponent(path)
    } catch {
      return undefined
    }
  }
  if (path.includes('%')) return undefined
  path = path.replace(/\/+/g, '/').toLowerCase()
  return path.length > 1 ? path.replace(/\/$/, '') : path
}

/** 规范化后位于 /api/auth 之下（含其本身）的路径；无法解码的路径也视为命中。 */
export function isMainOnlyPath(pathname: string): boolean {
  const path = normalizeRoutePath(pathname)
  if (path === undefined) return true
  return path === MAIN_ONLY_PREFIX || path.startsWith(`${MAIN_ONLY_PREFIX}/`) || path.startsWith(`${MAIN_ONLY_PREFIX};`)
}

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
