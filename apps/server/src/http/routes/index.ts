// 各领域的路由：每个领域一个 routes/<domain>.ts，在这里登记一次。
import { commandsRoutes } from './commands.ts'
import { configRoutes } from './config.ts'
import { contextRoutes } from './context.ts'
import { filesRoutes } from './files.ts'
import { mcpRoutes } from './mcp.ts'
import { memoriesRoutes } from './memories.ts'
import { secretsRoutes } from './secrets.ts'
import type { DomainRoutes } from './shared.ts'
import { skillsRoutes } from './skills.ts'

export const DOMAIN_ROUTES: readonly DomainRoutes[] = [
  configRoutes,
  commandsRoutes,
  skillsRoutes,
  filesRoutes,
  mcpRoutes,
  secretsRoutes,
  memoriesRoutes,
  contextRoutes,
]
