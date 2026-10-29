// 一个 MCP Server 的连接（M3 规格 D5）：pi-mcp McpClient，传输由宿主注入（createTransport）。状态 idle / connecting / connected /
// failed；连接超时 30 秒；连接后意外断开时按 1、2、4 秒退避自动重连至多 3 次，之后停在 failed，需手动 reconnect()。
// 失败原因带 stderr 最后 20 行，经宿主给出的 redact 脱敏。tools/list_changed 时刷新工具；prompts / resources 的 list_changed 与每次
// 建立连接时使 listRevision 前进（缓存列表的宿主据此刷新，票 08）。
// Connection handling adapted in part from pi coding-agent 1.4.0 extensions/mcp/runtime.ts (MIT, Copyright (c) 2025 Mario Zechner). See THIRD_PARTY_NOTICES.md.
import { pathToFileURL } from 'node:url'
import { basename } from 'node:path'
import { McpClient, type CallToolResult, type McpRequestOptions, type McpTransport, type ServerCapabilities, type Tool } from '@earendil-works/pi-mcp'

export const MCP_CONNECT_TIMEOUT_MS = 30_000
export const MCP_RECONNECT_DELAYS_MS: readonly number[] = [1_000, 2_000, 4_000]
export const MCP_STDERR_TAIL_LINES = 20

export type McpConnectionStatus = 'idle' | 'connecting' | 'connected' | 'failed'

/** Lists the server can change (`notifications/<kind>/list_changed`). */
export type McpListKind = 'prompts' | 'resources'

/** What the host's transport factory returns: the transport, and for stdio its stderr and process id. */
export interface McpTransportHandle {
  transport: McpTransport
  stderr?: () => string
  pid?: () => number | undefined
}

export interface McpConnectionOptions {
  /** Server name (diagnostics, tool names). */
  name: string
  /** Workspace directory, declared to the server as the only root. */
  root: string
  /** Build the transport; may reject (for example a Secret is not registered), which fails the connection without retry. */
  createTransport: () => McpTransportHandle | Promise<McpTransportHandle>
  /** Default 30 000. */
  connectTimeoutMs?: number
  /** Default 1, 2, 4 seconds. */
  reconnectDelaysMs?: readonly number[]
  /** Per-request default timeout in milliseconds (the server's `timeout`). */
  requestTimeoutMs?: number
  /** Applied to every error text and stderr tail kept by the connection (Secret values, credentials). */
  redact?: (text: string) => string
  clientInfo?: { name: string; version: string }
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

function tail(text: string, lines: number): string | undefined {
  const trimmed = text.trimEnd()
  if (trimmed === '') return undefined
  return trimmed.split('\n').slice(-lines).join('\n')
}

export class McpConnection {
  readonly name: string
  #status: McpConnectionStatus = 'idle'
  #error: string | undefined
  #stderrTail: string | undefined
  #tools: Tool[] = []
  #capabilities: ServerCapabilities | undefined
  #pid: number | undefined
  #client: McpClient | undefined
  #opening: Promise<void> | undefined
  #closedByUs = new WeakSet<McpClient>()
  #retryTimer: NodeJS.Timeout | undefined
  #reconnectAttempts = 0
  #shutdown = false
  readonly #listRevisions: Record<McpListKind, number> = { prompts: 0, resources: 0 }
  readonly #listeners = new Set<() => void>()
  readonly #options: McpConnectionOptions

  constructor(options: McpConnectionOptions) {
    this.name = options.name
    this.#options = options
  }

  get status(): McpConnectionStatus {
    return this.#status
  }
  get error(): string | undefined {
    return this.#error
  }
  get stderrTail(): string | undefined {
    return this.#stderrTail
  }
  get tools(): readonly Tool[] {
    return this.#tools
  }
  get capabilities(): ServerCapabilities | undefined {
    return this.#capabilities
  }
  /** Process id of the current stdio server (tests check it exited). */
  get pid(): number | undefined {
    return this.#pid
  }
  /** Automatic reconnect attempts since the last established connection. */
  get reconnectAttempts(): number {
    return this.#reconnectAttempts
  }

  /** Advances when the server reports the list changed and on every new connection; a cache of the list is stale when it differs. */
  listRevision(kind: McpListKind): number {
    return this.#listRevisions[kind]
  }

  /** Called after status, error, tools or a list revision change. */
  onChange(listener: () => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  #changed(): void {
    for (const listener of this.#listeners) listener()
  }

  #redact(text: string): string {
    return this.#options.redact ? this.#options.redact(text) : text
  }

  /** Connect unless connected or connecting. Never rejects: failures end in status failed. */
  connect(): Promise<void> {
    if (this.#status === 'connected') return Promise.resolve()
    this.#shutdown = false
    this.#opening ??= this.#open().finally(() => {
      this.#opening = undefined
    })
    return this.#opening
  }

  /** Close and connect again (manual reconnect; also resets the automatic attempts). */
  async reconnect(): Promise<void> {
    await this.close()
    this.#reconnectAttempts = 0
    await this.connect()
  }

