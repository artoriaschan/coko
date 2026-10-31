// 插件（/api/plugins）的路由（路径相对 /api），ADR 0017。安装、批准、启停、更新与卸载在接入之前为 501。
import type { PluginListResponse } from '@coko/protocol'
import type { Application } from '../../application/index.ts'
import { domainRouter } from './shared.ts'

export function pluginsRoutes(app: Application) {
  const { plugins } = app
  const r = domainRouter()
  r.get('/plugins', async (c) => c.json((await plugins.list()) satisfies PluginListResponse))
  r.post('/plugins', () => plugins.notImplemented())
  r.patch('/plugins/:name', () => plugins.notImplemented())
  r.delete('/plugins/:name', () => plugins.notImplemented())
  r.post('/plugins/:name/approve', () => plugins.notImplemented())
  r.post('/plugins/:name/update', () => plugins.notImplemented())
  return r
}
