// 代码智能（语言服务器，docs/subsystems/lsp.md）的应用服务。配置来源：全局设置 lsp.servers、Workspace 设置 lsp.workspaces.<id>.servers 与已启用插件的
// lspServers（名字 <plugin>:<server>）；同一扩展名多个服务器时 workspace > global > plugin，其余记 duplicate-extension。进程按（服务器，cwd）一个：
// 首次查询启动，空闲 idleMs（缺省 10 分钟）关闭，至多 maxProcesses（4）个、超过时关闭最久未用的；登记为 lsp（ADR 0012）；崩溃后下一次查询重启，
// 连续 3 次失败为 failed，手动重启清零。状态变化经 lsp_update 推给用过该进程的 Session。stderr 尾部与错误文本脱敏后才显示。
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  contextReadDenial,
  isProtectedPath,
  LSP_DIAGNOSTICS_WAIT_MS,
  pathContains,
  pluginResourceName,
  realLocation,
  resolveTarget,
  type LspDiagnostic,
  type LspPort,
  type LspQuery,
  type LspQueryResult,
  type PluginContributionsPort,
  type PluginLspServer,
} from '@coko/agent'
import { getLogger, redactText } from '@coko/logging'
import {
  LSP_SERVERS_SETTING,
  LspServerConfig,
  LspServersConfig,
  lspWorkspaceServersSetting,
  type LspResponse,
  type LspServerSource,
  type LspServerStatus,
  type ResourceDiagnostic,
  type UpdateLspRequest,
} from '@coko/protocol'
import type { JsonValue, SessionStore } from '@coko/session'
import { Value } from 'typebox/value'
import { createLspClient, type LspClient, type LspClientFactory } from '../adapters/lsp-client.ts'
import type { TrackProcess } from './processes.ts'
import type { ConfigService } from './config.ts'
import type { ContextScope } from './context/types.ts'
import { AppError, errorMessage } from './errors.ts'
import type { SessionHub } from './hub.ts'

const log = getLogger(['application', 'lsp'])

export const LSP_IDLE_MS = 10 * 60_000
export const LSP_MAX_PROCESSES = 4
/** 连续失败（启动失败，或启动后没有回答任何查询就退出）达到此数为 failed。 */
export const LSP_MAX_FAILURES = 3
/** 扩展名：点加字母数字（不支持多段，例如 .d.ts 按 .ts 匹配）。 */
const EXTENSION = /^\.[A-Za-z0-9_+-]+$/

/** 合并后的一个服务器。 */
interface ResolvedServer {
  name: string
  source: LspServerSource
  config: LspServerConfig
  /** 未被更高来源占用的扩展名（含点）。 */
  extensions: string[]
  digest: string
}

interface Resolution {
  servers: ResolvedServer[]
  global: { servers: LspServersConfig; revision: number; diagnostics: ResourceDiagnostic[] }
  workspace?: { workspaceId: string; servers: LspServersConfig; revision: number; diagnostics: ResourceDiagnostic[] }
}

interface Proc {
  key: string
  server: ResolvedServer
  cwd: string
  workspaceId: string
  state: LspServerStatus['state']
  client?: LspClient
  starting?: Promise<LspClient>
  failures: number
  /** 本次启动之后是否回答过查询（启动后没有回答就退出算一次失败）。 */
  answered: boolean
  stopping: boolean
  lastUsed: number
  idle?: ReturnType<typeof setTimeout>
  sessions: Set<string>
  documents: Map<string, number>
  waiters: Map<string, ((diagnostics: LspDiagnostic[]) => void)[]>
  stderrTail?: string
  error?: string
}

export interface LspServiceOptions {
  config: Pick<ConfigService, 'effective'>
  store?: Pick<SessionStore, 'settings' | 'sessions'>
  plugins?: Pick<PluginContributionsPort, 'snapshot'> & Partial<Pick<PluginContributionsPort, 'onChange'>>
  hub?: Pick<SessionHub, 'publishProgress'>
  /** Sidecar 环境（剔除 HOST_ENV_EXCLUSIONS 后传给服务器）。 */
  env?: Readonly<Record<string, string | undefined>>
  track?: TrackProcess
  createClient?: LspClientFactory
  idleMs?: number
  maxProcesses?: number
  diagnosticsWaitMs?: number
}

