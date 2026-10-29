// GET /api/secrets、DELETE /api/secrets/:name（路径相对 /api）。值只经控制 IPC secret.store 登记，HTTP 不携带值。
import type { Application } from '../../application/index.ts'
import { domainRouter } from './shared.ts'

export function secretsRoutes(app: Application) {
  const r = domainRouter()
  r.get('/secrets', async (c) => c.json(await app.secrets.list()))
  r.delete('/secrets/:name', async (c) => {
    await app.secrets.delete(c.req.param('name'))
    return c.body(null, 204)
  })
  return r
}
