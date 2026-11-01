// 插件（/api/plugins）的路由（路径相对 /api），ADR 0017：列表、安装（201）、启停、批准、更新与卸载（204）。
import { ApprovePluginRequest, InstallPluginRequest, UpdatePluginRequest, type PluginInfo, type PluginListResponse } from '@coko/protocol'
import type { Application } from '../../application/index.ts'
import { body, domainRouter } from './shared.ts'

export function pluginsRoutes(app: Application) {
  const { plugins } = app
  const r = domainRouter()
  r.get('/plugins', async (c) => c.json((await plugins.list()) satisfies PluginListResponse))
  r.post('/plugins', async (c) => c.json((await plugins.install((await body(c, InstallPluginRequest)).source)) satisfies PluginInfo, 201))
  r.patch('/plugins/:name', async (c) =>
    c.json((await plugins.setEnabled(c.req.param('name'), (await body(c, UpdatePluginRequest)).enabled)) satisfies PluginInfo),
  )
  r.delete('/plugins/:name', async (c) => {
    await plugins.uninstall(c.req.param('name'))
    return c.body(null, 204)
  })
  r.post('/plugins/:name/approve', async (c) =>
    c.json((await plugins.approve(c.req.param('name'), (await body(c, ApprovePluginRequest)).digest)) satisfies PluginInfo),
  )
  r.post('/plugins/:name/update', async (c) => c.json((await plugins.update(c.req.param('name'))) satisfies PluginInfo))
  return r
}
