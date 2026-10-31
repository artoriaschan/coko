// 能力配置（GET / PUT /api/config）。schema 与默认值的唯一定义在 @coko/agent 的 config/；这里是客户端信任边界的同形 schema，
// apps/server/src/application/config.ts 在编译期比对两侧一致。有效值 = 默认 ← 全局（设置键 config）← 项目（.coko/settings.json，只收紧，ADR 0008）。
import { Type, type Static } from 'typebox'

const strict = { additionalProperties: false } as const
const Names = Type.Array(Type.String({ minLength: 1, maxLength: 200 }), { maxItems: 500 })

/** 设置键：全局能力配置，只能经 PUT /api/config 修改（通用设置接口拒绝 config 及其下的键）。 */
export const CONFIG_SETTING = 'config'
export const isConfigSettingKey = (key: string) => key === CONFIG_SETTING || key.startsWith(`${CONFIG_SETTING}.`)

/** 加载用户编写的资源（指令、Skills、命令、MCP 配置、能力配置）时的诊断；读取失败或格式错误只产生诊断，不阻止 Run。 */
export const ResourceDiagnostic = Type.Object(
  {
    source: Type.Union([
      Type.Literal('instructions'),
      Type.Literal('skills'),
      Type.Literal('commands'),
      Type.Literal('mcp'),
      Type.Literal('config'),
      Type.Literal('memory'),
      Type.Literal('agents'),
      /** 插件清单与插件资源（各加载器对插件根的诊断）。 */
      Type.Literal('plugin'),
      Type.Literal('lsp'),
    ]),
    path: Type.Optional(Type.String()),
    /** 稳定的机器可读代码（unknown-key、invalid-value、project-cannot-grant、invalid-json、read-failed 等）。 */
    code: Type.String({ minLength: 1 }),
    /** 英文说明；界面按 code 本地化标题，message 作为细节原样显示。 */
    message: Type.String(),
  },
  strict,
)
export type ResourceDiagnostic = Static<typeof ResourceDiagnostic>

/** 有效能力配置（全部键）。 */
export const CapabilityConfig = Type.Object(
  {
    instructions: Type.Object({ enabled: Type.Boolean() }, strict),
    skills: Type.Object({ enabled: Type.Boolean(), disabled: Names }, strict),
    commands: Type.Object({ enabled: Type.Boolean(), disabled: Names }, strict),
    mcp: Type.Object({ enabled: Type.Boolean() }, strict),
    memory: Type.Object({ enabled: Type.Boolean() }, strict),
    context: Type.Object({ autoCompact: Type.Boolean(), trimOldToolResults: Type.Boolean() }, strict),
    hooks: Type.Object({ enabled: Type.Boolean() }, strict),
    agents: Type.Object({ enabled: Type.Boolean() }, strict),
    schedules: Type.Object({ enabled: Type.Boolean() }, strict),
    plugins: Type.Object({ enabled: Type.Boolean() }, strict),
    lsp: Type.Object({ enabled: Type.Boolean() }, strict),
    teams: Type.Object({ enabled: Type.Boolean() }, strict),
  },
  strict,
)
export type CapabilityConfig = Static<typeof CapabilityConfig>

/** 全局值：每个分区的部分键，省略的取默认（设置键 config 中保存的形状）。 */
export const CapabilityConfigValues = Type.Object(
  {
    instructions: Type.Optional(Type.Object({ enabled: Type.Optional(Type.Boolean()) }, strict)),
    skills: Type.Optional(Type.Object({ enabled: Type.Optional(Type.Boolean()), disabled: Type.Optional(Names) }, strict)),
    commands: Type.Optional(Type.Object({ enabled: Type.Optional(Type.Boolean()), disabled: Type.Optional(Names) }, strict)),
    mcp: Type.Optional(Type.Object({ enabled: Type.Optional(Type.Boolean()) }, strict)),
    memory: Type.Optional(Type.Object({ enabled: Type.Optional(Type.Boolean()) }, strict)),
    context: Type.Optional(Type.Object({ autoCompact: Type.Optional(Type.Boolean()), trimOldToolResults: Type.Optional(Type.Boolean()) }, strict)),
    hooks: Type.Optional(Type.Object({ enabled: Type.Optional(Type.Boolean()) }, strict)),
    agents: Type.Optional(Type.Object({ enabled: Type.Optional(Type.Boolean()) }, strict)),
    schedules: Type.Optional(Type.Object({ enabled: Type.Optional(Type.Boolean()) }, strict)),
    plugins: Type.Optional(Type.Object({ enabled: Type.Optional(Type.Boolean()) }, strict)),
    lsp: Type.Optional(Type.Object({ enabled: Type.Optional(Type.Boolean()) }, strict)),
    teams: Type.Optional(Type.Object({ enabled: Type.Optional(Type.Boolean()) }, strict)),
  },
  strict,
)
export type CapabilityConfigValues = Static<typeof CapabilityConfigValues>

