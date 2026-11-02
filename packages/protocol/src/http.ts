import { Type, type Static } from 'typebox'
import { SessionEntryRecord } from './entries.ts'
import { SessionActivity } from './runs.ts'
import { SessionWorktree } from './worktrees.ts'
import { PermissionMode } from './permissions.ts'

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

// ---- Project ----

export const Project = Type.Object(
  {
    id: Id,
    name: Type.String(),
    primaryWorkspaceId: Id,
    folders: Type.Array(Type.Object({ path: Type.String(), primary: Type.Boolean() }, strict)),
    pinnedAt: Type.Union([Timestamp, Type.Null()]),
    createdAt: Timestamp,
    lastUsedAt: Timestamp,
    sessionCount: Type.Integer({ minimum: 0 }),
  },
  strict,
)
export type Project = Static<typeof Project>
export const ProjectListResponse = Type.Object({ projects: Type.Array(Project) }, strict)
export type ProjectListResponse = Static<typeof ProjectListResponse>

export const ProjectFields = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 50 }),
    folders: Type.Array(Type.Object({ path: Type.String({ minLength: 1 }), primary: Type.Boolean() }, strict), { minItems: 1 }),
  },
  strict,
)
export type ProjectFields = Static<typeof ProjectFields>
export const CreateProjectResponse = Type.Object({ status: Type.Union([Type.Literal('created'), Type.Literal('existing')]), project: Project }, strict)
export type CreateProjectResponse = Static<typeof CreateProjectResponse>
export const UpdateProjectResponse = Type.Object({ status: Type.Literal('updated'), project: Project }, strict)
export const RenameProjectRequest = Type.Object({ name: Type.String({ minLength: 1, maxLength: 50 }) }, strict)
export const CheckProjectFolderRequest = Type.Object({ path: Type.String({ minLength: 1 }) }, strict)
export const CheckProjectFolderResponse = Type.Object({ path: Type.String() }, strict)

// ---- Thinking Level ----

/** 除 off 外的六档，按固定顺序。 */
const ReasoningLevel = Type.Union([
  Type.Literal('minimal'),
  Type.Literal('low'),
  Type.Literal('medium'),
  Type.Literal('high'),
  Type.Literal('xhigh'),
  Type.Literal('max'),
])

/**
 * 七档 Thinking Level：off 与其后六档，顺序固定；与 @coko/agent 的 THINKING_LEVELS 一致（apps/server/src/application/providers.ts
 * 中有编译期断言）。
 */
export const ThinkingLevel = Type.Union([Type.Literal('off'), ...ReasoningLevel.anyOf])
export type ThinkingLevel = Static<typeof ThinkingLevel>
export const THINKING_LEVELS: readonly ThinkingLevel[] = ThinkingLevel.anyOf.map((literal) => literal.const)

// ---- Session ----

export const SessionModel = Type.Object({ providerId: Id, modelId: Id }, strict)
export type SessionModel = Static<typeof SessionModel>

export const Session = Type.Object(
  {
    id: Id,
    workspaceId: Id,
    projectId: Type.Union([Id, Type.Null()]),
    pinnedAt: Type.Union([Timestamp, Type.Null()]),
    archivedAt: Type.Union([Timestamp, Type.Null()]),
    title: Type.String(),
    model: Type.Union([SessionModel, Type.Null()]),
    /** 与模型一起按 Session 保存的 Thinking Level；新建为 off。当前模型不支持该档位（例如目录已修改）时为 off。 */
    thinkingLevel: ThinkingLevel,
    /**
     * 模型字段被清空（Provider 被删除或升级时清除）：下次运行前要求重新选择模型（409 model-required），界面提示重新选择。
     * 从未设置模型时为 false，运行时取默认模型。
     */
    modelCleared: Type.Boolean(),
    /** 当前是否有 Run 在进行。 */
    running: Type.Boolean(),
    /** 派生的运行状态（等待审批、等待确认、暂停、中断等）。 */
    activity: SessionActivity,
    /** 子 Session（子代理）的父 Session；子 Session 不在 GET /api/sessions 的列表中。 */
    parentSessionId: Type.Optional(Id),
    /** 创建时绑定的 worktree（ADR 0016）；工作目录在 Session 的生命周期内不变。 */
    worktree: Type.Optional(SessionWorktree),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  },
  strict,
)
export type Session = Static<typeof Session>

/**
 * 未给 model 时使用默认模型（设置 defaultModel，否则第一个可用模型）。thinkingLevel 缺省为 off；所用模型不能选该档位时 400。
 */
