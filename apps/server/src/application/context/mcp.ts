// MCP（docs/subsystems/mcp.md）：McpManager 按 (Workspace, Server) 池化连接，Workspace 的第一个 Run 开始时并发连接（单个 30 秒超时，
// 失败不阻止 Run，该 Server 的工具缺席），之后的 Run 复用；全局配置为设置键 mcp.servers，项目配置为 <Workspace>/.mcp.json（须按摘要批准，
// 不能引用 Secret，同名被全局遮蔽，ADR 0007、0008）。配置、批准或 Secret 改变、Server 停用时关闭受影响的连接；有序关闭时在存储之前关闭全部连接。
// HTTP 视图与管理（view、updateServers、approve、reconnect）在 mcp-admin.ts。
// 资源与提示模板：有已连接的 Server 声明 resources 时注册三个资源工具（权限类 context-read）；声明 prompts 的 Server 的提示模板以
// /mcp__<server>__<prompt> 登记到命令目录（列表按连接缓存，prompts/list_changed 或重连后重新列出；列命令目录与提交消息时同样先连接）。
import { readFile as readFileFs } from 'node:fs/promises'
import { join } from 'node:path'
import {
  createMcpResourceTools,
  DEFAULT_MCP_TIMEOUT_SECONDS,
  createMcpTools,
  createMcpToolName,
  diagnostic,
  expandSecretRefs,
  getMcpPrompt,
  listMcpPrompts,
  mapPromptArguments,
  McpConnection,
  McpResultError,
  promptMessagesToText,
  type CokoTool,
  type McpPrompt,
  parseMcpServers,
  parseProjectMcpFile,
  secretRefsOf,
  serverNamesConflict,
  type CapabilityConfig,
  type McpServerConfig,
  type McpServerEntry,
  type McpTransportHandle,
  type ResourceDiagnostic,
} from '@coko/agent'
import { getLogger } from '@coko/logging'
import { MCP_SERVERS_SETTING, mcpApprovalsSettingKey, PROJECT_MCP_PATH, type McpServerStatus } from '@coko/protocol'
import type { SessionStore } from '@coko/session'
import { AppError } from '../errors.ts'
import type { SecretService } from '../secrets.ts'
import type { ContextContribution, ContextContributionOptions, ContextScope, SourcedCommand } from './types.ts'

const log = getLogger(['application', 'mcp'])

export interface McpManagerOptions {
  store: SessionStore
  /** 有效能力配置（mcp.enabled，含项目 .coko/settings.json 的收紧）。 */
  config: { effective(workspacePath?: string): Promise<CapabilityConfig> }
  secrets: Pick<SecretService, 'resolve' | 'redact' | 'redactValues' | 'onChange'>
  /** 建立传输（adapters/mcp.ts）；config 中的 ${NAME} 已展开。 */
  createTransport: (config: McpServerConfig, options: { cwd: string }) => McpTransportHandle
  /** 测试覆盖（缺省 30 秒、1/2/4 秒）。 */
  connectTimeoutMs?: number
  reconnectDelaysMs?: readonly number[]
  clientInfo?: { name: string; version: string }
  /** 读取项目 .mcp.json（测试计数）；缺省 node:fs。 */
  readFile?: (path: string) => Promise<string>
}

interface Pooled {
  workspaceId: string
  entry: McpServerEntry
  connection: McpConnection
  /** prompts/list 的缓存：取得时连接的列表版本（listRevision('prompts')）。 */
  prompts?: { revision: number; listing: Promise<McpPrompt[]> }
  /** 最近一次列出或调用提示模板时的诊断（不合 schema、重复 cursor 等），按 code 去重。 */
  runtimeDiagnostics: Map<string, ResourceDiagnostic>
}

/** 一次读取的配置：全局与项目 Server、诊断、批准与有效的 mcp.enabled。 */
export interface LoadedMcpConfig {
  entries: McpServerEntry[]
  diagnostics: ResourceDiagnostic[]
  approvals: Record<string, string>
  approvalsRevision: number
  enabled: boolean
  project?: { path: string; exists: boolean }
  globalRaw: Record<string, unknown>
  globalRevision: number
}
type Loaded = LoadedMcpConfig

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const keyOf = (workspaceId: string, name: string) => `${workspaceId}\0${name}`
const message = (error: unknown) => (error instanceof Error ? error.message : String(error))
const timeoutMsOf = (config: McpServerConfig) => (config.timeout ?? DEFAULT_MCP_TIMEOUT_SECONDS) * 1000