  /** Close the connection (stdio: stdin closed, then SIGTERM, then SIGKILL by the transport). Status becomes idle. */
  async close(): Promise<void> {
    this.#shutdown = true
    clearTimeout(this.#retryTimer)
    this.#retryTimer = undefined
    await this.#opening?.catch(() => undefined)
    const client = this.#client
    this.#client = undefined
    if (client) {
      this.#closedByUs.add(client)
      await client.close().catch(() => undefined)
    }
    this.#tools = []
    this.#pid = undefined
    if (this.#status !== 'idle') {
      this.#status = 'idle'
      this.#changed()
    }
  }

  /** tools/call with `_meta` (idempotencyKey); rejects when not connected. */
  async callTool(name: string, args: Record<string, unknown>, options: McpRequestOptions & { meta?: Record<string, unknown> } = {}): Promise<CallToolResult> {
    const client = this.#client
    if (!client || this.#status !== 'connected') throw new Error(`MCP server "${this.name}" is not connected (${this.#status})`)
    const { meta, ...requestOptions } = options
    const result = await client.request<unknown>('tools/call', { name, arguments: args, ...(meta ? { _meta: meta } : {}) }, requestOptions)
    if (typeof result !== 'object' || result === null || ('content' in result && !Array.isArray((result as { content: unknown }).content)))
      throw new Error(`MCP server "${this.name}" returned an invalid tools/call result`)
    const value = result as Partial<CallToolResult>
    return { ...value, content: value.content ?? [] } as CallToolResult
  }

  /** Any request through the current client (resources, prompts); rejects when not connected. */
  async request<T = unknown>(method: string, params?: Record<string, unknown>, options: McpRequestOptions = {}): Promise<T> {
    const client = this.#client
    if (!client || this.#status !== 'connected') throw new Error(`MCP server "${this.name}" is not connected (${this.#status})`)
    return client.request<T>(method, params, options)
  }

  #bumpList(client: McpClient, kind: McpListKind): void {
    if (this.#client !== client) return
    this.#listRevisions[kind]++
    this.#changed()
  }

  async #open(): Promise<void> {
    this.#status = 'connecting'
    this.#changed()
    let handle: McpTransportHandle | undefined
    const client = new McpClient({
      name: this.#options.clientInfo?.name ?? 'coko',
      version: this.#options.clientInfo?.version ?? '0.0.0',
      ...(this.#options.requestTimeoutMs ? { requestTimeoutMs: this.#options.requestTimeoutMs } : {}),
      roots: [{ uri: pathToFileURL(this.#options.root).href, name: basename(this.#options.root) }],
    })
    const timeoutMs = this.#options.connectTimeoutMs ?? MCP_CONNECT_TIMEOUT_MS
    let timer: NodeJS.Timeout | undefined
    try {
      handle = await this.#options.createTransport()
      const opened = (async () => {
        await client.connect(handle.transport)
        const tools = client.serverCapabilities?.tools ? await client.listTools() : []
        return tools
      })()
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`MCP server "${this.name}" connection timed out after ${timeoutMs} ms`)), timeoutMs)
      })
      opened.catch(() => undefined)
      const tools = await Promise.race([opened, timeout])
      if (this.#shutdown) throw new Error('closed while connecting')
      if (client.connectionState !== 'connected') throw new Error('connection closed during setup')
      this.#client = client
      this.#tools = tools
      this.#capabilities = client.serverCapabilities
      this.#pid = handle.pid?.()
      this.#status = 'connected'
      this.#error = undefined
      this.#stderrTail = undefined
      this.#reconnectAttempts = 0
      this.#listRevisions.prompts++
      this.#listRevisions.resources++
      client.onClose(() => this.#unexpectedClose(client, handle!))
      client.onNotification('notifications/tools/list_changed', () => void this.#refreshTools(client))
      client.onNotification('notifications/prompts/list_changed', () => this.#bumpList(client, 'prompts'))
      client.onNotification('notifications/resources/list_changed', () => this.#bumpList(client, 'resources'))
      this.#changed()
    } catch (error) {
      this.#closedByUs.add(client)
      await client.close().catch(() => undefined)
      if (this.#shutdown) return
      this.#fail(`${message(error)}`, handle)
    } finally {
      clearTimeout(timer)
    }
  }

  #fail(reason: string, handle: McpTransportHandle | undefined): void {
    this.#client = undefined
    this.#tools = []
    this.#pid = undefined
    this.#status = 'failed'
    this.#error = this.#redact(reason)
    const stderr = handle?.stderr ? tail(handle.stderr(), MCP_STDERR_TAIL_LINES) : undefined
    this.#stderrTail = stderr === undefined ? undefined : this.#redact(stderr)
    this.#changed()
  }

  /** The transport dropped while connected: record why, then retry with backoff. */
  #unexpectedClose(client: McpClient, handle: McpTransportHandle): void {
    if (this.#closedByUs.has(client) || this.#client !== client || this.#shutdown) return
    this.#fail('Connection closed', handle)
    this.#scheduleRetry()
  }

  #scheduleRetry(): void {
    const delays = this.#options.reconnectDelaysMs ?? MCP_RECONNECT_DELAYS_MS
    const delay = delays[this.#reconnectAttempts]
    if (delay === undefined || this.#shutdown) return
    this.#retryTimer = setTimeout(() => {
      this.#retryTimer = undefined
      if (this.#shutdown) return
      this.#reconnectAttempts++
      const attempt = this.#reconnectAttempts
      void this.connect().then(() => {
        // A failed attempt keeps counting; a success reset the counter in #open.
        if (this.#status === 'failed' && this.#reconnectAttempts === attempt) this.#scheduleRetry()
      })
    }, delay)
    this.#retryTimer.unref?.()
  }

  async #refreshTools(client: McpClient): Promise<void> {
    try {
      const tools = await client.listTools()
      if (this.#client !== client) return
      this.#tools = tools
    } catch (error) {
      this.#error = this.#redact(`Failed to refresh tools: ${message(error)}`)
    }
    this.#changed()
  }
}
