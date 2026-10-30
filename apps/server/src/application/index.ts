import type { SessionStore } from '@coko/session'
import type { ConfigService } from './config.ts'
import type { ContextService } from './context-service.ts'
import type { McpAdmin } from './context/mcp-admin.ts'
import type { MemoryService } from './context/memory.ts'
import type { SessionHub } from './hub.ts'
import type { ProviderService } from './providers.ts'
import type { SecretService } from './secrets.ts'
import type { SessionService } from './sessions.ts'
import type { SettingsService } from './settings.ts'
import type { WorkspaceService } from './workspaces.ts'

/** application 层的全部入口，由 runtime 装配，http / ws 只经这里访问业务。 */
export interface Application {
  store: SessionStore
  hub: SessionHub
  sessions: SessionService
  providers: ProviderService
  settings: SettingsService
  workspaces: WorkspaceService
  /** 有效能力配置（docs/subsystems/configuration.md）。 */
  config: ConfigService
  /** 上下文的查询入口：作用域、用量、命令、Skill 与文件候选（装配本身为 context.assembly）。 */
  context: ContextService
  /** 用户级与 Workspace 的记忆（/api/memories）。 */
  memories: MemoryService
  /** MCP Server 的配置、批准与连接状态视图（连接池为 context/mcp.ts 的 McpManager）。 */
  mcp: McpAdmin
  /** 登记的 Secret（ADR 0007）。 */
  secrets: SecretService
}
