// GET /api/commands?sessionId=… | workspaceId=…（票 04）：该 Workspace 的命令目录与诊断（路径相对 /api）。
import type { CommandListResponse } from '@coko/protocol'
import { isCommandsContribution } from '../../application/context/commands.ts'
import { AppError } from '../../application/errors.ts'
import type { Application } from '../../application/index.ts'
import { domainRouter } from './shared.ts'

export function commandsRoutes(app: Application) {
  const r = domainRouter()
  r.get('/commands', async (c) => {
    const sessionId = c.req.query('sessionId') || undefined
    let workspaceId = c.req.query('workspaceId') || undefined
    if (sessionId === undefined && workspaceId === undefined) throw new AppError('bad-request', 'sessionId or workspaceId is required')
    if (sessionId !== undefined) {
      const session = await app.store.sessions.getSession(sessionId)
      if (!session) throw new AppError('not-found', `Session ${sessionId} not found`)
      workspaceId = session.workspaceId
    }
    const workspace = await app.store.sessions.getWorkspace(workspaceId!)
    if (!workspace) throw new AppError('not-found', `Workspace ${workspaceId} not found`)
    const scope = await app.context.scope({ workspaceId: workspace.id, cwd: workspace.path, ...(sessionId === undefined ? {} : { sessionId }) })
    const commands = app.context.contributions.find(isCommandsContribution)
    const body: CommandListResponse = commands ? await commands.list(scope) : { commands: [], diagnostics: [] }
    return c.json(body)
  })
  return r
}
