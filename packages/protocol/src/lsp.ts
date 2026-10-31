import { Type, type Static } from 'typebox'
import { ResourceDiagnostic } from './config.ts'

// 代码智能：语言服务器配置、状态、lsp_update 进度与 /api/lsp 的 DTO。

const strict = { additionalProperties: false } as const
const Id = Type.String({ minLength: 1 })
const Count = Type.Integer({ minimum: 0 })

/** 设置键：全局语言服务器；Workspace 的服务器在 lsp.workspaces.<workspaceId>.servers。只能经 PUT /api/lsp 修改。 */
export const LSP_SERVERS_SETTING = 'lsp.servers'
export const lspWorkspaceServersSetting = (workspaceId: string) => `lsp.workspaces.${workspaceId}.servers`
export const isLspSettingKey = (key: string) => key === 'lsp' || key.startsWith('lsp.')

/** 一个语言服务器的配置。extensionToLanguage：文件扩展名（含点）→ languageId。 */
export const LspServerConfig = Type.Object(
  {
    command: Type.String({ minLength: 1 }),
    args: Type.Optional(Type.Array(Type.String())),
    extensionToLanguage: Type.Record(Type.String(), Type.String({ minLength: 1 })),
    env: Type.Optional(Type.Record(Type.String(), Type.String())),
    initializationOptions: Type.Optional(Type.Unknown()),
    startupTimeout: Type.Optional(Type.Integer({ minimum: 1 })),
  },
  strict,
)
export type LspServerConfig = Static<typeof LspServerConfig>
export const LspServersConfig = Type.Record(Type.String(), LspServerConfig)
export type LspServersConfig = Static<typeof LspServersConfig>

export const LspServerSource = Type.Union([Type.Literal('global'), Type.Literal('workspace'), Type.Literal('plugin')])
export type LspServerSource = Static<typeof LspServerSource>

export const LspServerState = Type.Union([Type.Literal('idle'), Type.Literal('starting'), Type.Literal('running'), Type.Literal('failed')])
export type LspServerState = Static<typeof LspServerState>

/** 一个语言服务器（按名字与工作目录）的状态；stderrTail 已脱敏。 */
export const LspServerStatus = Type.Object(
  {
    name: Id,
    source: LspServerSource,
    extensions: Type.Array(Type.String()),
    state: LspServerState,
    cwd: Type.Optional(Type.String()),
    pid: Type.Optional(Count),
    stderrTail: Type.Optional(Type.String()),
    error: Type.Optional(Type.String()),
  },
  strict,
)
export type LspServerStatus = Static<typeof LspServerStatus>

/** progress lsp_update：状态变化时（不属于 Run）。 */
export const LspUpdate = Type.Object({ type: Type.Literal('lsp_update'), servers: Type.Array(LspServerStatus) }, strict)
export type LspUpdate = Static<typeof LspUpdate>

const LspScopeConfig = Type.Object({ servers: LspServersConfig, revision: Count, diagnostics: Type.Array(ResourceDiagnostic) }, strict)

/** GET /api/lsp?sessionId=。 */
export const LspResponse = Type.Object(
  {
    enabled: Type.Boolean(),
    global: LspScopeConfig,
    workspace: Type.Optional(Type.Object({ workspaceId: Id, ...LspScopeConfig.properties }, strict)),
    status: Type.Array(LspServerStatus),
  },
  strict,
)
export type LspResponse = Static<typeof LspResponse>

/** PUT /api/lsp：整体替换一个作用域的服务器（400 / 409 revision-conflict）。 */
export const UpdateLspRequest = Type.Object(
  {
    scope: Type.Union([Type.Literal('global'), Type.Object({ workspaceId: Id }, strict)]),
    servers: LspServersConfig,
    expectedRevision: Count,
  },
  strict,
)
export type UpdateLspRequest = Static<typeof UpdateLspRequest>

/** POST /api/lsp/restart → 204（没有该服务器 404 lsp-server-not-found）。 */
export const RestartLspRequest = Type.Object({ name: Id, cwd: Type.Optional(Type.String()) }, strict)
export type RestartLspRequest = Static<typeof RestartLspRequest>

export const lspPaths = {
  /** GET LspResponse（?sessionId=）/ PUT UpdateLspRequest。 */
  lsp: '/api/lsp',
  status: (sessionId: string) => `/api/lsp?sessionId=${encodeURIComponent(sessionId)}`,
  /** POST RestartLspRequest。 */
  restart: '/api/lsp/restart',
} as const
