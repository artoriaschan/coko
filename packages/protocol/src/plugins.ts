import { Type, type Static } from 'typebox'
import { ResourceDiagnostic } from './config.ts'

// 插件（ADR 0017）：/api/plugins 的 DTO。只声明资源、用户级复制安装、按可执行声明的 digest 批准。

const strict = { additionalProperties: false } as const
const Id = Type.String({ minLength: 1 })

/** 插件名：小写字母开头，至多 48 个字符。 */
export const PLUGIN_NAME_PATTERN = '^[a-z][a-z0-9-]{0,47}$'
export const PluginName = Type.String({ pattern: PLUGIN_NAME_PATTERN })

export const PluginSource = Type.Union([
  /** 本机目录（绝对路径），安装时复制快照。 */
  Type.Object({ kind: Type.Literal('dir'), path: Type.String({ minLength: 1 }) }, strict),
  /** git 地址（https:// 或 file://），clone --depth 1 后复制。 */
  Type.Object({ kind: Type.Literal('git'), url: Type.String({ minLength: 1 }), ref: Type.Optional(Type.String({ minLength: 1 })) }, strict),
])
export type PluginSource = Static<typeof PluginSource>

/** 已安装插件的来源记录。 */
export const PluginSourceInfo = Type.Object(
  {
    kind: Type.Union([Type.Literal('dir'), Type.Literal('git')]),
    location: Type.String(),
    ref: Type.Optional(Type.String()),
    commit: Type.Optional(Type.String()),
  },
  strict,
)
export type PluginSourceInfo = Static<typeof PluginSourceInfo>

export const PluginStatus = Type.Union([
  Type.Literal('needs-approval'),
  Type.Literal('enabled'),
  Type.Literal('disabled'),
  Type.Literal('incompatible'),
  Type.Literal('invalid'),
])
export type PluginStatus = Static<typeof PluginStatus>

/** 批准对话框显示的全部可执行内容（完整命令；env 只给键）。 */
export const PluginExecutables = Type.Object(
  {
    hooks: Type.Array(Type.Object({ event: Type.String(), matcher: Type.Optional(Type.String()), command: Type.String() }, strict)),
    mcpServers: Type.Array(
      Type.Object(
        {
          name: Id,
          command: Type.Optional(Type.String()),
          args: Type.Optional(Type.Array(Type.String())),
          url: Type.Optional(Type.String()),
          envKeys: Type.Array(Type.String()),
        },
        strict,
      ),
    ),
    lspServers: Type.Array(
      Type.Object({ name: Id, command: Type.String(), args: Type.Optional(Type.Array(Type.String())), extensions: Type.Array(Type.String()) }, strict),
    ),
  },
  strict,
)
export type PluginExecutables = Static<typeof PluginExecutables>

export const PluginContributionNames = Type.Object(
  { skills: Type.Array(Type.String()), commands: Type.Array(Type.String()), agents: Type.Array(Type.String()) },
  strict,
)
export type PluginContributionNames = Static<typeof PluginContributionNames>

export const PluginInfo = Type.Object(
  {
    name: PluginName,
    version: Type.String(),
    description: Type.Optional(Type.String()),
    source: PluginSourceInfo,
    status: PluginStatus,
    digest: Type.String(),
    approvedDigest: Type.Optional(Type.String()),
    contributions: PluginContributionNames,
    executables: PluginExecutables,
    diagnostics: Type.Array(ResourceDiagnostic),
  },
  strict,
)
export type PluginInfo = Static<typeof PluginInfo>

/** GET /api/plugins。 */
export const PluginListResponse = Type.Array(PluginInfo)
export type PluginListResponse = Static<typeof PluginListResponse>

/** POST /api/plugins → 201 PluginInfo（409 plugin-exists、400 plugin-invalid / plugin-source-unreachable / plugin-too-large）。 */
export const InstallPluginRequest = Type.Object({ source: PluginSource }, strict)
export type InstallPluginRequest = Static<typeof InstallPluginRequest>

/** POST /api/plugins/:name/approve（digest 与当前不同 409 digest-mismatch）。 */
export const ApprovePluginRequest = Type.Object({ digest: Id }, strict)
export type ApprovePluginRequest = Static<typeof ApprovePluginRequest>

/** PATCH /api/plugins/:name。 */
export const UpdatePluginRequest = Type.Object({ enabled: Type.Boolean() }, strict)
export type UpdatePluginRequest = Static<typeof UpdatePluginRequest>

export const pluginPaths = {
  /** GET PluginListResponse / POST InstallPluginRequest。 */
  plugins: '/api/plugins',
  /** PATCH UpdatePluginRequest / DELETE → 204。 */
  plugin: (name: string) => `/api/plugins/${encodeURIComponent(name)}`,
  /** POST ApprovePluginRequest。 */
  approve: (name: string) => `/api/plugins/${encodeURIComponent(name)}/approve`,
  /** POST：按原来源重新取。 */
  update: (name: string) => `/api/plugins/${encodeURIComponent(name)}/update`,
} as const
