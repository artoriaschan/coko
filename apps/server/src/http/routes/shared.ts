// 路由共用：Hono 环境类型、请求体校验与错误响应体。app.ts 与 routes/<domain>.ts 都从这里导入。
import type { HttpBindings } from '@hono/node-server'
import { Hono, type Context } from 'hono'
import type { TSchema, Static } from 'typebox'
import { Value } from 'typebox/value'
import type { ErrorResponse } from '@coko/protocol'
import { AppError } from '../../application/errors.ts'
import type { Application } from '../../application/index.ts'

export type Env = { Bindings: HttpBindings; Variables: { requestId: string } }

export function errorBody(error: AppError): ErrorResponse {
  return { error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) } }
}

export async function body<S extends TSchema>(c: Context<Env>, schema: S): Promise<Static<S>> {
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

/** 一个领域的路由：路径相对 /api，由 app.ts 在认证之后挂载。 */
export type DomainRoutes = (app: Application) => Hono<Env>

export const domainRouter = () => new Hono<Env>()