const digestOf = (config: LspServerConfig) => createHash('sha256').update(JSON.stringify(config)).digest('hex')
const diag = (code: string, message: string): ResourceDiagnostic => ({ source: 'lsp', code, message })
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** 一个作用域的配置的语义检查（schema 之外）：扩展名的写法与非空映射、名字不含冒号（留给插件前缀）。 */
function checkServers(servers: Record<string, unknown>, where: string): { valid: Record<string, LspServerConfig>; diagnostics: ResourceDiagnostic[] } {
  const valid: Record<string, LspServerConfig> = {}
  const diagnostics: ResourceDiagnostic[] = []
  for (const [name, config] of Object.entries(servers)) {
    const at = `${where}.${name}`
    if (!Value.Check(LspServerConfig, config)) {
      const first = Value.Errors(LspServerConfig, config)[0]
      diagnostics.push(diag('invalid-lsp-server', `${at}: ${first ? `${first.instancePath || '/'} ${first.message}` : 'invalid server'}`))
      continue
    }
    const extensions = Object.keys(config.extensionToLanguage)
    const bad = extensions.filter((ext) => !EXTENSION.test(ext))
    if (extensions.length === 0) diagnostics.push(diag('invalid-lsp-server', `${at}: extensionToLanguage must map at least one extension`))
    else if (bad.length > 0) diagnostics.push(diag('invalid-lsp-server', `${at}: extensions must look like .ts (got ${bad.join(', ')})`))
    else valid[name] = config
  }
  return { valid, diagnostics }
}

export class LspService {
  readonly #options: LspServiceOptions
  readonly #procs = new Map<string, Proc>()
  readonly #createClient: LspClientFactory
  #sessions: ((sessionId: string) => Promise<{ workspaceId: string; cwd: string }>) | undefined
  #closed = false

  constructor(options: LspServiceOptions) {
    this.#options = options
    this.#createClient = options.createClient ?? createLspClient
    options.plugins?.onChange?.(() => void this.#reconcile())
  }

  /** Session 的 Workspace 与工作目录（GET ?sessionId=）；AppLive 创建 SessionService 之后接上。 */
  bindSessions(resolve: (sessionId: string) => Promise<{ workspaceId: string; cwd: string }>): void {
    this.#sessions = resolve
  }

  // ---- 配置（/api/lsp） ----

  async #scopeSetting(key: string): Promise<{ servers: Record<string, unknown>; revision: number }> {
    const setting = await this.#options.store?.settings.get(key)
    if (!setting) return { servers: {}, revision: 0 }
    return { servers: isRecord(setting.value) ? setting.value : {}, revision: setting.revision }
  }

