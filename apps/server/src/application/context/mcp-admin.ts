// MCP 的 HTTP 视图与管理（docs/subsystems/mcp.md）：GET /api/mcp、PUT /api/mcp/servers、POST /api/mcp/approvals、POST /api/mcp/reconnect、
// GET /api/mcp/presets（MCP_PRESETS）。
// 连接池与运行时在 mcp.ts 的 McpManager；这里只读取配置、写设置并让 McpManager 关闭或建立受影响的连接。
import { createMcpToolName, serverNamesConflict, transportOf, validateMcpServerConfig, type McpServerConfig } from '@coko/agent'
import { getLogger } from '@coko/logging'
import {
  MCP_SERVERS_SETTING,
  mcpApprovalsSettingKey,
  type McpApprovalRequest,
  type McpLaunchDetails,
  type McpPreset,
  type McpPresetsResponse,
  type McpResponse,
  type McpServerInfo,
  type UpdateMcpServersRequest,
} from '@coko/protocol'
import type { JsonValue, SessionStore } from '@coko/session'
import { AppError } from '../errors.ts'
import { staticMcpStatus, type McpManager } from './mcp.ts'

const log = getLogger(['application', 'mcp'])

/** 项目 Server 批准时显示的启动配置：与批准摘要覆盖的字段相同，含 env 与 headers 的值（项目项只有字面值，ADR 0007）。 */
function launchOf(config: McpServerConfig): McpLaunchDetails {
  if ('url' in config) return { url: config.url, ...(config.headers ? { headers: { ...config.headers } } : {}) }
  return { command: config.command, args: config.args ?? [], ...(config.cwd ? { cwd: config.cwd } : {}), ...(config.env ? { env: { ...config.env } } : {}) }
}

/**
 * 预设：浏览器经 Playwright MCP（精确版本，经 npx 按需下载，不进 manifest；--isolated 使每次连接用临时的浏览器配置，不读写用户的浏览器
 * 资料）。界面确认后经 PUT /api/mcp/servers 写入全局配置，之后与手动添加的 Server 相同（权限类 external，调用需审批）。
 */
export const MCP_PRESETS: readonly McpPreset[] = [
  { id: 'playwright', name: 'playwright', label: 'Browser (Playwright)', config: { command: 'npx', args: ['-y', '@playwright/mcp@0.0.83', '--isolated'] } },
]

export class McpAdmin {
  readonly #store: SessionStore
  readonly #manager: McpManager

  constructor(options: { store: SessionStore; manager: McpManager }) {
    this.#store = options.store
    this.#manager = options.manager
  }