/** 该 Server 的静态状态：能力或 Server 停用为 disabled，项目 Server 未按当前摘要批准为 pending-approval；应当连接时 undefined。 */
export function staticMcpStatus(entry: McpServerEntry, loaded: LoadedMcpConfig): McpServerStatus | undefined {
  if (!loaded.enabled || entry.config.enabled === false) return 'disabled'
  if (entry.scope === 'project' && loaded.approvals[entry.name] !== entry.digest) return 'pending-approval'
  return undefined
}

/** 该 Server 是否应当连接：能力与 Server 开启，项目 Server 已按当前摘要批准。 */
const desired = (entry: McpServerEntry, loaded: LoadedMcpConfig) => staticMcpStatus(entry, loaded) === undefined

/** 一个 Run 的 MCP 工具：Server 的工具（权限类 external）、资源工具（context-read）与配置诊断。 */
export interface McpRunTools {
  tools: CokoTool[]
  resources: CokoTool[]
  diagnostics: ResourceDiagnostic[]
}

export class McpManager {
  readonly #options: McpManagerOptions
  readonly #pool = new Map<string, Pooled>()
  #closed = false

  constructor(options: McpManagerOptions) {
    this.#options = options
    // 登记、替换或删除 Secret：引用它的连接关闭，下一个 Run（或重连）以新值启动。
    options.secrets.onChange((name) => {
      for (const [key, pooled] of this.#pool) if (secretRefsOf(pooled.entry.config).includes(name)) void this.#drop(key)
    })
  }

  // ---- 读取配置 ----

  async #global(): Promise<{ raw: Record<string, unknown>; revision: number }> {
    const setting = await this.#options.store.settings.get(MCP_SERVERS_SETTING)
    if (!setting) return { raw: {}, revision: 0 }
    if (!isRecord(setting.value)) {
      log.warn('mcp servers setting ignored: not an object', { revision: setting.revision })
      return { raw: {}, revision: setting.revision }
    }
    return { raw: setting.value, revision: setting.revision }
  }

  /** 读取全局配置、该 Workspace 的 .mcp.json 与批准、有效配置（各一次）。 */
  async load(workspace?: { id: string; path: string }): Promise<LoadedMcpConfig> {
    const global = await this.#global()
    const parsedGlobal = parseMcpServers(global.raw, { scope: 'global' })
    const entries = [...parsedGlobal.entries]
    const diagnostics = [...parsedGlobal.diagnostics]
    const effective = await this.#options.config.effective(workspace?.path)
    let approvals: Record<string, string> = {}
    let approvalsRevision = 0
    let project: Loaded['project']
    if (workspace) {
      const path = join(workspace.path, PROJECT_MCP_PATH)
      const read = this.#options.readFile ?? ((file: string) => readFileFs(file, 'utf8'))
      const text = await read(path).catch((error: NodeJS.ErrnoException) => (error.code === 'ENOENT' ? undefined : error))
      project = { path, exists: text !== undefined }
      if (text instanceof Error) diagnostics.push(diagnostic('mcp', 'read-failed', `Cannot read file: ${text.message}`, path))
      else if (text !== undefined) {
        const parsed = parseProjectMcpFile(text, { path, globalNames: parsedGlobal.entries.map((e) => e.name) })
        diagnostics.push(...parsed.diagnostics)
        for (const entry of parsed.entries) {
          const clash = parsedGlobal.entries.find((g) => serverNamesConflict(g.name, entry.name))
          if (clash) diagnostics.push(diagnostic('mcp', 'name-conflict', `server "${entry.name}" conflicts with global server "${clash.name}"`, path))
          else entries.push(entry)
        }
      }
      const setting = await this.#options.store.settings.get(mcpApprovalsSettingKey(workspace.id))
      if (setting) {
        approvalsRevision = setting.revision
        if (isRecord(setting.value))
          approvals = Object.fromEntries(Object.entries(setting.value).filter((pair): pair is [string, string] => typeof pair[1] === 'string'))
      }
    }
    return {
      entries,
      diagnostics,
      approvals,
      approvalsRevision,
      enabled: effective.mcp.enabled,
      ...(project ? { project } : {}),
      globalRaw: global.raw,
      globalRevision: global.revision,
    }
  }

