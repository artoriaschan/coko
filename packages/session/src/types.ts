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

/** Project 只组织会话；主要目录对应唯一的 Workspace，附加目录保持用户给定顺序。 */
export interface Project {
  id: string
  name: string
  primaryWorkspaceId: string
  additionalFolders: string[]
  /** 主要文件夹在完整有序列表中的位置；旧项目为 0。 */
  primaryFolderIndex: number
  pinnedAt: number | null
  createdAt: number
}
export interface NewProject {
  name: string
  primaryWorkspaceId: string
  additionalFolders?: string[]
  primaryFolderIndex?: number
}
export type ProjectPatch = Partial<Pick<Project, 'name' | 'primaryWorkspaceId' | 'additionalFolders' | 'primaryFolderIndex' | 'pinnedAt'>>
export interface ProjectRepository {
  create(input: NewProject): Promise<Project>
  get(id: string): Promise<Project | undefined>
  list(): Promise<Project[]>
  update(id: string, patch: ProjectPatch): Promise<Project>
  /** 只移除组织关系，保留会话与执行资源；调用方先停止运行。 */
  delete(id: string): Promise<void>
}
export type SessionOrganization = Pick<Session, 'projectId' | 'pinnedAt' | 'archivedAt'>

/** Session 当前使用的模型。 */
export interface SessionModel {
  providerId: string
  modelId: string
}

/** 七档 Thinking Level，顺序固定（与 @coko/protocol 的 ThinkingLevel 相同；apps/server 编译期比对）。 */
export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const
export type ThinkingLevel = (typeof THINKING_LEVELS)[number]

/** 一起写入 Session 的模型与 Thinking Level；model 为 null 或未给档位时档位为 off。 */
export interface SessionModelChoice {
  model: SessionModel | null
  thinkingLevel?: ThinkingLevel
}

export interface Session {
  id: string
  workspaceId: string
  title: string
  /** 只在根 Session 保存；子 Session 的归属由根会话派生。 */
  projectId: string | null
  pinnedAt: number | null
  archivedAt: number | null
  model: SessionModel | null
  /** 与模型一起保存的 Thinking Level；新建默认 off，清空模型时回到 off。库中不是七档之一的值读回为 off。 */
  thinkingLevel: ThinkingLevel
  /**
   * 模型字段被清空（Provider 被删除或升级时清除）：宿主在下次运行前要求重新选择模型。从未设置模型时为 false；
   * setSessionModel 后为 false。
   */
  modelCleared: boolean
  /** 子 Session（子代理）的父 Session；根 Session 为 null。 */
  parentSessionId: string | null
  /** 创建时绑定的 worktree（ADR 0016）；没有绑定为 null。 */
  worktreeId: string | null
  createdAt: number
  /** 创建或追加条目时更新；组织、标题与模型修改不改变最后记录时间。 */
  updatedAt: number
}

