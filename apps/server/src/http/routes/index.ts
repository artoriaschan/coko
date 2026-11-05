import { artifactsRoutes } from './artifacts.ts'
// 各领域的路由：每个领域一个 routes/<domain>.ts，在这里登记一次。
import { agentsRoutes } from './agents.ts'
import { commandsRoutes } from './commands.ts'
import { configRoutes } from './config.ts'
import { contextRoutes } from './context.ts'
import { filesRoutes } from './files.ts'
import { goalsRoutes } from './goals.ts'
import { handoffRoutes } from './handoff.ts'
import { hooksRoutes } from './hooks.ts'
import { jobsRoutes } from './jobs.ts'
import { lspRoutes } from './lsp.ts'
import { mcpRoutes } from './mcp.ts'
import { pluginsRoutes } from './plugins.ts'
import { schedulesRoutes } from './schedules.ts'
import { memoriesRoutes } from './memories.ts'
import { secretsRoutes } from './secrets.ts'
import type { DomainRoutes } from './shared.ts'
import { skillsRoutes } from './skills.ts'
import { teamsRoutes } from './teams.ts'
import { traceRoutes } from './trace.ts'
import { worktreesRoutes } from './worktrees.ts'

export const DOMAIN_ROUTES: readonly DomainRoutes[] = [
  artifactsRoutes,
  configRoutes,
  commandsRoutes,
  skillsRoutes,
  filesRoutes,
  mcpRoutes,
  secretsRoutes,
  memoriesRoutes,
  contextRoutes,
  goalsRoutes,
  jobsRoutes,
  hooksRoutes,
  agentsRoutes,
  schedulesRoutes,
  worktreesRoutes,
  handoffRoutes,
  pluginsRoutes,
  lspRoutes,
  teamsRoutes,
  traceRoutes,
]
