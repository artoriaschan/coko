/** 可序列化为 JSON 的值；条目 payload 与设置值都使用它。 */
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

/** 用户登记给 Coko 的本机目录。 */
export interface Workspace {
  id: string
  path: string
  name: string
  createdAt: number
}

/** Session 当前使用的模型。 */
export interface SessionModel {
  providerId: string
  modelId: string
}

export interface Session {
  id: string
  workspaceId: string
  title: string
  model: SessionModel | null
  createdAt: number
  /** 创建、追加条目、改标题或换模型时更新；列表按它倒序。 */
  updatedAt: number
}

/** 待提交的 Session Entry。payload 的含义与校验由调用方（agent）负责，session 只按版本保存。 */
export interface NewSessionEntry {
  kind: string
  payloadVersion?: number
  payload: JsonValue
  runId?: string
}

/** 已提交、不可修改的 Session Entry；seq 在 Session 内从 1 开始连续递增。 */
export interface SessionEntry {
  sessionId: string
  seq: number
  kind: string
  payloadVersion: number
  payload: JsonValue
  runId: string | null
  createdAt: number
}

export interface SessionRepository {
  /** 登记目录；同一路径重复登记返回已有 Workspace。 */
  registerWorkspace(input: { path: string; name?: string }): Promise<Workspace>
  listWorkspaces(): Promise<Workspace[]>
  getWorkspace(id: string): Promise<Workspace | undefined>
  /** Workspace 不存在时以 not-found 拒绝。 */
  createSession(input: { workspaceId: string; title?: string; model?: SessionModel | null }): Promise<Session>
  /** 按 updatedAt 倒序；给出 workspaceId 时只列该 Workspace。 */
  listSessions(filter?: { workspaceId?: string }): Promise<Session[]>
  getSession(id: string): Promise<Session | undefined>
  setSessionTitle(id: string, title: string): Promise<Session>
  setSessionModel(id: string, model: SessionModel | null): Promise<Session>
  /** 一个事务内提交全部条目；返回时已提交。Session 不存在时以 not-found 拒绝。 */
  appendEntries(sessionId: string, entries: readonly NewSessionEntry[]): Promise<SessionEntry[]>
  /** 返回 seq 大于 afterSeq（默认 0）的条目，按 seq 升序。 */
  listEntries(sessionId: string, options?: { afterSeq?: number; limit?: number }): Promise<SessionEntry[]>
}

export interface Setting {
  key: string
  value: JsonValue
  /** 每次写入加 1；不存在的键视为 revision 0。 */
  revision: number
  updatedAt: number
}

export interface SettingsRepository {
  get(key: string): Promise<Setting | undefined>
  list(): Promise<Setting[]>
  /** expectedRevision 与当前 revision 不一致时以 revision-conflict 拒绝，details 带 expected 与 actual。 */
  set(key: string, value: JsonValue, expectedRevision: number): Promise<Setting>
}

export interface ProviderInput {
  name: string
  /** 预设类别，例如 deepseek、openai、anthropic、openai-compatible；取值由协议层校验。 */
  kind: string
  /** 模型协议，例如 openai-completions、openai-responses、anthropic-messages。 */
  api: string
  baseUrl: string
  models: string[]
}

/** Provider 配置；不含 Credential 密文，只给出是否已配置与提示（末四位）。 */
export interface Provider extends ProviderInput {
  id: string
  credential: { hint: string } | null
  createdAt: number
  updatedAt: number
}

export interface ProviderRepository {
  list(): Promise<Provider[]>
  get(id: string): Promise<Provider | undefined>
  create(input: ProviderInput): Promise<Provider>
  update(id: string, patch: Partial<ProviderInput>): Promise<Provider>
  /** 同时删除其 Credential 密文。 */
  delete(id: string): Promise<void>
  /** 保存 main 加密后的密文与提示；明文不经过 session。 */
  setCredential(id: string, credential: { ciphertext: Uint8Array; hint: string }): Promise<Provider>
  clearCredential(id: string): Promise<Provider>
  getCredentialCiphertext(id: string): Promise<Uint8Array | undefined>
}

/** 一组共享同一存储的仓库。 */
export interface SessionStore {
  sessions: SessionRepository
  settings: SettingsRepository
  providers: ProviderRepository
  /** 幂等；关闭后所有操作以 closed 拒绝。 */
  close(): Promise<void>
}

export interface StoreOptions {
  /** 时钟，默认 Date.now；测试注入以得到确定的时间戳。 */
  now?: () => number
}
