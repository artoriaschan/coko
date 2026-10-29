// GET /api/sessions/:id/context、GET /api/workspaces/:id/context：上下文用量（路径相对 /api）。
import type { ContextUsageResponse } from '@coko/protocol'
import { contextUsage } from '../../application/context/usage.ts'
import { AppError } from '../../application/errors.ts'
import type { Application } from '../../application/index.ts'
import { domainRouter } from './shared.ts'

export function contextRoutes(app: Application) {
  const r = domainRouter()
  r.get('/sessions/:id/context', async (c) => {
    const session = await app.store.sessions.getSession(c.req.param('id'))
    if (!session) throw new AppError('not-found', `Session ${c.req.param('id')} not found`)
    const workspace = await app.store.sessions.getWorkspace(session.workspaceId)
    if (!workspace) throw new AppError('not-found', `Workspace ${session.workspaceId} not found`)
    const [scope, entries, model] = await Promise.all([
      app.context.scope({ workspaceId: workspace.id, cwd: workspace.path, sessionId: session.id }),
      app.store.sessions.listEntries(session.id),
      app.sessions.contextModel(session.model),
    ])
    const body: ContextUsageResponse = await contextUsage({
      context: app.context,
      scope,
      baseTools: app.sessions.baseTools(workspace.path),
      model,
      entries,
      autoCompactPaused: app.sessions.compactionPaused(session.id),
    })
    return c.json(body)
  })
  r.get('/workspaces/:id/context', async (c) => {
    const workspace = await app.store.sessions.getWorkspace(c.req.param('id'))
    if (!workspace) throw new AppError('not-found', `Workspace ${c.req.param('id')} not found`)
    const [scope, model] = await Promise.all([app.context.scope({ workspaceId: workspace.id, cwd: workspace.path }), app.sessions.contextModel(undefined)])
    const body: ContextUsageResponse = await contextUsage({
      context: app.context,
      scope,
      baseTools: app.sessions.baseTools(workspace.path),
      model,
      entries: [],
    })
    return c.json(body)
  })
  return r
}
