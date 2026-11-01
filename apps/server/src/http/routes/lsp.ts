// 代码智能（/api/lsp）的路由（路径相对 /api）：GET 配置与状态（?sessionId= 或 ?workspaceId=）、PUT 一个作用域的服务器、POST 重启。
import { RestartLspRequest, UpdateLspRequest, type LspResponse } from '@coko/protocol'
import type { Application } from '../../application/index.ts'
import { body, domainRouter } from './shared.ts'

export function lspRoutes(app: Application) {
  const { lsp } = app
  const r = domainRouter()
  r.get('/lsp', async (c) => {
    const sessionId = c.req.query('sessionId') || undefined
    const workspaceId = c.req.query('workspaceId') || undefined
    const target = sessionId !== undefined ? { sessionId } : workspaceId !== undefined ? { workspaceId } : undefined
    return c.json((await lsp.get(target)) satisfies LspResponse)
  })
  r.put('/lsp', async (c) => c.json((await lsp.update(await body(c, UpdateLspRequest))) satisfies LspResponse))
  r.post('/lsp/restart', async (c) => {
    const request = await body(c, RestartLspRequest)
    await lsp.restart(request.name, request.cwd)
    return c.body(null, 204)
  })
  return r
}
