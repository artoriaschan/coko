// 代码智能（/api/lsp）的路由（路径相对 /api）。修改配置与重启在接入之前为 501。
import type { LspResponse } from '@coko/protocol'
import type { Application } from '../../application/index.ts'
import { domainRouter } from './shared.ts'

export function lspRoutes(app: Application) {
  const { lsp } = app
  const r = domainRouter()
  r.get('/lsp', async (c) => c.json((await lsp.get()) satisfies LspResponse))
  r.put('/lsp', () => lsp.notImplemented())
  r.post('/lsp/restart', () => lsp.notImplemented())
  return r
}
