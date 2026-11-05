import { ResolveArtifactRequest } from '@coko/protocol'
import type { Application } from '../../application/index.ts'
import { body, domainRouter } from './shared.ts'

export function artifactsRoutes(app: Application) {
  const r = domainRouter()
  r.get('/sessions/:id/artifacts', async (c) => c.json({ artifacts: await app.artifacts.list(c.req.param('id')) }))
  r.post('/sessions/:id/artifacts/resolve', async (c) =>
    c.json({ path: await app.artifacts.resolve(c.req.param('id'), (await body(c, ResolveArtifactRequest)).path) }),
  )
  return r
}