  /** 关闭该 Workspace 中不再应当连接或配置已改变的连接。 */
  async reconcile(workspaceId: string, loaded: Loaded): Promise<void> {
    const closing: Promise<void>[] = []
    for (const [key, pooled] of this.#pool) {
      if (pooled.workspaceId !== workspaceId) continue
      const entry = loaded.entries.find((e) => e.name === pooled.entry.name && e.scope === pooled.entry.scope)
      if (!entry || entry.digest !== pooled.entry.digest || !desired(entry, loaded)) closing.push(this.#drop(key))
      else pooled.entry = entry
    }
    await Promise.all(closing)
  }

  async #drop(key: string): Promise<void> {
    const pooled = this.#pool.get(key)
    if (!pooled) return
    this.#pool.delete(key)
    await pooled.connection.close()
    log.info('mcp server closed', { workspaceId: pooled.workspaceId, server: pooled.entry.name })
  }

  #pooled(workspaceId: string, cwd: string, entry: McpServerEntry): Pooled {
    const key = keyOf(workspaceId, entry.name)
    const existing = this.#pool.get(key)
    if (existing) return existing
    const { secrets } = this.#options
    const connection = new McpConnection({
      name: entry.name,
      root: cwd,
      ...(this.#options.connectTimeoutMs ? { connectTimeoutMs: this.#options.connectTimeoutMs } : {}),
      ...(this.#options.reconnectDelaysMs ? { reconnectDelaysMs: this.#options.reconnectDelaysMs } : {}),
      ...(this.#options.clientInfo ? { clientInfo: this.#options.clientInfo } : {}),
      redact: (text) => secrets.redact(text),
      createTransport: async () => {
        // 启动或连接时才展开 Secret；未登记的名字使该 Server 失败，不回退到进程环境（ADR 0007）。
        const current = this.#pool.get(key)?.entry ?? entry
        const expanded = await expandSecretRefs(current.config, (name) => secrets.resolve(name))
        if (!expanded.ok) throw new Error(`Secret ${expanded.missing.join(', ')} is not registered; add it under Settings → MCP → Secrets`)
        return this.#options.createTransport(expanded.config, { cwd })
      },
    })
    let lastStatus = connection.status
    connection.onChange(() => {
      // onChange 也在工具或列表版本变化时触发；只在状态改变时记日志。
      if (connection.status === lastStatus) return
      lastStatus = connection.status
      if (connection.status === 'failed') log.warn('mcp server failed', { workspaceId, server: entry.name, error: connection.error ?? '' })
      else if (connection.status === 'connected') log.info('mcp server connected', { workspaceId, server: entry.name, tools: connection.tools.length })
    })
    const pooled: Pooled = { workspaceId, entry, connection, runtimeDiagnostics: new Map() }
    this.#pool.set(key, pooled)
    return pooled
  }

  /** 连接该 Workspace 应当连接、尚未连接（idle）的 Server；正在连接的等待其结束。失败的不自动重试（需手动重连）。 */
  async #ensure(workspaceId: string, cwd: string, loaded: Loaded): Promise<void> {
    if (this.#closed) return
    await Promise.all(
      loaded.entries
        .filter((entry) => desired(entry, loaded))
        .map((entry) => {
          const { connection } = this.#pooled(workspaceId, cwd, entry)
          return connection.status === 'idle' || connection.status === 'connecting' ? connection.connect() : Promise.resolve()
        }),
    )
  }

  /** 在后台连接该 Workspace 应当连接的 Server（配置保存或批准之后）。 */
  connectInBackground(workspaceId: string, cwd: string, loaded: Loaded): void {
    void this.#ensure(workspaceId, cwd, loaded).catch((error: unknown) => log.warn('mcp background connect failed', { workspaceId, error: message(error) }))
  }

  // ---- 运行时 ----

  /**
   * 一个 Run 的 MCP 工具与诊断（配置只读取一次）。连接失败不抛出。资源工具只在本 Run 开始时有已连接的 Server 声明 resources 时
   * 注册；调用时按池中当前连接查找，只覆盖本 Run 加载的 Server。
   */
  async runTools(scope: { workspaceId: string; cwd: string }): Promise<McpRunTools> {
    const loaded = await this.load({ id: scope.workspaceId, path: scope.cwd })
    await this.reconcile(scope.workspaceId, loaded)
    if (!loaded.enabled) return { tools: [], resources: [], diagnostics: loaded.diagnostics }
    await this.#ensure(scope.workspaceId, scope.cwd, loaded)
    const tools: CokoTool[] = []
    for (const entry of loaded.entries) {
      const pooled = this.#pool.get(keyOf(scope.workspaceId, entry.name))
      if (pooled?.connection.status === 'connected') tools.push(...createMcpTools(pooled.connection, { config: entry.config }))
    }
    const entries = loaded.entries.filter((entry) => desired(entry, loaded))
    const servers = () =>
      entries.flatMap((entry) => {
        const pooled = this.#pool.get(keyOf(scope.workspaceId, entry.name))
        return pooled?.connection.status === 'connected' ? [{ connection: pooled.connection, timeoutMs: timeoutMsOf(entry.config) }] : []
      })
    const resources = servers().some((s) => s.connection.capabilities?.resources) ? createMcpResourceTools({ servers }) : []
    return { tools, resources, diagnostics: loaded.diagnostics }
  }

  #recordDiagnostics(pooled: Pooled, kind: string, diagnostics: readonly ResourceDiagnostic[]): void {
    for (const key of pooled.runtimeDiagnostics.keys()) if (key.startsWith(`${kind}:`)) pooled.runtimeDiagnostics.delete(key)
    for (const d of diagnostics) {
      pooled.runtimeDiagnostics.set(`${kind}:${d.code}`, d)
      log.warn('mcp result diagnostic', { workspaceId: pooled.workspaceId, server: pooled.entry.name, code: d.code, message: d.message })
    }
  }

  /** 已连接 Server 的提示模板（缓存到 prompts/list_changed 或重连）。列出失败只记 warn，返回空。 */
  #prompts(pooled: Pooled): Promise<McpPrompt[]> {
    const { connection } = pooled
    const revision = connection.listRevision('prompts')
    if (pooled.prompts?.revision === revision) return pooled.prompts.listing
    const listing = listMcpPrompts(connection, { timeoutMs: timeoutMsOf(pooled.entry.config) }).then(
      (listed) => {
        this.#recordDiagnostics(pooled, 'prompts/list', listed.diagnostics)
        return listed.items
      },
      (error: unknown) => {
        log.warn('mcp prompts/list failed', { workspaceId: pooled.workspaceId, server: pooled.entry.name, error: message(error) })
        // 失败不缓存：下一次重新请求。
        if (pooled.prompts?.listing === listing) pooled.prompts = undefined
        return [] as McpPrompt[]
      },
    )
    pooled.prompts = { revision, listing }
    return listing
  }

