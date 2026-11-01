// 观测（/api/sessions/:id/{trace,audit,export}）的路由（路径相对 /api）。export 为 application/x-ndjson 的附件；?children=1 含子 Session。
import type { AuditResponse, TraceResponse } from '@coko/protocol'
import type { Application } from '../../application/index.ts'
import { domainRouter } from './shared.ts'

export function traceRoutes(app: Application) {
  const { trace } = app
  const r = domainRouter()
  r.get('/sessions/:id/trace', async (c) => c.json((await trace.trace(c.req.param('id'))) satisfies TraceResponse))
  r.get('/sessions/:id/audit', async (c) => c.json((await trace.audit(c.req.param('id'))) satisfies AuditResponse))
  r.get('/sessions/:id/export', async (c) => {
    const exported = await trace.export(c.req.param('id'), { children: c.req.query('children') === '1' })
    return c.body(exported.text, 200, {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'content-disposition': `attachment; filename="${exported.filename}"`,
      'cache-control': 'no-store',
    })
  })
  return r
}
