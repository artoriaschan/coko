import { Type, type Static } from 'typebox'
import { SessionEntryRecord } from './entries.ts'
import { SessionActivity } from './runs.ts'

// HTTP 请求与响应 DTO。时间戳为毫秒；id 为不透明字符串。

const strict = { additionalProperties: false } as const
const Id = Type.String({ minLength: 1 })
const Timestamp = Type.Integer({ minimum: 0 })

// ---- Workspace ----

export const Workspace = Type.Object({ id: Id, path: Type.String(), name: Type.String(), createdAt: Timestamp }, strict)
export type Workspace = Static<typeof Workspace>

/** path 必须是已存在目录的绝对路径。 */
export const RegisterWorkspaceRequest = Type.Object({ path: Type.String({ minLength: 1 }), name: Type.Optional(Type.String({ minLength: 1 })) }, strict)
export type RegisterWorkspaceRequest = Static<typeof RegisterWorkspaceRequest>

export const WorkspaceListResponse = Type.Object({ workspaces: Type.Array(Workspace) }, strict)
export type WorkspaceListResponse = Static<typeof WorkspaceListResponse>

// ---- Session ----

export const SessionModel = Type.Object({ providerId: Id, modelId: Id }, strict)
export type SessionModel = Static<typeof SessionModel>

export const Session = Type.Object(
  {
    id: Id,
    workspaceId: Id,
    title: Type.String(),
    model: Type.Union([SessionModel, Type.Null()]),
    /** 当前是否有 Run 在进行。 */
    running: Type.Boolean(),
    /** 派生的运行状态（等待审批、等待确认、暂停、中断等）。 */
    activity: SessionActivity,
    createdAt: Timestamp,
    updatedAt: Timestamp,
  },
  strict,
)
export type Session = Static<typeof Session>

/** 未给 model 时使用默认模型（设置 defaultModel，否则第一个可用模型）。 */
export const CreateSessionRequest = Type.Object({ workspaceId: Id, title: Type.Optional(Type.String()), model: Type.Optional(SessionModel) }, strict)
export type CreateSessionRequest = Static<typeof CreateSessionRequest>

export const SessionListResponse = Type.Object({ sessions: Type.Array(Session) }, strict)
export type SessionListResponse = Static<typeof SessionListResponse>

/** entries 为线上信封；客户端逐条按 SessionEntry 校验。 */
export const SessionDetailResponse = Type.Object({ session: Session, entries: Type.Array(SessionEntryRecord) }, strict)
export type SessionDetailResponse = Static<typeof SessionDetailResponse>

export const SubmitMessageRequest = Type.Object({ text: Type.String({ minLength: 1 }) }, strict)
export type SubmitMessageRequest = Static<typeof SubmitMessageRequest>

/** 202：Run 已开始；结果经 WebSocket 的 entry / progress 推送。 */
export const SubmitMessageResponse = Type.Object({ runId: Id }, strict)
export type SubmitMessageResponse = Static<typeof SubmitMessageResponse>

/** aborted 为 false 表示当时没有进行中的 Run。 */
export const AbortRunResponse = Type.Object({ aborted: Type.Boolean() }, strict)
export type AbortRunResponse = Static<typeof AbortRunResponse>

export const SetSessionModelRequest = Type.Object({ model: SessionModel }, strict)
export type SetSessionModelRequest = Static<typeof SetSessionModelRequest>

// ---- Settings ----

export const Setting = Type.Object({ key: Type.String(), value: Type.Unknown(), revision: Type.Integer({ minimum: 0 }), updatedAt: Timestamp }, strict)
export type Setting = Static<typeof Setting>

export const SettingsResponse = Type.Object({ settings: Type.Array(Setting) }, strict)
export type SettingsResponse = Static<typeof SettingsResponse>

/** 键名以字母开头，只含字母、数字、点与连字符，最长 64。 */
export const SETTING_KEY_PATTERN = '^[a-zA-Z][a-zA-Z0-9.-]{0,63}$'

/** expectedRevision 不一致时返回 409 revision-conflict，details 带 expected 与 actual。 */
export const UpdateSettingRequest = Type.Object({ value: Type.Unknown(), expectedRevision: Type.Integer({ minimum: 0 }) }, strict)
export type UpdateSettingRequest = Static<typeof UpdateSettingRequest>

/** 新建 Session 默认使用的模型；值为 SessionModel。 */
export const DEFAULT_MODEL_SETTING = 'defaultModel'

// ---- Providers ----

/** Provider ID 由用户输入并作为主键：小写字母开头，后接小写字母、数字或连字符，总长 1–64；创建后不可修改。 */
export const PROVIDER_ID_PATTERN = '^[a-z][a-z0-9-]{0,63}$'
export const ProviderId = Type.String({ pattern: PROVIDER_ID_PATTERN })