export const CreateSessionRequest = Type.Object(
  {
    workspaceId: Id,
    title: Type.Optional(Type.String()),
    model: Type.Optional(SessionModel),
    thinkingLevel: Type.Optional(ThinkingLevel),
    /** 绑定该 Workspace 的 active worktree（ADR 0016）。 */
    worktreeId: Type.Optional(Id),
  },
  strict,
)
export type CreateSessionRequest = Static<typeof CreateSessionRequest>

export const IMAGE_ATTACHMENT_MAX_BYTES = 4.5 * 1024 * 1024
export const ImageAttachment = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 255 }),
    mimeType: Type.Union([Type.Literal('image/png'), Type.Literal('image/jpeg'), Type.Literal('image/gif'), Type.Literal('image/webp')]),
    data: Type.String({ minLength: 4, maxLength: Math.ceil(IMAGE_ATTACHMENT_MAX_BYTES / 3) * 4, pattern: '^[A-Za-z0-9+/]+={0,2}$' }),
  },
  strict,
)
export type ImageAttachment = Static<typeof ImageAttachment>

/** 首次发送：同一草稿身份只创建一个会话；成功时首条用户消息已经持久化。 */
export const FirstSendRequest = Type.Object(
  {
    draftId: Type.String({ minLength: 1, maxLength: 200 }),
    projectId: Type.Optional(Id),
    text: Type.String(),
    images: Type.Optional(Type.Array(ImageAttachment)),
    model: Type.Optional(SessionModel),
    thinkingLevel: Type.Optional(ThinkingLevel),
    permissionMode: Type.Optional(PermissionMode),
  },
  strict,
)
export type FirstSendRequest = Static<typeof FirstSendRequest>
export const FirstSendResponse = Type.Object({ session: Session, runId: Id }, strict)
export type FirstSendResponse = Static<typeof FirstSendResponse>

export const SessionListResponse = Type.Object({ sessions: Type.Array(Session) }, strict)
export type SessionListResponse = Static<typeof SessionListResponse>

export const MoveSessionRequest = Type.Object({ projectId: Type.Union([Id, Type.Null()]) }, strict)
export type MoveSessionRequest = Static<typeof MoveSessionRequest>

export const SetSessionPinRequest = Type.Object({ pinned: Type.Boolean() }, strict)
export type SetSessionPinRequest = Static<typeof SetSessionPinRequest>

export const RenameSessionRequest = Type.Object({ title: Type.String({ minLength: 1, maxLength: 200 }) }, strict)
export type RenameSessionRequest = Static<typeof RenameSessionRequest>

/** entries 为线上信封；客户端逐条按 SessionEntry 校验。 */
export const SessionDetailResponse = Type.Object({ session: Session, entries: Type.Array(SessionEntryRecord) }, strict)
export type SessionDetailResponse = Static<typeof SessionDetailResponse>

export const SubmitMessageRequest = Type.Object({ text: Type.String(), images: Type.Optional(Type.Array(ImageAttachment)) }, strict)
export type SubmitMessageRequest = Static<typeof SubmitMessageRequest>

/** 202：Run 已开始；结果经 WebSocket 的 entry / progress 推送。 */
export const SubmitMessageResponse = Type.Object({ runId: Id }, strict)
export type SubmitMessageResponse = Static<typeof SubmitMessageResponse>

/** aborted 为 false 表示当时没有进行中的 Run。 */
export const AbortRunResponse = Type.Object({ aborted: Type.Boolean() }, strict)
export type AbortRunResponse = Static<typeof AbortRunResponse>

/**
 * 模型与 Thinking Level 一起切换（Run 进行中 409 run-in-progress）。给出 thinkingLevel 时该模型不能选它为 400；缺省时保留当前档位，
 * 新模型不能选它时回到 off。
 */
export const SetSessionModelRequest = Type.Object({ model: SessionModel, thinkingLevel: Type.Optional(ThinkingLevel) }, strict)
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

/** 费用的显示货币（全局设置，只决定符号，不换算）；其他值或未设置时为 USD。 */
export const USAGE_CURRENCY_SETTING = 'usage.currency'
export const USAGE_CURRENCIES = ['USD', 'CNY'] as const
export type UsageCurrency = (typeof USAGE_CURRENCIES)[number]
export const usageCurrencyOf = (value: unknown): UsageCurrency => (value === 'CNY' ? 'CNY' : 'USD')

// ---- Providers ----

/** Provider ID 由用户输入并作为主键：小写字母开头，后接小写字母、数字或连字符，总长 1–64；创建后不可修改。 */
export const PROVIDER_ID_PATTERN = '^[a-z][a-z0-9-]{0,63}$'

