// 观测（/api/sessions/:id/{trace,audit,export}）的路由（路径相对 /api）。导出在接入之前为 501。
import type { AuditResponse, TraceResponse } from '@coko/protocol'
import type { Application } from '../../application/index.ts'
import { domainRouter } from './shared.ts'

export function traceRoutes(app: Application) {
  const { trace } = app
  const r = domainRouter()
  r.get('/sessions/:id/trace', async (c) => c.json((await trace.trace(c.req.param('id'))) satisfies TraceResponse))
  r.get('/sessions/:id/audit', async (c) => c.json((await trace.audit(c.req.param('id'))) satisfies AuditResponse))
  r.get('/sessions/:id/export', async (c) => trace.export(c.req.param('id')))
  return r
}
