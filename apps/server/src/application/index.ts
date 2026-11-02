import type { ProjectService } from './projects.ts'
import type { SessionStore } from '@coko/session'
import type { ClockPort, TestClock } from '../adapters/clock.ts'
import type { HandoffService } from './handoff.ts'
import type { HookService } from './hooks.ts'
import type { NotificationService } from './notifications.ts'
import type { ScheduleService } from './schedules.ts'
import type { SubagentService } from './subagents.ts'
import type { WorktreeService } from './worktrees.ts'
import type { LspService } from './lsp.ts'
import type { PluginService } from './plugins.ts'
import type { TeamService } from './teams.ts'
import type { TraceService } from './trace.ts'
import type { ConfigService } from './config.ts'
import type { ContextService } from './context-service.ts'
import type { GoalService } from './goals.ts'
import type { JobService } from './jobs.ts'
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
  projects: ProjectService
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
  /** 后台任务（/api/sessions/:id/jobs、/api/jobs）。 */
  jobs: JobService
  /** Goal（/api/sessions/:id/goal）。 */
  goals: GoalService
  /** M5：时钟（定时任务）；测试构建开启 COKO_TEST_CLOCK 时为可控时钟。 */
  clock: ClockPort
  /** 测试时钟（只在测试构建且开启时）：POST /api/test/clock 据此挂载。 */
  testClock?: TestClock
  hooks: HookService
  subagents: SubagentService
  schedules: ScheduleService
  worktrees: WorktreeService
  handoff: HandoffService
  notifications: NotificationService
  /** M6：插件（/api/plugins）与插件消费 seam 的提供方。 */
  plugins: PluginService
  /** 代码智能（/api/lsp）。 */
  lsp: LspService
  /** Agent Teams（/api/sessions/:id/team）。 */
  teams: TeamService
  /** 追踪、审计与导出（/api/sessions/:id/{trace,audit,export}）。 */
  trace: TraceService
}
