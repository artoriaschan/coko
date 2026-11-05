// GET / PUT /api/config：有效能力配置；GET /api/storage：启动时解析的只读存储路径（路径相对 /api）。
import { UpdateConfigRequest } from '@coko/protocol'
import type { Application } from '../../application/index.ts'
import { body, domainRouter } from './shared.ts'

export function configRoutes(app: Application) {
  const r = domainRouter()
  r.get('/storage', (c) => c.json(app.storage))
  r.get('/config', async (c) => c.json(await app.config.get(c.req.query('workspaceId') || undefined)))
  r.put('/config', async (c) => c.json(await app.config.update(await body(c, UpdateConfigRequest))))
  return r
}
