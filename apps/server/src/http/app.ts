import { randomUUID } from 'node:crypto'
import type { HttpBindings } from '@hono/node-server'
import { upgradeWebSocket } from '@hono/node-server'
import { Hono, type Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { TSchema, Static } from 'typebox'
import { Value } from 'typebox/value'
import { getLogger } from '@coko/logging'
import {
  AnswerApprovalRequest,
  API_ROUTES,
  AuthExchangeRequest,
  CreateProviderRequest,
  isMainOnlyPath,
  CreateSessionRequest,
  permissionPaths,
  SessionPermissionRuleRequest,
  SetPermissionModeRequest,
  UpdatePermissionsRequest,
  RegisterWorkspaceRequest,
  SteerRequest,
  SetSessionModelRequest,
  SubmitMessageRequest,
  UpdateProviderRequest,
  UpdateSettingRequest,
  type ErrorResponse,
} from '@coko/protocol'
import { AppError, toAppError } from '../application/errors.ts'
import type { Application } from '../application/index.ts'
import { StreamConnection } from '../ws/connection.ts'
import type { AccessAuth } from './auth.ts'

const log = getLogger(['http'])

type Env = { Bindings: HttpBindings; Variables: { requestId: string } }

/** 打开中的 WebSocket，关闭 sidecar 时以 1001 关闭。 */
export interface SocketRegistry {
  add(socket: { close(code?: number, reason?: string): void }): () => void
}

function errorBody(error: AppError): ErrorResponse {
  return { error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) } }
}

async function body<S extends TSchema>(c: Context<Env>, schema: S): Promise<Static<S>> {
  let value: unknown
  try {
    value = await c.req.json()
  } catch {
    throw new AppError('bad-request', 'Request body must be JSON')
  }
  if (!Value.Check(schema, value)) {
    const first = Value.Errors(schema, value)[0]
    throw new AppError('bad-request', first ? `Invalid request: ${first.instancePath || '/'} ${first.message}` : 'Invalid request')
  }
  return value as Static<S>
}

