import {
  AbortRunResponse,
  API_ROUTES,
  apiPaths,
  ErrorResponse,
  Session,
  SessionDetailResponse,
  SessionListResponse,
  SubmitMessageResponse,
  Workspace,
  WorkspaceListResponse,
  type CreateSessionRequest,
  type ErrorCode,
} from '@coko/protocol'
import type { TSchema, Static } from 'typebox'
import { Value } from 'typebox/value'

/** 协议错误；code 为协议错误码，或 renderer 自身的 network / bad-response。 */
export class ApiError extends Error {
  readonly code: ErrorCode | 'network' | 'bad-response'
  readonly status: number

  constructor(code: ApiError['code'], message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
  }
}

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>

/** Sidecar HTTP 客户端：同源相对路径，经 coko-app:// 代理附加认证；响应在信任边界按 schema 校验。 */
export function createApiClient(fetchImpl: Fetch = (input, init) => fetch(input, init)) {
  async function call<S extends TSchema>(schema: S, method: string, path: string, body?: unknown): Promise<Static<S>> {
    let response: Response
    try {
      response = await fetchImpl(path, {
        method,
        ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
      })
    } catch (error) {
      throw new ApiError('network', error instanceof Error ? error.message : String(error), 0)
    }
    const value: unknown = await response.json().catch(() => undefined)
    if (!response.ok) {
      if (Value.Check(ErrorResponse, value)) throw new ApiError(value.error.code, value.error.message, response.status)
      throw new ApiError('bad-response', `Request failed with status ${response.status}`, response.status)
    }
    if (!Value.Check(schema, value)) throw new ApiError('bad-response', `Unexpected response for ${method} ${path}`, response.status)
    return value as Static<S>
  }

  return {
    listWorkspaces: async () => (await call(WorkspaceListResponse, 'GET', API_ROUTES.workspaces)).workspaces,
    registerWorkspace: (path: string) => call(Workspace, 'POST', API_ROUTES.workspaces, { path }),
    listSessions: async () => (await call(SessionListResponse, 'GET', API_ROUTES.sessions)).sessions,
    createSession: (input: CreateSessionRequest) => call(Session, 'POST', API_ROUTES.sessions, input),
    sessionDetail: (id: string) => call(SessionDetailResponse, 'GET', apiPaths.session(id)),
    submitMessage: (id: string, text: string) => call(SubmitMessageResponse, 'POST', apiPaths.sessionMessages(id), { text }),
    abortRun: (id: string) => call(AbortRunResponse, 'POST', apiPaths.sessionAbort(id), {}),
  }
}

export type ApiClient = ReturnType<typeof createApiClient>
