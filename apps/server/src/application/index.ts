import type { SessionStore } from '@coko/session'
import type { ConfigService } from './config.ts'
import type { ContextAssembly } from './context/index.ts'
import type { McpAdmin } from './context/mcp-admin.ts'
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
  /** M3 上下文装配（application/context/）。 */
  context: ContextAssembly
  /** MCP Server 的配置、批准与连接状态视图（连接池为 context/mcp.ts 的 McpManager）。 */
  mcp: McpAdmin
  /** 登记的 Secret（ADR 0007）。 */
  secrets: SecretService
}