  async #pluginServers(): Promise<PluginLspServer[]> {
    if (!this.#options.plugins) return []
    const effective = await this.#options.config.effective()
    if (!effective.plugins.enabled) return []
    return (await this.#options.plugins.snapshot()).lspServers
  }

  /** 合并：workspace > global > plugin。同名时 workspace 覆盖 global；同一扩展名只归优先的服务器，其余记 duplicate-extension。 */
  async #resolve(workspaceId: string | undefined, pluginServers?: PluginLspServer[]): Promise<Resolution> {
    const global = await this.#scopeSetting(LSP_SERVERS_SETTING)
    const workspace = workspaceId === undefined ? undefined : await this.#scopeSetting(lspWorkspaceServersSetting(workspaceId))
    const globalChecked = checkServers(global.servers, 'lsp.servers')
    const workspaceChecked = workspace ? checkServers(workspace.servers, `lsp.workspaces.${workspaceId}.servers`) : undefined
    const globalDiagnostics = [...globalChecked.diagnostics]
    const workspaceDiagnostics = [...(workspaceChecked?.diagnostics ?? [])]
    const plugins: [string, LspServerConfig][] = []
    for (const plugin of pluginServers ?? (await this.#pluginServers())) {
      const name = pluginResourceName(plugin.plugin, plugin.name)
      const checked = checkServers({ [name]: plugin.config }, `plugin ${plugin.plugin} lspServers`)
      globalDiagnostics.push(...checked.diagnostics)
      if (checked.valid[name]) plugins.push([name, checked.valid[name]])
    }
    const ordered: { name: string; source: LspServerSource; config: LspServerConfig; diagnostics: ResourceDiagnostic[] }[] = []
    for (const [name, config] of Object.entries(workspaceChecked?.valid ?? {}))
      ordered.push({ name, source: 'workspace', config, diagnostics: workspaceDiagnostics })
    for (const [name, config] of Object.entries(globalChecked.valid)) {
      if (workspaceChecked?.valid[name]) {
        workspaceDiagnostics.push(diag('shadowed-server', `Global server ${name} is overridden by the workspace server with the same name`))
        continue
      }
      ordered.push({ name, source: 'global', config, diagnostics: globalDiagnostics })
    }
    for (const [name, config] of plugins) ordered.push({ name, source: 'plugin', config, diagnostics: globalDiagnostics })
    const owner = new Map<string, string>()
    const servers: ResolvedServer[] = []
    for (const entry of ordered) {
      const extensions: string[] = []
      for (const ext of Object.keys(entry.config.extensionToLanguage)) {
        const taken = owner.get(ext)
        if (taken) entry.diagnostics.push(diag('duplicate-extension', `${ext} is handled by ${taken}; ${entry.source} server ${entry.name} is shadowed for it`))
        else {
          owner.set(ext, entry.name)
          extensions.push(ext)
        }
      }
      if (extensions.length > 0) servers.push({ name: entry.name, source: entry.source, config: entry.config, extensions, digest: digestOf(entry.config) })
    }
    return {
      servers,
      global: { servers: global.servers as LspServersConfig, revision: global.revision, diagnostics: globalDiagnostics },
      ...(workspace && workspaceId !== undefined
        ? { workspace: { workspaceId, servers: workspace.servers as LspServersConfig, revision: workspace.revision, diagnostics: workspaceDiagnostics } }
        : {}),
    }
  }

  /** GET /api/lsp：给出 Session（或 Workspace）时含该 Workspace 的服务器，状态按其工作目录。 */
  async get(target?: { sessionId: string } | { workspaceId: string }): Promise<LspResponse> {
    let workspaceId: string | undefined
    let cwd: string | undefined
    if (target && 'sessionId' in target) {
      if (!this.#sessions) throw new Error('LspService is not bound yet')
      ;({ workspaceId, cwd } = await this.#sessions(target.sessionId))
    } else if (target) {
      const workspace = await this.#options.store?.sessions.getWorkspace(target.workspaceId)
      if (!workspace) throw new AppError('not-found', `Workspace ${target.workspaceId} not found`)
      workspaceId = workspace.id
      cwd = workspace.path
    }
    const effective = await this.#options.config.effective(cwd)
    const resolution = await this.#resolve(workspaceId)
    return {
      enabled: effective.lsp.enabled,
      global: resolution.global,
      ...(resolution.workspace ? { workspace: resolution.workspace } : {}),
      status: this.#status(resolution.servers, workspaceId, cwd),
    }
  }

  /** PUT /api/lsp：整体替换一个作用域；不合 schema 或有 invalid-lsp-server 时 400（details.diagnostics），revision 不一致时 409。 */
  async update(request: UpdateLspRequest): Promise<LspResponse> {
    const store = this.#options.store
    if (!store) throw new AppError('internal', 'Language server settings are not available')
    const workspaceId = request.scope === 'global' ? undefined : request.scope.workspaceId
    if (workspaceId !== undefined && !(await store.sessions.getWorkspace(workspaceId))) throw new AppError('not-found', `Workspace ${workspaceId} not found`)
    const checked = checkServers(request.servers, workspaceId === undefined ? 'lsp.servers' : `lsp.workspaces.${workspaceId}.servers`)
    if (checked.diagnostics.length > 0)
      throw new AppError('bad-request', checked.diagnostics.map((d) => d.message).join('; '), { diagnostics: checked.diagnostics })
    for (const name of Object.keys(request.servers))
      if (name.includes(':')) throw new AppError('bad-request', `Server name ${name} must not contain ":" (reserved for plugin servers)`)
    const key = workspaceId === undefined ? LSP_SERVERS_SETTING : lspWorkspaceServersSetting(workspaceId)
    await store.settings.set(key, request.servers as JsonValue, request.expectedRevision)
    log.info('language servers saved', { scope: workspaceId === undefined ? 'global' : 'workspace', servers: Object.keys(request.servers).length })
    await this.#reconcile()
    return this.get(workspaceId === undefined ? undefined : { workspaceId })
  }

  /** POST /api/lsp/restart：停止该服务器的进程（给出 cwd 时只停该目录的）、清零失败计数并重新启动；没有该服务器时 404。 */
  async restart(name: string, cwd?: string): Promise<void> {
    const procs = [...this.#procs.values()].filter((p) => p.server.name === name && (cwd === undefined || p.cwd === cwd))
    if (procs.length === 0) {
      const known = (await this.#resolve(undefined)).servers.some((s) => s.name === name)
      if (!known) throw new AppError('lsp-server-not-found', `Language server ${name} is not configured`)
      return
    }
    await Promise.all(
      procs.map(async (proc) => {
        await this.#stop(proc)
        proc.failures = 0
        proc.error = undefined
        proc.stderrTail = undefined
        proc.state = 'idle'
        log.info('language server restarted by user', { name: proc.server.name })
        await this.#start(proc).catch(() => undefined)
      }),
    )
  }

  // ---- 工具的端口 ----

  /** 本 Run 的端口：lsp.enabled 且有服务器时给出（工具只在此时注册）。 */
  async port(scope: ContextScope): Promise<LspPort | undefined> {
    if (!scope.config.lsp.enabled || this.#closed) return undefined
    const pluginServers = scope.config.plugins.enabled ? scope.plugins.lspServers : []
    const { servers } = await this.#resolve(scope.workspaceId, pluginServers)
    if (servers.length === 0) return undefined
    const extensions = servers.flatMap((s) => s.extensions)
    return {
      extensions: () => extensions,
      query: (query, signal) => this.#query(scope, servers, query, signal),
      readText: (path) => this.#readText(scope, path),
    }
  }

  /** 结果所在文件的文本：只读工作目录内（按真实路径）、不受保护、不被 Read 拒绝规则覆盖的文件；否则 undefined（结果只给位置）。 */
  async #readText(scope: ContextScope, path: string): Promise<string | undefined> {
    try {
      const [root, target] = await Promise.all([realLocation(scope.cwd), resolveTarget(path, scope.cwd)])
      if (!pathContains(root, target.real) || isProtectedPath(target)) return undefined
      const denied = contextReadDenial((await scope.permissionRules?.()) ?? [], scope.cwd)
      if (denied(target.resolved) || denied(target.real)) return undefined
      return await readFile(path, 'utf8')
    } catch {
      return undefined
    }
  }

  async #query(scope: ContextScope, servers: ResolvedServer[], query: LspQuery, signal?: AbortSignal): Promise<LspQueryResult> {
    const ext = extname(query.path)
    const server = servers.find((s) => s.extensions.includes(ext))
    if (!server) throw new Error(`No language server is configured for ${ext} files`)
    const proc = this.#procFor(server, scope)
    if (scope.sessionId) proc.sessions.add(scope.sessionId)
    if (proc.state === 'failed')
      throw new Error(
        `Language server ${server.name} failed ${proc.failures} times in a row and was stopped${proc.error ? ` (${proc.error})` : ''}. Restart it in Settings → Code intelligence.`,
      )
    proc.lastUsed = Date.now()
    if (proc.idle) clearTimeout(proc.idle)
    try {
      const client = await this.#start(proc)
      const uri = pathToFileURL(query.path).href
      const version = (proc.documents.get(uri) ?? 0) + 1
      let diagnostics: Promise<LspDiagnostic[] | undefined> | undefined
      if (query.operation === 'diagnostics') diagnostics = this.#waitDiagnostics(proc, uri, signal)
      if (version === 1)
        client.notify('textDocument/didOpen', {
          textDocument: { uri, languageId: server.config.extensionToLanguage[ext], version, text: query.text },
        })
      else client.notify('textDocument/didChange', { textDocument: { uri, version }, contentChanges: [{ text: query.text }] })
      proc.documents.set(uri, version)
      let result: LspQueryResult
      if (diagnostics) {
        const received = await Promise.race([diagnostics, client.exited.then(() => Promise.reject(new Error('The language server exited')))])
        result = { kind: 'diagnostics', diagnostics: received }
      } else {
        const params = {
          textDocument: { uri },
          position: query.position,
          ...(query.operation === 'references' ? { context: { includeDeclaration: true } } : {}),
        }
        const method = query.operation === 'hover' ? 'textDocument/hover' : `textDocument/${query.operation}`
        const answer = await client.request(method, params, signal)
        result =
          query.operation === 'hover'
            ? { kind: 'hover', hover: answer as { contents: unknown } | null }
            : { kind: 'locations', operation: query.operation as 'definition' | 'references', locations: answer as never }
      }
      proc.answered = true
      proc.failures = 0
      return result
    } finally {
      this.#touch(proc)
    }
  }

  #waitDiagnostics(proc: Proc, uri: string, signal?: AbortSignal): Promise<LspDiagnostic[] | undefined> {
    return new Promise((resolve) => {
      const waiters = proc.waiters.get(uri) ?? []
      const done = (diagnostics: LspDiagnostic[] | undefined) => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', abort)
        proc.waiters.set(
          uri,
          (proc.waiters.get(uri) ?? []).filter((w) => w !== waiter),
        )
        resolve(diagnostics)
      }
      const waiter = (diagnostics: LspDiagnostic[]) => done(diagnostics)
      const abort = () => done(undefined)
      const timer = setTimeout(() => done(undefined), this.#options.diagnosticsWaitMs ?? LSP_DIAGNOSTICS_WAIT_MS)
      signal?.addEventListener('abort', abort, { once: true })
      proc.waiters.set(uri, [...waiters, waiter])
    })
  }

  #procFor(server: ResolvedServer, scope: ContextScope): Proc {
    const key = `${server.source}\u0000${server.name}\u0000${scope.cwd}`
    let proc = this.#procs.get(key)
    if (proc && proc.server.digest !== server.digest) {
      void this.#stop(proc)
      this.#procs.delete(key)
      proc = undefined
    }
    if (!proc) {
      proc = {
        key,
        server,
        cwd: scope.cwd,
        workspaceId: scope.workspaceId,
        state: 'idle',
        failures: 0,
        answered: false,
        stopping: false,
        lastUsed: Date.now(),
        sessions: new Set(),
        documents: new Map(),
        waiters: new Map(),
      }
      this.#procs.set(key, proc)
    }
    return proc
  }

  /** 启动（已在运行或正在启动时复用）；失败计一次。 */
  #start(proc: Proc): Promise<LspClient> {
    if (proc.client) return Promise.resolve(proc.client)
    if (proc.starting) return proc.starting
    this.#evict(proc)
    proc.state = 'starting'
    proc.stopping = false
    proc.answered = false
    this.#publish(proc)
    const { config } = proc.server
    const starting = this.#createClient({
      command: config.command,
      ...(config.args ? { args: config.args } : {}),
      ...(config.env ? { env: config.env } : {}),
      ...(this.#options.env ? { hostEnv: this.#options.env } : {}),
      cwd: proc.cwd,
      ...(config.initializationOptions === undefined ? {} : { initializationOptions: config.initializationOptions }),
      ...(config.startupTimeout ? { startupTimeoutMs: config.startupTimeout } : {}),
      ...(this.#options.track
        ? { onProcess: ({ pid, pgid }) => this.#options.track!({ pid, pgid, kind: 'lsp', command: [config.command, ...(config.args ?? [])].join(' ') }) }
        : {}),
      onNotification: (method, params) => {
        if (method !== 'textDocument/publishDiagnostics' || !isRecord(params) || typeof params.uri !== 'string') return
        const diagnostics = Array.isArray(params.diagnostics) ? (params.diagnostics as LspDiagnostic[]) : []
        for (const waiter of proc.waiters.get(params.uri) ?? []) waiter(diagnostics)
      },
      onExit: (info) => this.#exited(proc, info),
    }).then(
      (client) => {
        proc.starting = undefined
        if (proc.stopping || this.#closed) {
          void client.close()
          throw new Error('The language server was stopped')
        }
        proc.client = client
        proc.state = 'running'
        proc.error = undefined
        log.info('language server started', { name: proc.server.name, pid: client.pid })
        this.#publish(proc)
        return client
      },
      (error: unknown) => {
        proc.starting = undefined
        this.#fail(proc, errorMessage(error))
        throw error
      },
    )
    proc.starting = starting
    return starting
  }

  #exited(proc: Proc, info: { code: number | null; signal: NodeJS.Signals | null }) {
    const client = proc.client
    if (!client) return // 启动中退出：由启动的失败处理。
    proc.client = undefined
    proc.documents.clear()
    proc.stderrTail = redactText(client.stderrTail()).trim() || undefined
    if (proc.stopping) return
    const reason = `exited (${info.signal ?? `code ${info.code}`})`
    if (proc.answered) {
      // 回答过查询之后崩溃：下一次查询重启，不计失败。
      proc.state = 'idle'
      proc.error = redactText(`The language server ${reason}`)
      log.warn('language server exited', { name: proc.server.name, code: info.code, signal: info.signal })
      this.#publish(proc)
      return
    }
    this.#fail(proc, `The language server ${reason} before answering`)
  }

