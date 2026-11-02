import { Type, type Static } from 'typebox'

/** Sidecar HTTP 与 WebSocket 路径。所有业务路由位于 /api 下，由 main 经 coko-app:// 代理。 */
export const API_ROUTES = {
  /** main 用启动令牌一次性交换会话 cookie；不经 renderer 代理。 */
  authExchange: '/api/auth/exchange',
  health: '/api/health',
  /** WebSocket 升级入口。 */
  stream: '/api/ws',
  workspaces: '/api/workspaces',
  projects: '/api/projects',
  projectFolderCheck: '/api/projects/check-folder',
  sessions: '/api/sessions',
  firstSend: '/api/chats/first-send',
  settings: '/api/settings',
  providers: '/api/providers',
  /** GET：已注册 Provider 的可用模型与默认模型。 */
  models: '/api/models',
  /** 插件（pluginPaths）。 */
  plugins: '/api/plugins',
  /** 代码智能（lspPaths）。 */
  lsp: '/api/lsp',
  /** GET：MCP 预设（如浏览器）。 */
  mcpPresets: '/api/mcp/presets',
  /** GET：Memory（?query=&scope=&workspaceId= 时为检索）。 */
  memories: '/api/memories',
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
  sessionPin: (id: string) => `${apiPaths.session(id)}/pin`,
  sessionTitle: (id: string) => `${apiPaths.session(id)}/title`,
  /** POST：提交用户消息并开始 Run。 */
  sessionMessages: (id: string) => `${apiPaths.session(id)}/messages`,
  /** POST：重新执行出错的上一轮（不追加用户消息），202 返回新 runId。 */
  sessionRetry: (id: string) => `${apiPaths.session(id)}/retry`,
  /** POST：停止当前 Run。 */
  sessionAbort: (id: string) => `${apiPaths.session(id)}/abort`,
  /** POST：回答待审批请求（AnswerApprovalRequest），204。 */
  sessionApproval: (id: string, requestId: string) => `${apiPaths.session(id)}/approvals/${encodeURIComponent(requestId)}`,
  /** PUT：切换 Session 的模型。 */
  sessionModel: (id: string) => `${apiPaths.session(id)}/model`,
  setting: (key: string) => `${API_ROUTES.settings}/${encodeURIComponent(key)}`,
  provider: (id: string) => `${API_ROUTES.providers}/${encodeURIComponent(id)}`,
  /** GET：引用该 Provider 的 Session 数量（ProviderReferencesResponse），删除前确认用。 */
  providerReferences: (id: string) => `${apiPaths.provider(id)}/references`,
  /** GET TeamSnapshot（teamPaths.team）。 */
  sessionTeam: (id: string) => `${apiPaths.session(id)}/team`,
  /** GET TraceResponse（tracePaths）。 */
  sessionTrace: (id: string) => `${apiPaths.session(id)}/trace`,
  sessionAudit: (id: string) => `${apiPaths.session(id)}/audit`,
  sessionExport: (id: string, children = false) => `${apiPaths.session(id)}/export${children ? '?children=1' : ''}`,
  /** GET：按关键词检索 Memory。 */
  memorySearch: (query: string, options: { scope?: 'user' | 'workspace'; workspaceId?: string } = {}) => {
    const params = new URLSearchParams({ query })
    if (options.scope) params.set('scope', options.scope)
    if (options.workspaceId) params.set('workspaceId', options.workspaceId)
    return `${API_ROUTES.memories}?${params.toString()}`
  },
} as const
