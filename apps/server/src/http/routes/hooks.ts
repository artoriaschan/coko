// 外部 Hook（ADR 0013）：GET / PUT /api/hooks 与 POST /api/hooks/approvals（路径相对 /api）。项目 Hook 按 Session 的工作目录读取。
import { ApproveHookRequest, UpdateHooksRequest } from '@coko/protocol'
import type { Application } from '../../application/index.ts'
import { AppError } from '../../application/errors.ts'
import { requireSession } from '../../application/session-runtimes.ts'
import { body, domainRouter } from './shared.ts'

export function hooksRoutes(app: Application) {
  const r = domainRouter()
  /** Session 的 Workspace 与工作目录（worktree 会话为其 worktree）。 */
  const project = async (sessionId: string) => {
    const session = await requireSession(app.store, sessionId)
    const { workspace, cwd } = await app.sessions.runs.cwd(session)
    return { workspaceId: workspace.id, cwd }
  }
  r.get('/hooks', async (c) => {
    const sessionId = c.req.query('sessionId') || undefined
    return c.json(await app.hooks.get(sessionId === undefined ? undefined : await project(sessionId)))
  })
  r.put('/hooks', async (c) => c.json(await app.hooks.update(await body(c, UpdateHooksRequest))))
  r.post('/hooks/approvals', async (c) => {
    const request = await body(c, ApproveHookRequest)
    let cwd: string
    if (request.sessionId !== undefined) {
      const target = await project(request.sessionId)
      if (target.workspaceId !== request.workspaceId) throw new AppError('bad-request', 'The session does not belong to this workspace')
      cwd = target.cwd
    } else {
      const workspace = await app.store.sessions.getWorkspace(request.workspaceId)
      if (!workspace) throw new AppError('not-found', `Workspace ${request.workspaceId} not found`)
      cwd = workspace.path
    }
    await app.hooks.approve(request, cwd)
    return c.body(null, 204)
  })
  return r
}