/** Provider 保存的协议；与 @coko/agent 的 MODEL_PROTOCOLS 一致（apps/server/src/application/providers.ts 中有编译期断言）。 */
export const ModelProtocol = Type.Union([Type.Literal('openai-completions'), Type.Literal('openai-responses'), Type.Literal('anthropic-messages')])
export type ModelProtocol = Static<typeof ModelProtocol>

/** 除 off 外的六档，按固定顺序。 */
const ReasoningLevel = Type.Union([
  Type.Literal('minimal'),
  Type.Literal('low'),
  Type.Literal('medium'),
  Type.Literal('high'),
  Type.Literal('xhigh'),
  Type.Literal('max'),
])

/** 七档 Thinking Level：off 与其后六档，顺序固定；与 @coko/agent 的 THINKING_LEVELS 一致（同上，编译期断言）。 */
export const ThinkingLevel = Type.Union([Type.Literal('off'), ...ReasoningLevel.anyOf])
export type ThinkingLevel = Static<typeof ThinkingLevel>
export const THINKING_LEVELS: readonly ThinkingLevel[] = ThinkingLevel.anyOf.map((literal) => literal.const)

/** 一个已配置的档位：off 没有参数（按协议的默认关闭方式请求）；其余档位发送 value。 */
export const ThinkingLevelConfig = Type.Union([
  Type.Object({ level: Type.Literal('off') }, strict),
  Type.Object({ level: ReasoningLevel, value: Type.String({ minLength: 1 }) }, strict),
])
export type ThinkingLevelConfig = Static<typeof ThinkingLevelConfig>

/** 未填写容量时界面使用的默认值（token）。 */
export const MODEL_CATALOG_DEFAULTS = { contextWindow: 128_000, maxTokens: 16_000 } as const

const TokenCount = Type.Integer({ minimum: 1 })

/**
 * Model Catalog 中的一个模型。name 为空表示显示模型 ID。thinkingLevels 按用户添加的顺序保存；reasoning 关闭时档位仍保存，
 * 但请求不使用它们。同一目录内模型 ID 不重复、maxTokens 不超过 contextWindow、档位不重复由 sidecar 校验（400）。
 */
export const CatalogModel = Type.Object(
  {
    id: Id,
    name: Type.String(),
    contextWindow: TokenCount,
    maxTokens: TokenCount,
    input: Type.Array(Type.Union([Type.Literal('text'), Type.Literal('image')]), { minItems: 1, uniqueItems: true }),
    reasoning: Type.Boolean(),
    thinkingLevels: Type.Array(ThinkingLevelConfig),
  },
  strict,
)
export type CatalogModel = Static<typeof CatalogModel>

const Catalog = Type.Array(CatalogModel, { minItems: 1 })

/** Provider 配置；不含密钥，只给出是否已配置与末四位。 */
export const Provider = Type.Object(
  {
    id: ProviderId,
    name: Type.String(),
    api: ModelProtocol,
    /** http 或 https URL。 */
    baseUrl: Type.String(),
    models: Type.Array(CatalogModel),
    credential: Type.Union([Type.Object({ hint: Type.String() }, strict), Type.Null()]),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  },
  strict,
)
export type Provider = Static<typeof Provider>

export const ProviderListResponse = Type.Object({ providers: Type.Array(Provider) }, strict)
export type ProviderListResponse = Static<typeof ProviderListResponse>

/** ID 与已有 Provider 重复时 409 already-exists；地址不是 http(s) URL 或目录不合规则时 400。 */
export const CreateProviderRequest = Type.Object(
  {
    id: ProviderId,
    name: Type.String({ minLength: 1 }),
    api: ModelProtocol,
    baseUrl: Type.String({ minLength: 1 }),
    models: Catalog,
  },
  strict,
)
export type CreateProviderRequest = Static<typeof CreateProviderRequest>

/** ID 不可修改；省略的字段保持不变。 */
export const UpdateProviderRequest = Type.Object(
  {
    name: Type.Optional(Type.String({ minLength: 1 })),
    api: Type.Optional(ModelProtocol),
    baseUrl: Type.Optional(Type.String({ minLength: 1 })),
    models: Type.Optional(Catalog),
  },
  strict,
)
export type UpdateProviderRequest = Static<typeof UpdateProviderRequest>

// ---- Models ----

/** 一个可选的模型：Session 可以切换到它。 */
export const AvailableModel = Type.Object({ providerId: Id, providerName: Type.String(), modelId: Id, name: Type.String() }, strict)
export type AvailableModel = Static<typeof AvailableModel>

/** 已注册 Provider 的模型（按 Provider 登记顺序）与新建 Session 的默认模型；没有可用模型时 defaultModel 为 null。 */
export const ModelListResponse = Type.Object({ models: Type.Array(AvailableModel), defaultModel: Type.Union([SessionModel, Type.Null()]) }, strict)
export type ModelListResponse = Static<typeof ModelListResponse>