  /**
   * 命令目录的 MCP 来源：该 Workspace 已连接、声明 prompts 的 Server 的提示模板，名字 /mcp__<server>__<prompt>。
   * 与 Run 开始时一样先连接应当连接的 Server（失败的不重试）。
   */
  async promptCommands(scope: { workspaceId: string; cwd: string }): Promise<SourcedCommand[]> {
    const loaded = await this.load({ id: scope.workspaceId, path: scope.cwd })
    await this.reconcile(scope.workspaceId, loaded)
    if (!loaded.enabled) return []
    await this.#ensure(scope.workspaceId, scope.cwd, loaded)
    const commands: SourcedCommand[] = []
    for (const entry of loaded.entries) {
      const pooled = this.#pool.get(keyOf(scope.workspaceId, entry.name))
      if (pooled?.connection.status !== 'connected' || !pooled.connection.capabilities?.prompts) continue
      const taken = new Set<string>()
      for (const prompt of await this.#prompts(pooled)) {
        const name = createMcpToolName(entry.name, prompt.name, (candidate) => taken.has(candidate))
        taken.add(name)
        commands.push(this.#promptCommand(scope.workspaceId, entry.name, name, prompt))
      }
    }
    return commands
  }

  #promptCommand(workspaceId: string, server: string, name: string, prompt: McpPrompt): SourcedCommand {
    const args = prompt.arguments ?? []
    const argumentHint = args.map((a) => (a.required ? `<${a.name}>` : `[${a.name}]`)).join(' ')
    return {
      name,
      description: prompt.description?.trim() || prompt.title || `MCP prompt ${prompt.name} from server ${server}`,
      ...(argumentHint ? { argumentHint } : {}),
      source: 'mcp',
      expand: async (text: string) => {
        const mapped = mapPromptArguments(prompt, text)
        if (mapped.missing.length > 0)
          throw new AppError('bad-request', `/${name} requires ${mapped.missing.join(', ')}`, { reason: 'missing-arguments', missing: mapped.missing })
        const pooled = this.#pool.get(keyOf(workspaceId, server))
        if (pooled?.connection.status !== 'connected') throw new AppError('bad-request', `MCP server ${server} is not connected`, { reason: 'not-connected' })
        try {
          const result = await getMcpPrompt(pooled.connection, prompt.name, mapped.arguments, { timeoutMs: timeoutMsOf(pooled.entry.config) })
          this.#recordDiagnostics(pooled, `prompts/get ${prompt.name}`, [])
          // 展开文本进入 user message 条目：先替换已登记 Secret 的明文（与工具结果相同，ADR 0007）。
          return this.#options.secrets.redactValues(promptMessagesToText(result.messages))
        } catch (error) {
          if (error instanceof McpResultError) {
            this.#recordDiagnostics(pooled, `prompts/get ${prompt.name}`, [error.diagnostic])
            throw new AppError('bad-request', error.message, { reason: 'invalid-result' })
          }
          const reason = this.#options.secrets.redact(message(error))
          log.warn('mcp prompts/get failed', { workspaceId, server, prompt: prompt.name, error: reason })
          throw new AppError('bad-request', `MCP prompt ${prompt.name} from ${server} failed: ${reason}`, { reason: 'request-failed' })
        }
      },
    }
  }