/** 新建 Session 的输入。parentSessionId、worktreeId 必须指向同一 Workspace 中已有的记录。 */
export interface NewSession extends Partial<SessionModelChoice> {
  /** 宿主创建的幂等会话标识；未给时分配随机 ID。不是用户可设置的协议字段。 */
  id?: string
  workspaceId: string
  title?: string
  /** 未给时继承主要 Workspace 对应的项目；null 明确表示独立对话。 */
  projectId?: string | null
  parentSessionId?: string | null
  worktreeId?: string | null
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
  /**
   * Workspace、父 Session 或 worktree 不存在时以 not-found 拒绝；父 Session 或 worktree 属于其他 Workspace 时以 invalid-input 拒绝。
   */
  createSession(input: NewSession): Promise<Session>
  /** 按 updatedAt 倒序；给出 workspaceId 时只列该 Workspace。不含子 Session（见 listChildren）。 */
  listSessions(filter?: { workspaceId?: string }): Promise<Session[]>
  /** 该 Session 的子 Session，按创建顺序。 */
  listChildren(parentSessionId: string): Promise<Session[]>
  getSession(id: string): Promise<Session | undefined>
  /** 原子删除会话树及条目、定时任务和进程登记；保留 Workspace 与 worktree。调用方先停止运行。 */
  deleteSession(id: string): Promise<string[]>
  /** 仅在没有任何会话、项目、worktree 或记忆引用时移除登记，不操作文件系统。 */
  deleteWorkspaceIfUnused(id: string): Promise<boolean>
  setSessionTitle(id: string, title: string): Promise<Session>
  /** Atomically replace an unchanged placeholder; missing/deleted sessions return undefined. */
  replaceSessionTitle(id: string, expected: string, title: string): Promise<Session | undefined>
  setSessionOrganization(id: string, patch: Partial<SessionOrganization>): Promise<Session>
  /** 模型与 Thinking Level 一起写入；thinkingLevel 缺省或 model 为 null 时为 off。 */
  setSessionModel(id: string, choice: SessionModelChoice): Promise<Session>
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

/** main 加密后的 Credential 密文与末四位提示；明文不经过 session。 */
export interface CredentialRecord {
  ciphertext: Uint8Array
  hint: string
}

export interface ProviderReferences {
  sessions: number
}

/**
 * 删除 Provider 时在同一事务中改写的一项设置：键存在且 when(当前值) 为 true 时写入 value（revision 加 1）。设置的业务含义由
 * 调用方定义；when 在事务中同步调用，抛出时整个删除回滚。
 */
export interface SettingRewrite {
  key: string
  when: (value: JsonValue) => boolean
  value: JsonValue
}

export interface ProviderDeleted extends ProviderReferences {
  /** 被改写的设置键。 */
  settings: string[]
}

export interface ProviderRepository {
  list(): Promise<Provider[]>
  get(id: string): Promise<Provider | undefined>
  /** ID 已被使用时以 already-exists 拒绝，已有记录不变。给出 credential 时与配置在同一事务中写入（ADR 0010）。 */
  create(input: ProviderInput, credential?: CredentialRecord): Promise<Provider>
  /** ID 不可修改。给出 credential 时在同一事务中替换密文；不给出时保留原 Credential。 */
  update(id: string, patch: Partial<Omit<ProviderInput, 'id'>>, credential?: CredentialRecord): Promise<Provider>
  /** 引用该 Provider 的 Session 数量（删除前的确认用）；不存在时 not-found。 */
  references(id: string): Promise<ProviderReferences>
  /**
   * 在一个事务中删除 Provider 与其 Credential 密文，清空引用它的 Session 的模型字段（档位回到 off，不改 updatedAt），并按
   * options.settings 改写设置。以后用相同 ID 重新创建，这些引用也不会恢复。返回被清空的 Session 数量与被改写的设置键。
   */
  delete(id: string, options?: { settings?: readonly SettingRewrite[] }): Promise<ProviderDeleted>
  /** 保存 main 加密后的密文与提示；明文不经过 session。 */
  setCredential(id: string, credential: CredentialRecord): Promise<Provider>
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
  /**
   * 按关键词检索（空白分隔的词全部出现）：FTS5 可用时按相关度（bm25），否则（或词短于 3 个字符时）大小写不敏感的子串匹配，按
   * updatedAt 倒序。limit 缺省 20；给出 scope / workspaceId 时与 list 的过滤相同。查询为空时返回空数组。
   */
  search(query: string, options?: MemorySearchOptions): Promise<Memory[]>
}

export interface MemorySearchOptions {
  scope?: MemoryScope
  workspaceId?: string
  limit?: number
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

/** 宿主启动的子进程的种类：前台 bash、后台 Job、PTY Job、stdio MCP Server、外部 Hook 命令、宿主执行的 git、语言服务器。 */
export type HostProcessKind = 'bash' | 'job' | 'pty' | 'mcp' | 'hook' | 'git' | 'lsp'

export const HOST_PROCESS_KINDS: readonly HostProcessKind[] = ['bash', 'job', 'pty', 'mcp', 'hook', 'git', 'lsp']

/** 登记的子进程（ADR 0012）：进程存活期间存在，退出时删除；宿主启动时据此清理上次留下的孤儿。 */
export interface HostProcess {
  /** 调用方给出的登记 ID。 */
  id: string
  pid: number
  /** 进程组；有时按组终止（kill(-pgid)）。MCP 进程没有。 */
  pgid: number | null
  /** `ps -o lstart=` 的原文：同一 pid 被复用时据此区分。 */
  startedAt: string
  kind: HostProcessKind
  sessionId: string | null
  jobId: string | null
  command: string
  createdAt: number
}

export interface HostProcessInput {
  id: string
  pid: number
  pgid?: number | null
  startedAt: string
  kind: HostProcessKind
  sessionId?: string | null
  jobId?: string | null
  command: string
}

export interface ProcessRepository {
  /** 登记；同一 id 已存在时 already-exists，pid、pgid 不是正整数或 kind 未知时 invalid-input，均不写入。 */
  register(input: HostProcessInput): Promise<HostProcess>
  /** 删除登记；不存在时不报错（进程退出与启动清理可能先后删除同一行）。 */
  remove(id: string): Promise<void>
  /** 按登记顺序。 */
  list(): Promise<HostProcess[]>
}

export type WorktreeStatus = 'active' | 'removed'
export type WorktreeCreator = 'user' | 'subagent'
export const WORKTREE_CREATORS: readonly WorktreeCreator[] = ['user', 'subagent']

/** 宿主创建的 git worktree（ADR 0016）。path 为绝对路径，在全部记录中唯一（移除后仍占用）。 */
export interface WorktreeRecord {
  id: string
  workspaceId: string
  name: string
  path: string
  branch: string
  baseCommit: string
  repoRoot: string
  status: WorktreeStatus
  createdBy: WorktreeCreator
  createdAt: number
  removedAt: number | null
}

export interface NewWorktree {
  workspaceId: string
  name: string
  path: string
  branch: string
  baseCommit: string
  repoRoot: string
  createdBy: WorktreeCreator
}

export interface WorktreeRepository {
  /** Workspace 不存在时 not-found；path 已被使用时 already-exists；createdBy 未知时 invalid-input。均不写入。 */
  create(input: NewWorktree): Promise<WorktreeRecord>
  get(id: string): Promise<WorktreeRecord | undefined>
  /** 该 Workspace 的 worktree（含 removed），按创建顺序。 */
  list(workspaceId: string): Promise<WorktreeRecord[]>
  /** 标为 removed 并记录时间；已是 removed 时原样返回。不存在时 not-found。 */
  markRemoved(id: string): Promise<WorktreeRecord>
}

export type ScheduleStatus = 'active' | 'paused' | 'inactive'
export const SCHEDULE_STATUSES: readonly ScheduleStatus[] = ['active', 'paused', 'inactive']

/** 定时任务（ADR 0015）。rule 的含义由宿主定义（协议的 ScheduleRule），原样保存；nextAt / lastOccurrence 为 UTC 毫秒。 */
export interface ScheduleRecord {
  id: string
  sessionId: string
  title: string
  prompt: string
  rule: JsonValue
  status: ScheduleStatus
  nextAt: number | null
  lastOccurrence: number | null
  /** 创建为 1，每次 update 加 1；recordFire 不改变它。 */
  revision: number
  createdAt: number
  updatedAt: number
}

export interface NewSchedule {
  sessionId: string
  title: string
  prompt: string
  rule: JsonValue
  status?: ScheduleStatus
  nextAt: number | null
}

export type SchedulePatch = Partial<Pick<ScheduleRecord, 'title' | 'prompt' | 'rule' | 'status' | 'nextAt'>>

/** 一次投递或跳过的记录：本次到期时刻、下一次时刻（null 为不再到期）与可选的新状态（一次性任务投递后 inactive）。 */
export interface ScheduleFire {
  occurrence: number
  nextAt: number | null
  status?: ScheduleStatus
}

export interface ScheduleRepository {
  /** Session 不存在时 not-found；status 未知时 invalid-input。 */
  create(input: NewSchedule): Promise<ScheduleRecord>
  /** revision 不一致时 revision-conflict（details 带 expected 与 actual），不存在时 not-found；成功时 revision 加 1。 */
  update(id: string, revision: number, patch: SchedulePatch): Promise<ScheduleRecord>
  /** 不存在时 not-found。 */
  delete(id: string): Promise<void>
  /** 按 id 读一条；不存在时 undefined（不扫描全表）。 */
  get(id: string): Promise<ScheduleRecord | undefined>
  /** 按创建顺序；给出 sessionId 时只列该 Session。 */
  list(filter?: { sessionId?: string }): Promise<ScheduleRecord[]>
  /** active 且 nextAt ≤ now 的任务，按 nextAt 升序。 */
  due(now: number): Promise<ScheduleRecord[]>
  /**
   * 在一个事务中更新 lastOccurrence / nextAt（与可选的 status）并向任务所属 Session 追加 entry（通常为 schedule_fire）。
   * 任一步失败（任务不存在、entry 不合 schema 等）时表行与条目都不变。返回更新后的任务与已提交的条目。
   */
  recordFire(id: string, fire: ScheduleFire, entry: NewSessionEntry): Promise<{ schedule: ScheduleRecord; entry: SessionEntry }>
}

export type PluginSourceKind = 'dir' | 'git'
export const PLUGIN_SOURCE_KINDS: readonly PluginSourceKind[] = ['dir', 'git']

/** 已安装的插件（ADR 0017）：文件在 path（插件安装目录，全部记录中唯一），批准按 digest 保存。 */
export interface PluginRecord {
  name: string
  version: string
  sourceKind: PluginSourceKind
  sourceLocation: string
  sourceRef: string | null
  commit: string | null
  path: string
  digest: string
  approvedDigest: string | null
  enabled: boolean
  installedAt: number
  updatedAt: number
}

export interface PluginInput {
  name: string
  version: string
  sourceKind: PluginSourceKind
  sourceLocation: string
  sourceRef?: string | null
  commit?: string | null
  path: string
  digest: string
}

export interface PluginRepository {
  /** 按名字排序。 */
  list(): Promise<PluginRecord[]>
  get(name: string): Promise<PluginRecord | undefined>
  /**
   * 新建或更新（安装与"更新"）：新建时未批准、未启用；更新时保留已批准的 digest 与启用状态（digest 变化即回到待批准，由调用方派生）。
   * path 被另一个插件使用时 already-exists；sourceKind 未知时 invalid-input。
   */
  upsert(input: PluginInput): Promise<PluginRecord>
  /** 批准 digest 并启用；不存在时 not-found。digest 与当前不同由调用方判断。 */
  approve(name: string, digest: string): Promise<PluginRecord>
  /** 不存在时 not-found。 */
  setEnabled(name: string, enabled: boolean): Promise<PluginRecord>
  /** 不存在时 not-found。 */
  delete(name: string): Promise<void>
}

/** 一组共享同一存储的仓库。 */
export interface SessionStore {
  sessions: SessionRepository
  projects: ProjectRepository
  settings: SettingsRepository
  providers: ProviderRepository
  memories: MemoryRepository
  secrets: SecretRepository
  /** 宿主登记的子进程（ADR 0012）。 */
  processes: ProcessRepository
  /** 宿主创建的 git worktree（ADR 0016）。 */
  worktrees: WorktreeRepository
  /** 定时任务（ADR 0015）。 */
  schedules: ScheduleRepository
  /** 已安装的插件（ADR 0017）。 */
  plugins: PluginRepository
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
