import { Type, type Static } from 'typebox'

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

/**
 * 已提交、不可修改的 Session Entry；seq 在 Session 内从 1 连续递增。
 * kind 为 message 时 payload 是模型可见的消息（role 为 user / assistant / toolResult，结构沿用 Agent 消息）；
 * kind 为 run_end 时 payload 为 RunEndPayload。
 */
export const SessionEntry = Type.Object(
  {
    sessionId: Id,
    seq: Type.Integer({ minimum: 1 }),
    kind: Type.String(),
    payloadVersion: Type.Integer({ minimum: 1 }),
    payload: Type.Unknown(),
    runId: Type.Union([Type.String(), Type.Null()]),
    createdAt: Timestamp,
  },
  strict,
)
export type SessionEntry = Static<typeof SessionEntry>

export const RunStatus = Type.Union([Type.Literal('completed'), Type.Literal('aborted'), Type.Literal('error')])
export type RunStatus = Static<typeof RunStatus>

export const RunEndPayload = Type.Object({ status: RunStatus, error: Type.Optional(Type.Object({ code: Type.String(), message: Type.String() })) }, strict)
export type RunEndPayload = Static<typeof RunEndPayload>

/** message 条目 payload 的最小公共形状；其余字段按 role 不同而不同。 */
export const MessagePayload = Type.Object({ role: Type.String(), content: Type.Optional(Type.Unknown()) })
export type MessagePayload = Static<typeof MessagePayload>

export const SessionDetailResponse = Type.Object({ session: Session, entries: Type.Array(SessionEntry) }, strict)
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

export const ProviderKind = Type.Union([Type.Literal('deepseek'), Type.Literal('openai'), Type.Literal('anthropic'), Type.Literal('openai-compatible')])
export type ProviderKind = Static<typeof ProviderKind>

export const ModelProtocol = Type.Union([Type.Literal('openai-completions'), Type.Literal('openai-responses'), Type.Literal('anthropic-messages')])
export type ModelProtocol = Static<typeof ModelProtocol>

/** Provider 配置；不含密钥，只给出是否已配置与末四位。 */
export const Provider = Type.Object(
  {
    id: Id,
    name: Type.String(),
    kind: ProviderKind,
    /** 由 kind 决定。 */
    api: ModelProtocol,
    /** 为空字符串时使用预设地址。 */
    baseUrl: Type.String(),
    models: Type.Array(Type.String()),
    credential: Type.Union([Type.Object({ hint: Type.String() }, strict), Type.Null()]),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  },
  strict,
)
export type Provider = Static<typeof Provider>

export const ProviderListResponse = Type.Object({ providers: Type.Array(Provider) }, strict)
export type ProviderListResponse = Static<typeof ProviderListResponse>

/** openai-compatible 必须给 baseUrl；预设 kind 省略 baseUrl 时使用预设地址。 */
export const CreateProviderRequest = Type.Object(
  {
    name: Type.String({ minLength: 1 }),
    kind: ProviderKind,
    baseUrl: Type.Optional(Type.String()),
    models: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
  },
  strict,
)
export type CreateProviderRequest = Static<typeof CreateProviderRequest>

export const UpdateProviderRequest = Type.Object(
  {
    name: Type.Optional(Type.String({ minLength: 1 })),
    baseUrl: Type.Optional(Type.String()),
    models: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { minItems: 1 })),
  },
  strict,
)
export type UpdateProviderRequest = Static<typeof UpdateProviderRequest>