  /** 该 Workspace 各连接最近的结果诊断（提示模板列表与调用）。 */
  runtimeDiagnostics(workspaceId: string): ResourceDiagnostic[] {
    return [...this.#pool.values()].filter((p) => p.workspaceId === workspaceId).flatMap((p) => [...p.runtimeDiagnostics.values()])
  }

  /** 配置诊断与结果诊断（上下文用量接口）；不连接。 */
  async diagnostics(scope: { workspaceId: string; cwd: string }): Promise<ResourceDiagnostic[]> {
    return [...(await this.load({ id: scope.workspaceId, path: scope.cwd })).diagnostics, ...this.runtimeDiagnostics(scope.workspaceId)]
  }

  /** 池中该 Server 的连接（没有时 undefined）。 */
  connection(workspaceId: string, name: string): McpConnection | undefined {
    return this.#pool.get(keyOf(workspaceId, name))?.connection
  }

  /** 关闭并重新连接一个应当连接的 Server（不在池中时先建立），等待连接结束。 */
  async restart(workspaceId: string, cwd: string, entry: McpServerEntry): Promise<void> {
    await this.#pooled(workspaceId, cwd, entry).connection.reconnect()
  }

  /** 池中有连接的 Workspace。 */
  workspaceIds(): Set<string> {
    return new Set([...this.#pool.values()].map((p) => p.workspaceId))
  }

  /** 有序关闭：关闭全部连接（stdio：关 stdin → SIGTERM → SIGKILL）。 */
  async close(): Promise<void> {
    this.#closed = true
    await Promise.all([...this.#pool.keys()].map((key) => this.#drop(key)))
  }
}

export function mcpContribution(options: ContextContributionOptions): ContextContribution {
  const manager = options.mcp
  if (!manager) return { name: 'mcp' }
  return {
    name: 'mcp',
    async tools(scope) {
      const { tools, resources } = await manager.runTools(scope)
      return [
        ...tools.map((tool) => ({ tool, permissionClass: 'external' as const })),
        ...resources.map((tool) => ({ tool, permissionClass: 'context-read' as const })),
      ]
    },
    commandSources: [{ source: 'mcp', list: (scope: ContextScope) => manager.promptCommands(scope) }],
    async report(scope) {
      return { diagnostics: await manager.diagnostics(scope) }
    },
    close: () => manager.close(),
  }
}
