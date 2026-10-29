// MCP Server（票 07、08）：GET /api/mcp、PUT /api/mcp/servers、POST /api/mcp/approvals、POST /api/mcp/reconnect。
// 票 01 建立本文件并在 index.ts 一次性 re-export；之后只改本文件。配置的逐项校验在 @coko/agent 的 extensions/mcp/config.ts，
// 这里只约束外形（坏项由 Sidecar 以 400 拒绝并写明原因）。
import { Type, type Static } from 'typebox'
import { ResourceDiagnostic } from './config.ts'

const strict = { additionalProperties: false } as const

/** 设置键：全局 MCP Server 配置（{ [name]: config }），只能经 PUT /api/mcp/servers 修改。 */
export const MCP_SERVERS_SETTING = 'mcp.servers'
/** 设置键前缀：项目 Server 的批准（mcp.approvals.<workspaceId> = { [name]: digest }），只能经 POST /api/mcp/approvals 修改。 */
export const MCP_APPROVALS_SETTING_PREFIX = 'mcp.approvals.'
export const mcpApprovalsSettingKey = (workspaceId: string) => `${MCP_APPROVALS_SETTING_PREFIX}${workspaceId}`
/** mcp.servers 与 mcp.approvals.* 只能经 MCP 接口修改（通用设置接口拒绝）。 */
export const isMcpSettingKey = (key: string) => key === MCP_SERVERS_SETTING || key.startsWith(MCP_APPROVALS_SETTING_PREFIX)
/** Workspace 内的项目 MCP 配置文件。 */
export const PROJECT_MCP_PATH = '.mcp.json'

/** 一个 Server 配置：stdio { command, args?, env?, cwd? } 或 HTTP { url, headers? }，公共 { type?, enabled?, timeout?, disabledTools? }。 */
export const McpServerConfig = Type.Record(Type.String(), Type.Unknown())
export type McpServerConfig = Static<typeof McpServerConfig>
export const McpServersConfig = Type.Record(Type.String(), McpServerConfig)
export type McpServersConfig = Static<typeof McpServersConfig>

/**
 * 连接状态：idle（未连接；该 Workspace 的第一个 Run 时连接）、connecting、connected、failed（error 与 stderrTail 说明原因）、
 * disabled（Server 或能力配置 mcp.enabled 关闭）、pending-approval（项目 Server 未批准或配置在批准后改变）。
 */
export const McpServerStatus = Type.Union([
  Type.Literal('idle'),
  Type.Literal('connecting'),
  Type.Literal('connected'),
  Type.Literal('failed'),
  Type.Literal('disabled'),
  Type.Literal('pending-approval'),
])
export type McpServerStatus = Static<typeof McpServerStatus>

/** 批准对话框显示的完整启动信息：命令、参数、工作目录、地址，以及环境变量与请求头的名字（值不返回）。 */
export const McpLaunchDetails = Type.Object(
  {
    command: Type.Optional(Type.String()),
    args: Type.Optional(Type.Array(Type.String())),
    cwd: Type.Optional(Type.String()),
    url: Type.Optional(Type.String()),
    envNames: Type.Optional(Type.Array(Type.String())),
    headerNames: Type.Optional(Type.Array(Type.String())),
  },
  strict,
)
export type McpLaunchDetails = Static<typeof McpLaunchDetails>

/** 项目 Server 的批准：当前配置的摘要与是否已批准（已批准的摘要等于当前摘要）。 */
export const McpApproval = Type.Object({ digest: Type.String(), approved: Type.Boolean(), launch: McpLaunchDetails }, strict)
export type McpApproval = Static<typeof McpApproval>

export const McpToolInfo = Type.Object({ name: Type.String(), server: Type.String(), description: Type.Optional(Type.String()) }, strict)
export type McpToolInfo = Static<typeof McpToolInfo>

export const McpServerInfo = Type.Object(
  {
    name: Type.String(),
    scope: Type.Union([Type.Literal('global'), Type.Literal('project')]),
    transport: Type.Union([Type.Literal('stdio'), Type.Literal('http')]),
    enabled: Type.Boolean(),
    status: McpServerStatus,
    /** 经已登记 Secret 的值与凭据形态脱敏。 */
    error: Type.Optional(Type.String()),
    /** stdio Server 最后 20 行 stderr，经同样脱敏。 */
    stderrTail: Type.Optional(Type.String()),
    /** 连接后注册的工具（mcp__<server>__<tool>，disabledTools 已排除）。 */
    tools: Type.Array(McpToolInfo),
    /** 只有项目 Server 有。 */
    approval: Type.Optional(McpApproval),
  },
  strict,
)
export type McpServerInfo = Static<typeof McpServerInfo>

/**
 * GET /api/mcp?workspaceId：全局 Server 与该 Workspace 的项目 Server（.mcp.json 每次请求时读取）。global 为保存的全局配置
 * （编辑用；env / headers 中的 Secret 以 ${NAME} 出现，值不在其中），globalRevision 为设置键 mcp.servers 的 revision（未保存过为 0）。
 * enabled 为有效能力配置 mcp.enabled。
 */
export const McpResponse = Type.Object(
  {
    enabled: Type.Boolean(),
    servers: Type.Array(McpServerInfo),
    global: McpServersConfig,
    globalRevision: Type.Integer({ minimum: 0 }),
    project: Type.Optional(Type.Object({ path: Type.String(), exists: Type.Boolean() }, strict)),
    diagnostics: Type.Array(ResourceDiagnostic),
  },
  strict,
)
export type McpResponse = Static<typeof McpResponse>

/** PUT /api/mcp/servers：整体替换全局配置。任一项不合法时 400（message 写明哪一项）；revision 不一致时 409 revision-conflict。 */
export const UpdateMcpServersRequest = Type.Object(
  { servers: McpServersConfig, expectedRevision: Type.Integer({ minimum: 0 }), workspaceId: Type.Optional(Type.String({ minLength: 1 })) },
  strict,
)
export type UpdateMcpServersRequest = Static<typeof UpdateMcpServersRequest>

/** POST /api/mcp/approvals：批准（摘要须等于当前项目配置的摘要，否则 409 revision-conflict）或撤销批准。 */
export const McpApprovalRequest = Type.Object(
  { workspaceId: Type.String({ minLength: 1 }), name: Type.String({ minLength: 1 }), digest: Type.String({ minLength: 1 }), approve: Type.Boolean() },
  strict,
)
export type McpApprovalRequest = Static<typeof McpApprovalRequest>

/** POST /api/mcp/reconnect：关闭并重新连接该 Workspace 的一个 Server（等待连接结束），返回 McpResponse。 */
export const McpReconnectRequest = Type.Object({ workspaceId: Type.String({ minLength: 1 }), name: Type.String({ minLength: 1 }) }, strict)
export type McpReconnectRequest = Static<typeof McpReconnectRequest>

export const mcpPaths = {
  /** GET ?workspaceId */
  mcp: '/api/mcp',
  /** PUT */
  servers: '/api/mcp/servers',
  /** POST */
  approvals: '/api/mcp/approvals',
  /** POST */
  reconnect: '/api/mcp/reconnect',
} as const
