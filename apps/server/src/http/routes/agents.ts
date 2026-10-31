// 子代理（/api/sessions/:id/agents、/api/agents/definitions）的路由（路径相对 /api），ADR 0014。
import type { AgentDefinitionsResponse, SessionAgentsResponse } from '@coko/protocol'
import type { Application } from '../../application/index.ts'
import { AppError } from '../../application/errors.ts'
import { domainRouter } from './shared.ts'

export function agentsRoutes(app: Application) {
  const { subagents } = app
  const r = domainRouter()
  r.get('/sessions/:id/agents', async (c) => c.json((await subagents.list(c.req.param('id'))) satisfies SessionAgentsResponse))
  r.post('/sessions/:id/agents/:agentId/cancel', async (c) => {
    await subagents.cancel(c.req.param('id'), c.req.param('agentId'))
    return c.body(null, 204)
  })
  r.get('/agents/definitions', async (c) => {
    const workspaceId = c.req.query('workspaceId')
    if (!workspaceId) throw new AppError('bad-request', 'workspaceId is required')
    return c.json((await subagents.definitions(workspaceId)) satisfies AgentDefinitionsResponse)
  })
  return r
}
