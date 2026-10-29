// GET / PUT /api/config：有效能力配置、全局值与项目设置文件（路径相对 /api）。
import { UpdateConfigRequest } from '@coko/protocol'
import type { Application } from '../../application/index.ts'
import { body, domainRouter } from './shared.ts'

export function configRoutes(app: Application) {
  const r = domainRouter()
  r.get('/config', async (c) => c.json(await app.config.get(c.req.query('workspaceId') || undefined)))
  r.put('/config', async (c) => c.json(await app.config.update(await body(c, UpdateConfigRequest))))
  return r
}