  #fail(proc: Proc, message: string) {
    proc.failures++
    proc.error = redactText(message)
    proc.state = proc.failures >= LSP_MAX_FAILURES ? 'failed' : 'idle'
    log.warn('language server failed', { name: proc.server.name, failures: proc.failures, state: proc.state })
    this.#publish(proc)
  }

  /** 查询之后：重置空闲计时。 */
  #touch(proc: Proc) {
    proc.lastUsed = Date.now()
    if (proc.idle) clearTimeout(proc.idle)
    if (!proc.client || this.#closed) return
    proc.idle = setTimeout(() => {
      log.info('language server idle; stopping', { name: proc.server.name })
      void this.#stop(proc).then(() => {
        if (this.#procs.get(proc.key) === proc && proc.state !== 'failed') this.#procs.delete(proc.key)
        this.#publish(proc)
      })
    }, this.#options.idleMs ?? LSP_IDLE_MS)
    proc.idle.unref?.()
  }

  /** 正在运行（或启动中）的进程超过上限时关闭最久未用的。 */
  #evict(starting: Proc) {
    const max = this.#options.maxProcesses ?? LSP_MAX_PROCESSES
    const live = () => [...this.#procs.values()].filter((p) => p !== starting && (p.client || p.starting))
    while (live().length >= max) {
      const oldest = live().sort((a, b) => a.lastUsed - b.lastUsed)[0]!
      log.info('language server limit reached; stopping the least recently used', { name: oldest.server.name, max })
      void this.#stop(oldest).then(() => {
        if (this.#procs.get(oldest.key) === oldest && oldest.state !== 'failed') this.#procs.delete(oldest.key)
        this.#publish(oldest)
      })
      oldest.client = undefined
      oldest.starting = undefined
    }
  }

  async #stop(proc: Proc): Promise<void> {
    proc.stopping = true
    if (proc.idle) clearTimeout(proc.idle)
    const client = proc.client ?? (await proc.starting?.catch(() => undefined))
    proc.client = undefined
    proc.documents.clear()
    for (const waiters of proc.waiters.values()) for (const waiter of waiters) waiter([])
    proc.waiters.clear()
    if (proc.state !== 'failed') proc.state = 'idle'
    if (client) await client.close().catch(() => undefined)
  }

  /** 配置或插件变化后：配置已不同（或已删除）的进程关闭。 */
  async #reconcile(): Promise<void> {
    const byWorkspace = new Map<string, Proc[]>()
    for (const proc of this.#procs.values()) byWorkspace.set(proc.workspaceId, [...(byWorkspace.get(proc.workspaceId) ?? []), proc])
    for (const [workspaceId, procs] of byWorkspace) {
      const { servers } = await this.#resolve(workspaceId)
      for (const proc of procs) {
        const current = servers.find((s) => s.name === proc.server.name && s.source === proc.server.source)
        if (current && current.digest === proc.server.digest) continue
        log.info('language server configuration changed; stopping', { name: proc.server.name })
        await this.#stop(proc)
        this.#procs.delete(proc.key)
        this.#publish(proc)
      }
    }
  }

  #toStatus(server: ResolvedServer, proc: Proc | undefined, cwd: string | undefined): LspServerStatus {
    const pid = proc?.client?.pid
    return {
      name: server.name,
      source: server.source,
      extensions: server.extensions,
      state: proc?.state ?? 'idle',
      ...(proc ? { cwd: proc.cwd } : cwd !== undefined ? { cwd } : {}),
      ...(pid !== undefined ? { pid } : {}),
      ...(proc?.stderrTail ? { stderrTail: proc.stderrTail } : {}),
      ...(proc?.error ? { error: proc.error } : {}),
    }
  }

  /** 状态：给出工作目录时每个服务器一行（该目录的进程）；否则全局与插件服务器各一行，另加每个进程一行。 */
  #status(servers: ResolvedServer[], workspaceId: string | undefined, cwd: string | undefined): LspServerStatus[] {
    if (cwd !== undefined) return servers.map((server) => this.#toStatus(server, this.#procs.get(`${server.source}\u0000${server.name}\u0000${cwd}`), cwd))
    const out: LspServerStatus[] = []
    for (const server of servers) {
      const procs = [...this.#procs.values()].filter((p) => p.server.name === server.name && p.server.source === server.source)
      if (procs.length === 0) out.push(this.#toStatus(server, undefined, undefined))
      else for (const proc of procs) out.push(this.#toStatus(proc.server, proc, undefined))
    }
    for (const proc of this.#procs.values())
      if (proc.server.source === 'workspace' && (workspaceId === undefined || proc.workspaceId === workspaceId))
        out.push(this.#toStatus(proc.server, proc, undefined))
    return out
  }

  /** lsp_update：推给用过该进程的 Session（其工作目录的状态）。 */
  #publish(proc: Proc) {
    const hub = this.#options.hub
    if (!hub || proc.sessions.size === 0) return
    void (async () => {
      try {
        const { servers } = await this.#resolve(proc.workspaceId)
        const status = this.#status(servers, proc.workspaceId, proc.cwd)
        for (const sessionId of proc.sessions) hub.publishProgress(sessionId, '', { type: 'lsp_update', servers: status })
      } catch (error) {
        log.warn('lsp_update failed', { error: errorMessage(error) })
      }
    })()
  }

  /** 停止全部语言服务器进程（shutdown → exit → SIGTERM → SIGKILL）。 */
  async close(): Promise<void> {
    this.#closed = true
    await Promise.all([...this.#procs.values()].map((proc) => this.#stop(proc)))
    this.#procs.clear()
  }
}
