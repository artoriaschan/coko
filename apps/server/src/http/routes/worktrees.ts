// Worktree（ADR 0016）的路由（路径相对 /api）：Workspace 的 worktree 列表与创建、移除、会话的 git 状态。
import { CreateWorktreeRequest } from '@coko/protocol'
import type { Application } from '../../application/index.ts'
import { body, domainRouter } from './shared.ts'

export function worktreesRoutes(app: Application) {
  const { worktrees } = app
  const r = domainRouter()
  r.get('/workspaces/:id/worktrees', async (c) => c.json(await worktrees.list(c.req.param('id'))))
  r.post('/workspaces/:id/worktrees', async (c) => c.json(await worktrees.create(c.req.param('id'), await body(c, CreateWorktreeRequest)), 201))
  r.delete('/worktrees/:id', async (c) => {
    await worktrees.remove(c.req.param('id'))
    return c.body(null, 204)
  })
  r.get('/sessions/:id/git-status', async (c) => c.json(await worktrees.gitStatusOf(c.req.param('id'))))
  return r
}
