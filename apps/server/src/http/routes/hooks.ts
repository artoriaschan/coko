// 外部 Hook（ADR 0013）：GET / PUT /api/hooks 与 POST /api/hooks/approvals（路径相对 /api）。项目 Hook 按 Session 的工作目录读取，
// 没有 Session 时按 Workspace 目录（HookService.projectFor）。
import { ApproveHookRequest, UpdateHooksRequest } from '@coko/protocol'
import type { Application } from '../../application/index.ts'
import { AppError } from '../../application/errors.ts'
import { body, domainRouter } from './shared.ts'

export function hooksRoutes(app: Application) {
  const r = domainRouter()
  r.get('/hooks', async (c) => {
    const sessionId = c.req.query('sessionId') || undefined
    const workspaceId = c.req.query('workspaceId') || undefined
    const target =
      sessionId !== undefined ? await app.hooks.projectFor({ sessionId }) : workspaceId !== undefined ? await app.hooks.projectFor({ workspaceId }) : undefined
    return c.json(await app.hooks.get(target))
  })
  r.put('/hooks', async (c) => c.json(await app.hooks.update(await body(c, UpdateHooksRequest))))
  r.post('/hooks/approvals', async (c) => {
    const request = await body(c, ApproveHookRequest)
    const target = await app.hooks.projectFor(request.sessionId !== undefined ? { sessionId: request.sessionId } : { workspaceId: request.workspaceId })
    if (target.workspaceId !== request.workspaceId) throw new AppError('bad-request', 'The session does not belong to this workspace')
    await app.hooks.approve(request, target.cwd)
    return c.body(null, 204)
  })
  return r
}