const Off = Type.Optional(Type.Literal(false))

/**
 * 项目文件中生效的值：关闭的开关、追加禁用的 Skill、拒绝与询问规则（规则文本）。被忽略的键只出现在诊断中；hooks.enabled 与 plugins 只能在全局设置
 * （项目文件的 hooks 键是项目 Hook 的配置），lsp 只有 enabled: false 生效。
 */
export const ProjectConfigValues = Type.Object(
  {
    instructions: Type.Optional(Type.Object({ enabled: Off }, strict)),
    skills: Type.Optional(Type.Object({ enabled: Off, disabled: Type.Optional(Type.Array(Type.String())) }, strict)),
    commands: Type.Optional(Type.Object({ enabled: Off }, strict)),
    mcp: Type.Optional(Type.Object({ enabled: Off }, strict)),
    memory: Type.Optional(Type.Object({ enabled: Off }, strict)),
    context: Type.Optional(Type.Object({ autoCompact: Off, trimOldToolResults: Off }, strict)),
    agents: Type.Optional(Type.Object({ enabled: Off }, strict)),
    schedules: Type.Optional(Type.Object({ enabled: Off }, strict)),
    lsp: Type.Optional(Type.Object({ enabled: Off }, strict)),
    teams: Type.Optional(Type.Object({ enabled: Off }, strict)),
    permissions: Type.Optional(Type.Object({ deny: Type.Array(Type.String()), ask: Type.Array(Type.String()) }, strict)),
  },
  strict,
)
export type ProjectConfigValues = Static<typeof ProjectConfigValues>

/** 项目设置文件：路径总是给出；文件不存在时 exists 为 false，values 为空。 */
export const ProjectConfig = Type.Object(
  { path: Type.String(), exists: Type.Boolean(), values: ProjectConfigValues, diagnostics: Type.Array(ResourceDiagnostic) },
  strict,
)
export type ProjectConfig = Static<typeof ProjectConfig>

/**
 * GET /api/config?workspaceId=…：有效值（给出 workspaceId 时含该 Workspace 的项目文件）、全局值及其 revision（未保存过为 0），
 * 以及项目文件的路径、生效的值与诊断。项目文件每次请求时按 mtime 读取。Workspace 不存在时 404。
 */
export const ConfigResponse = Type.Object(
  { effective: CapabilityConfig, global: CapabilityConfigValues, globalRevision: Type.Integer({ minimum: 0 }), project: Type.Optional(ProjectConfig) },
  strict,
)
export type ConfigResponse = Static<typeof ConfigResponse>

/**
 * PUT /api/config：整体替换全局值，返回 ConfigResponse（给出 workspaceId 时含该 Workspace）。值不合 schema 时 400；
 * expectedRevision 不一致时 409 revision-conflict。
 */
export const UpdateConfigRequest = Type.Object(
  { values: CapabilityConfigValues, expectedRevision: Type.Integer({ minimum: 0 }), workspaceId: Type.Optional(Type.String({ minLength: 1 })) },
  strict,
)
export type UpdateConfigRequest = Static<typeof UpdateConfigRequest>

export const configPaths = {
  /** GET / PUT：能力配置。 */
  config: '/api/config',
} as const

/** 项目设置文件相对 Workspace 的位置。 */
export const PROJECT_SETTINGS_PATH = '.coko/settings.json'