/** Hono 路由。顺序：请求日志 → 信任围栏（403）→ main-only 路由守卫（404）→ 令牌交换 → cookie 校验（401）→ 业务路由。 */
export function createApp(options: { auth: AccessAuth; app: Application; sockets: SocketRegistry }) {
  const { auth, app, sockets } = options
  const http = new Hono<Env>()

  http.use(async (c, next) => {
    const requestId = randomUUID()
    c.set('requestId', requestId)
    const started = performance.now()
    await next()
    log.info('request {method} {path} {status}', {
      requestId,
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      durationMs: Math.round(performance.now() - started),
    })
  })

  http.use(async (c, next) => {
    if (!auth.isTrusted(c.env.incoming.headers)) return c.json(errorBody(new AppError('forbidden', 'Request is not trusted')), 403)
    return next()
  })

  // main-only 路由只接受 main 的调用方式：原样路径、POST、不带 cookie。经 renderer 代理的请求总带 main 注入的 cookie，
  // 编码变体（%65xchange、末尾斜杠、大小写、重复斜杠）规范化后同样命中前缀，一律 404。
  http.use(async (c, next) => {
    const raw = (c.env.incoming.url ?? '').split('?')[0] ?? ''
    if (!isMainOnlyPath(raw)) return next()
    const fromMain = raw === API_ROUTES.authExchange && c.req.method === 'POST' && c.env.incoming.headers.cookie === undefined
    if (!fromMain) return c.json(errorBody(new AppError('not-found', 'Not found')), 404)
    return next()
  })

  http.post(API_ROUTES.authExchange, async (c) => {
    const { token } = await body(c, AuthExchangeRequest)
    const cookie = auth.exchange(token)
    if (!cookie) return c.json(errorBody(new AppError('unauthorized', 'Invalid or already used launch token')), 401)
    c.header('set-cookie', cookie)
    c.header('cache-control', 'no-store')
    return c.body(null, 204)
  })

  http.use(async (c, next) => {
    if (!auth.isAuthenticated(c.env.incoming.headers)) return c.json(errorBody(new AppError('unauthorized', 'Authentication required')), 401)
    return next()
  })

  http.get(API_ROUTES.health, (c) => c.json({ status: 'ok' as const }))

  http.get(
    API_ROUTES.stream,
    upgradeWebSocket(() => {
      let connection: StreamConnection | undefined
      let release: (() => void) | undefined
      return {
        onOpen(_event, ws) {
          connection = new StreamConnection({ store: app.store, hub: app.hub, isRunning: (id) => app.sessions.isRunning(id) }, (message) => {
            if (ws.readyState === 1) ws.send(JSON.stringify(message))
          })
          release = sockets.add(ws)
        },
        onMessage(event) {
          connection?.receive(event.data).catch((error: unknown) => log.error('stream message failed', { error: String(error) }))
        },
        onClose() {
          connection?.close()
          release?.()
        },
      }
    }),
  )

  http.get(API_ROUTES.workspaces, async (c) => c.json({ workspaces: await app.workspaces.list() }))
  http.post(API_ROUTES.workspaces, async (c) => c.json(await app.workspaces.register(await body(c, RegisterWorkspaceRequest)), 201))

  http.get(API_ROUTES.sessions, async (c) => c.json({ sessions: await app.sessions.list(c.req.query('workspaceId')) }))
  http.post(API_ROUTES.sessions, async (c) => c.json(await app.sessions.create(await body(c, CreateSessionRequest)), 201))
  http.get(`${API_ROUTES.sessions}/:id`, async (c) => c.json(await app.sessions.detail(c.req.param('id'))))
  http.post(`${API_ROUTES.sessions}/:id/messages`, async (c) => {
    const { text } = await body(c, SubmitMessageRequest)
    return c.json(await app.sessions.submit(c.req.param('id'), text), 202)
  })
  http.post(`${API_ROUTES.sessions}/:id/retry`, async (c) => c.json(await app.sessions.retry(c.req.param('id')), 202))
  http.post(`${API_ROUTES.sessions}/:id/abort`, async (c) => c.json({ aborted: await app.sessions.abort(c.req.param('id')) }))
  http.post(`${API_ROUTES.sessions}/:id/steer`, async (c) => {
    const { text } = await body(c, SteerRequest)
    await app.sessions.steer(c.req.param('id'), text)
    return c.body(null, 204)
  })
  http.post(`${API_ROUTES.sessions}/:id/pause`, async (c) => {
    await app.sessions.pause(c.req.param('id'))
    return c.body(null, 204)
  })
  http.post(`${API_ROUTES.sessions}/:id/continue`, async (c) => c.json(await app.sessions.continue(c.req.param('id')), 202))
  http.post(`${API_ROUTES.sessions}/:id/approvals/:requestId`, async (c) => {
    await app.sessions.answerApproval(c.req.param('id'), c.req.param('requestId'), await body(c, AnswerApprovalRequest))
    return c.body(null, 204)
  })
  http.get(`${API_ROUTES.sessions}/:id/permission-rules`, async (c) => c.json(await app.sessions.sessionPermissions(c.req.param('id'))))
  http.put(`${API_ROUTES.sessions}/:id/permission-mode`, async (c) => {
    const { mode } = await body(c, SetPermissionModeRequest)
    return c.json(await app.sessions.setPermissionMode(c.req.param('id'), mode))
  })
  http.post(`${API_ROUTES.sessions}/:id/permission-rules`, async (c) => {
    const { rule } = await body(c, SessionPermissionRuleRequest)
    return c.json(await app.sessions.changeSessionRule(c.req.param('id'), 'add', rule))
  })
  http.delete(`${API_ROUTES.sessions}/:id/permission-rules`, async (c) => {
    const { rule } = await body(c, SessionPermissionRuleRequest)
    return c.json(await app.sessions.changeSessionRule(c.req.param('id'), 'remove', rule))
  })
  http.get(permissionPaths.permissions, async (c) => c.json(await app.sessions.getPermissions(c.req.query('workspaceId') || undefined)))
  http.put(permissionPaths.permissions, async (c) => c.json(await app.sessions.updatePermissions(await body(c, UpdatePermissionsRequest))))
  http.put(`${API_ROUTES.sessions}/:id/model`, async (c) => {
    const { model } = await body(c, SetSessionModelRequest)
    return c.json(await app.sessions.setModel(c.req.param('id'), model))
  })

  http.get(API_ROUTES.settings, async (c) => c.json({ settings: await app.settings.list() }))
  http.put(`${API_ROUTES.settings}/:key`, async (c) => {
    const { value, expectedRevision } = await body(c, UpdateSettingRequest)
    return c.json(await app.settings.put(c.req.param('key'), value, expectedRevision))
  })

  http.get(API_ROUTES.providers, async (c) => c.json({ providers: await app.providers.list() }))
  http.get(API_ROUTES.providerPresets, (c) => c.json({ presets: app.providers.presets() }))
  http.get(API_ROUTES.models, async (c) => c.json({ models: app.providers.models(), defaultModel: (await app.sessions.defaultModel()) ?? null }))
  http.post(API_ROUTES.providers, async (c) => c.json(await app.providers.create(await body(c, CreateProviderRequest)), 201))
  http.patch(`${API_ROUTES.providers}/:id`, async (c) => c.json(await app.providers.update(c.req.param('id'), await body(c, UpdateProviderRequest))))
  http.delete(`${API_ROUTES.providers}/:id`, async (c) => {
    await app.providers.delete(c.req.param('id'))
    return c.body(null, 204)
  })

  http.notFound((c) => c.json(errorBody(new AppError('not-found', 'Not found')), 404))
  http.onError((error, c) => {
    const appError = toAppError(error)
    if (appError.code === 'internal' || appError.code === 'storage-unavailable') {
      log.error('request failed', { requestId: c.get('requestId'), error: error instanceof Error ? error.message : String(error) })
    }
    return c.json(errorBody(appError), appError.status as ContentfulStatusCode)
  })

  return http
}
