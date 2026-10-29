import type { PayloadRegistry } from './payloads.ts'

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

/** 待提交的 Session Entry。payload 的含义由 agent 定义，经 PayloadRegistry 校验后按版本保存。 */
export interface NewSessionEntry {
  kind: string
  /** 默认为该 kind 的当前版本。 */
  payloadVersion?: number
  payload: JsonValue
  runId?: string
}

/**
 * 已提交、不可修改的 Session Entry；seq 在 Session 内从 1 开始连续递增。listEntries 返回的 payload 已迁移到当前版本；
 * 迁移后仍不合格的条目被跳过，因此读回的 seq 可能有空缺。
 */
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
  /**
   * 一个事务内提交全部条目；返回时已提交，返回值是写入时的原样记录。Session 不存在时以 not-found 拒绝；
   * 任一条目不合注册的 schema 时以 invalid-payload 拒绝，整批不提交。
   */
  appendEntries(sessionId: string, entries: readonly NewSessionEntry[]): Promise<SessionEntry[]>
  /**
   * 返回 seq 大于 afterSeq（默认 0）的条目，按 seq 升序，payload 迁移到当前版本。不合格的条目不返回、交给
   * onInvalidEntry，库中保留。limit 按存储中的条目计数，跳过的条目也占名额。
   */
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

/** Provider 配置；字段取值（ID 格式、协议、Model Catalog 的结构）由协议层与宿主校验，session 原样保存。 */
export interface ProviderInput {
  /** 调用方给出的主键（用户输入的 Provider ID），创建后不可修改。 */
  id: string
  name: string
  /** 模型协议，例如 openai-completions、openai-responses、anthropic-messages。 */
  api: string
  baseUrl: string
  /** Model Catalog：每个模型的配置，按 JSON 保存并原样读回。 */
  models: JsonValue[]
}

/** Provider 配置；不含 Credential 密文，只给出是否已配置与提示（末四位）。 */
export interface Provider extends ProviderInput {
  credential: { hint: string } | null
  createdAt: number
  updatedAt: number
}

export interface ProviderRepository {
  list(): Promise<Provider[]>
  get(id: string): Promise<Provider | undefined>
  /** ID 已被使用时以 already-exists 拒绝，已有记录不变。 */
  create(input: ProviderInput): Promise<Provider>
  /** ID 不可修改。 */
  update(id: string, patch: Partial<Omit<ProviderInput, 'id'>>): Promise<Provider>
  /** 同时删除其 Credential 密文。 */
  delete(id: string): Promise<void>
  /** 保存 main 加密后的密文与提示；明文不经过 session。 */
  setCredential(id: string, credential: { ciphertext: Uint8Array; hint: string }): Promise<Provider>
  clearCredential(id: string): Promise<Provider>
  getCredentialCiphertext(id: string): Promise<Uint8Array | undefined>
}

/** Memory 的作用域：用户级（全部 Workspace）或某个 Workspace。 */
export type MemoryScope = 'user' | 'workspace'

/** Agent 或用户记下的一条记忆（ADR 0003）。workspace 作用域时 workspaceId 为该 Workspace，user 作用域时为 null。 */
export interface Memory {
  id: string
  scope: MemoryScope
  workspaceId: string | null
  content: string
  /** 写入方，例如 agent / user；取值由宿主约定。 */
  source: string
  createdAt: number
  updatedAt: number
}

export interface MemoryInput {
  scope: MemoryScope
  /** workspace 作用域必填，user 作用域必须省略或为 null（否则 invalid-input）。 */
  workspaceId?: string | null
  content: string
  source: string
}

export interface MemoryRepository {
  /** 按 updatedAt 倒序。给出 scope 时只列该作用域；workspaceId 限定 workspace 作用域的 Workspace。 */
  list(filter?: { scope?: MemoryScope; workspaceId?: string }): Promise<Memory[]>
  get(id: string): Promise<Memory | undefined>
  /** workspace 作用域的 Workspace 不存在时 not-found；作用域与 workspaceId 不一致时 invalid-input。 */
  create(input: MemoryInput): Promise<Memory>
  /** 只改正文；不存在时 not-found。 */
  update(id: string, patch: { content: string }): Promise<Memory>
  /** 不存在时 not-found。 */
  delete(id: string): Promise<void>
}

/** 登记的 Secret：名称与提示（末四位）；密文只经 getCiphertext 读取（ADR 0007）。 */
export interface SecretInfo {
  name: string
  hint: string
  updatedAt: number
}

export interface SecretRepository {
  /** 按名称升序；不含密文。 */
  list(): Promise<SecretInfo[]>
  /** 新增或替换；明文不经过 session。 */
  setCiphertext(name: string, secret: { ciphertext: Uint8Array; hint: string }): Promise<SecretInfo>
  getCiphertext(name: string): Promise<Uint8Array | undefined>
  /** 不存在时 not-found。 */
  delete(name: string): Promise<void>
}

/** 一组共享同一存储的仓库。 */
export interface SessionStore {
  sessions: SessionRepository
  settings: SettingsRepository
  providers: ProviderRepository
  memories: MemoryRepository
  secrets: SecretRepository
  /** 幂等；关闭后所有操作以 closed 拒绝。 */
  close(): Promise<void>
}

/** 读取时被跳过的条目；不含 payload。 */
export interface InvalidEntry {
  sessionId: string
  seq: number
  kind: string
  payloadVersion: number
  reason: string
}

export interface StoreOptions {
  /** 时钟，默认 Date.now；测试注入以得到确定的时间戳。 */
  now?: () => number
  /** Session Entry 的 payload 注册表，由宿主装配（agent 定义各 kind）。 */
  payloads: PayloadRegistry
  /** 读取时跳过不合格条目的报告（宿主记 warn）；默认不报告。 */
  onInvalidEntry?: (entry: InvalidEntry) => void
}