/** Provider 的 API 地址须为 http 或 https URL（新建、编辑与获取模型共用）。 */
export function isHttpUrl(text: string): boolean {
  try {
    const { protocol } = new URL(text)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}
export const ProviderId = Type.String({ pattern: PROVIDER_ID_PATTERN })

/** Provider 保存的协议；与 @coko/agent 的 MODEL_PROTOCOLS 一致（apps/server/src/application/providers.ts 中有编译期断言）。 */
export const ModelProtocol = Type.Union([Type.Literal('openai-completions'), Type.Literal('openai-responses'), Type.Literal('anthropic-messages')])
export type ModelProtocol = Static<typeof ModelProtocol>

/** 一个已配置的档位：off 没有参数（按协议的默认关闭方式请求）；其余档位发送 value。 */
export const ThinkingLevelConfig = Type.Union([
  Type.Object({ level: Type.Literal('off') }, strict),
  Type.Object({ level: ReasoningLevel, value: Type.String({ minLength: 1 }) }, strict),
])
export type ThinkingLevelConfig = Static<typeof ThinkingLevelConfig>

/** 未填写容量时界面使用的默认值（token）。 */
export const MODEL_CATALOG_DEFAULTS = { contextWindow: 128_000, maxTokens: 16_000 } as const

const TokenCount = Type.Integer({ minimum: 1 })

const Price = Type.Number({ minimum: 0 })

/** 模型价格：每百万 token 的单价（非负），显示货币由设置 usage.currency 决定（不换算）。缓存读写的价格省略时为 0。 */
export const ModelPrice = Type.Object({ input: Price, output: Price, cacheRead: Type.Optional(Price), cacheWrite: Type.Optional(Price) }, strict)
export type ModelPrice = Static<typeof ModelPrice>

/**
 * Model Catalog 中的一个模型。name 为空表示显示模型 ID。thinkingLevels 按用户添加的顺序保存；reasoning 关闭时档位仍保存，
 * 但请求不使用它们。price 省略为未定价（usage.cost 为 0，界面显示"未定价"）。同一目录内模型 ID 不重复、maxTokens 不超过
 * contextWindow、档位不重复、价格非负由 sidecar 校验（400）。
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
    price: Type.Optional(ModelPrice),
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

/** 引用某 Provider 的 Session 数量；删除 Provider 时这些 Session 的模型字段被清空。 */
export const ProviderReferencesResponse = Type.Object({ sessions: Type.Integer({ minimum: 0 }) }, strict)
export type ProviderReferencesResponse = Static<typeof ProviderReferencesResponse>

/**
 * 一次提交的 Provider 配置（不含密钥）：新建与编辑都给出完整字段，编辑时 id 指定要修改的 Provider（不可修改）。
 * 只经 preload IPC 与控制消息 provider.save 提交（ADR 0010），HTTP 不提供创建与更新。ID 重复时 already-exists；
 * 地址不是 http(s) URL 或目录不合规则时 bad-request。
 */
export const ProviderFields = Type.Object(
  {
    id: ProviderId,
    name: Type.String({ minLength: 1 }),
    api: ModelProtocol,
    baseUrl: Type.String({ minLength: 1 }),
    models: Catalog,
  },
  strict,
)
export type ProviderFields = Static<typeof ProviderFields>

/** create：新建，ID 不能已被使用；update：替换已有 Provider 的配置。 */
export const ProviderSaveMode = Type.Union([Type.Literal('create'), Type.Literal('update')])
export type ProviderSaveMode = Static<typeof ProviderSaveMode>

// ---- Models ----

/**
 * 一个可选的模型：Session 可以切换到它。thinkingLevels 为会话中可选的档位，按固定顺序：始终有 off，推理开关打开时再加上
 * 目录中已配置的档位。
 */
export const AvailableModel = Type.Object(
  {
    providerId: Id,
    providerName: Type.String(),
    modelId: Id,
    name: Type.String(),
    input: Type.Optional(Type.Array(Type.Union([Type.Literal('text'), Type.Literal('image')]))),
    thinkingLevels: Type.Array(ThinkingLevel, { minItems: 1 }),
  },
  strict,
)
export type AvailableModel = Static<typeof AvailableModel>

/** 已注册 Provider 的模型（按 Provider 登记顺序）与新建 Session 的默认模型；没有可用模型时 defaultModel 为 null。 */
export const ModelListResponse = Type.Object({ models: Type.Array(AvailableModel), defaultModel: Type.Union([SessionModel, Type.Null()]) }, strict)
export type ModelListResponse = Static<typeof ModelListResponse>

/** DELETE /api/sessions/:id: authoritative removed tree identities. */
export const DeleteSessionResponse = Type.Object({ sessionIds: Type.Array(Type.String()) }, { additionalProperties: false })
export type DeleteSessionResponse = Static<typeof DeleteSessionResponse>