  async #workspacePath(workspaceId: string): Promise<string> {
    const workspace = await this.#store.sessions.getWorkspace(workspaceId)
    if (!workspace) throw new AppError('not-found', `Workspace ${workspaceId} not found`)
    return workspace.path
  }

  /** GET /api/mcp：给出 workspaceId 时含该 Workspace 的项目 Server 与连接状态。 */
  async view(workspaceId?: string): Promise<McpResponse> {
    const manager = this.#manager
    const workspace = workspaceId === undefined ? undefined : { id: workspaceId, path: await this.#workspacePath(workspaceId) }
    const loaded = await manager.load(workspace)
    if (workspace) await manager.reconcile(workspace.id, workspace.path, loaded)
    const servers = loaded.entries.map((entry): McpServerInfo => {
      const connection = workspace ? manager.connection(workspace.id, workspace.path, entry.name) : undefined
      const status = staticMcpStatus(entry, loaded) ?? connection?.status ?? 'idle'
      const taken = new Set<string>()
      const disabled = new Set(entry.config.disabledTools ?? [])
      const tools =
        status === 'connected' && connection
          ? connection.tools
              .filter((tool) => !disabled.has(tool.name))
              .map((tool) => {
                const name = createMcpToolName(entry.name, tool.name, (candidate) => taken.has(candidate))
                taken.add(name)
                return { name, server: entry.name, ...(tool.description ? { description: tool.description } : {}) }
              })
          : []
      return {
        name: entry.name,
        scope: entry.scope,
        transport: transportOf(entry.config),
        enabled: entry.config.enabled !== false,
        status,
        ...((status === 'failed' || status === 'auth-required') && connection?.error ? { error: connection.error } : {}),
        ...(status === 'failed' && connection?.stderrTail ? { stderrTail: connection.stderrTail } : {}),
        tools,
        ...(entry.scope === 'project'
          ? { approval: { digest: entry.digest, approved: loaded.approvals[entry.name] === entry.digest, launch: launchOf(entry.config) } }
          : {}),
      }
    })
    return {
      enabled: loaded.enabled,
      servers,
      global: structuredClone(loaded.globalRaw) as McpResponse['global'],
      globalRevision: loaded.globalRevision,
      ...(loaded.project ? { project: loaded.project } : {}),
      diagnostics: workspace ? [...loaded.diagnostics, ...manager.runtimeDiagnostics(workspace.id)] : loaded.diagnostics,
    }
  }

  /** PUT /api/mcp/servers：逐项校验后整体替换；受影响的连接关闭，给出 workspaceId 时在后台连接该 Workspace 应当连接的 Server。 */
  async updateServers(request: UpdateMcpServersRequest): Promise<McpResponse> {
    const manager = this.#manager
    const names = Object.keys(request.servers)
    for (const name of names) {
      const result = validateMcpServerConfig(name, request.servers[name])
      if (!result.ok) throw new AppError('bad-request', result.message)
      const clash = names.find((other) => serverNamesConflict(other, name))
      if (clash) throw new AppError('bad-request', `server "${name}" conflicts with "${clash}" (names differ only in case, "-" or "_")`)
    }
    const workspace = request.workspaceId === undefined ? undefined : { id: request.workspaceId, path: await this.#workspacePath(request.workspaceId) }
    await this.#store.settings.set(MCP_SERVERS_SETTING, request.servers as JsonValue, request.expectedRevision)
    log.info('mcp servers saved', { revision: request.expectedRevision + 1, servers: names.length })
    // 全局配置被所有 Workspace 共用：逐个 Workspace 关闭失效的全局连接。
    for (const id of manager.workspaceIds()) {
      const path = id === workspace?.id ? workspace.path : await this.#workspacePath(id).catch(() => undefined)
      if (path === undefined) continue
      await manager.reconcile(id, path, await manager.load({ id, path }))
    }
    if (workspace) manager.connectInBackground(workspace.id, workspace.path, await manager.load(workspace))
    return this.view(request.workspaceId)
  }

  /** POST /api/mcp/approvals：批准（摘要须等于当前项目配置）或撤销批准（回到 pending，连接关闭）。 */
  async approve(request: McpApprovalRequest): Promise<McpResponse> {
    const manager = this.#manager
    const workspace = { id: request.workspaceId, path: await this.#workspacePath(request.workspaceId) }
    const loaded = await manager.load(workspace)
    const entry = loaded.entries.find((e) => e.scope === 'project' && e.name === request.name)
    if (!entry) throw new AppError('not-found', `Project MCP server ${request.name} not found`)
    if (request.approve && entry.digest !== request.digest)
      throw new AppError('revision-conflict', 'The project MCP configuration changed; review it again', { expected: request.digest, actual: entry.digest })
    const approvals = { ...loaded.approvals }
    if (request.approve) approvals[entry.name] = entry.digest
    else delete approvals[entry.name]
    await this.#store.settings.set(mcpApprovalsSettingKey(workspace.id), approvals, loaded.approvalsRevision)
    log.info(request.approve ? 'mcp project server approved' : 'mcp project server approval revoked', { workspaceId: workspace.id, server: entry.name })
    const next = await manager.load(workspace)
    await manager.reconcile(workspace.id, workspace.path, next)
    if (request.approve) manager.connectInBackground(workspace.id, workspace.path, next)
    return this.view(workspace.id)
  }

  /** GET /api/mcp/presets。 */
  presets(): McpPresetsResponse {
    return { presets: structuredClone([...MCP_PRESETS]) }
  }

  /** POST /api/mcp/reconnect：关闭并重新连接，等待连接结束。 */
  async reconnect(request: { workspaceId: string; name: string }): Promise<McpResponse> {
    const manager = this.#manager
    const workspace = { id: request.workspaceId, path: await this.#workspacePath(request.workspaceId) }
    const loaded = await manager.load(workspace)
    const entry = loaded.entries.find((e) => e.name === request.name)
    if (!entry) throw new AppError('not-found', `MCP server ${request.name} not found`)
    const status = staticMcpStatus(entry, loaded)
    if (status !== undefined) throw new AppError('bad-request', `MCP server ${request.name} is ${status}`)
    await manager.reconcile(workspace.id, workspace.path, loaded)
    await manager.restart(workspace.id, workspace.path, entry)
    return this.view(workspace.id)
  }
}
