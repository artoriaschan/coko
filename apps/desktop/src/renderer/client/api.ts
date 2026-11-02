import type { ImageAttachment } from '@coko/protocol'
import {
  AbortRunResponse,
  API_ROUTES,
  apiPaths,
  checkpointPaths,
  CheckpointListResponse,
  ForkResponse,
  FirstSendResponse,
  RewindResponse,
  ErrorResponse,
  ModelListResponse,
  permissionPaths,
  PermissionsResponse,
  ProjectListResponse,
  CreateProjectResponse,
  CheckProjectFolderResponse,
  ProviderListResponse,
  ProviderReferencesResponse,
  runPaths,
  Session,
  SessionDetailResponse,
  SessionListResponse,
  DeleteSessionResponse,
  SessionPermissionsResponse,
  Setting,
  SettingsResponse,
  SubmitMessageResponse,
  Workspace,
  WorkspaceListResponse,
  type AnswerApprovalRequest,
  type ConfirmationAnswer,
  type CreateSessionRequest,
  type ProjectFields,
  type FirstSendRequest,
  type ErrorCode,
  type PermissionMode,
  type PermissionRule,
  type RewindRequest,
  type SessionModel,
  type ThinkingLevel,
  type UpdatePermissionsRequest,
} from '@coko/protocol'
import { Type, type TSchema, type Static } from 'typebox'
import { Value } from 'typebox/value'

/** 协议错误；code 为协议错误码，或 renderer 自身的 network / bad-response。 */
export class ApiError extends Error {
  readonly code: ErrorCode | 'network' | 'bad-response'
  readonly status: number
  readonly details: Record<string, unknown> | undefined

  constructor(code: ApiError['code'], message: string, status: number, details?: Record<string, unknown>) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
    this.details = details
  }
}

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>

/** 204 无响应体。 */
const NoContent = Type.Undefined()

const defaultFetch: Fetch = (input, init) => fetch(input, init)

/**
 * 一次 Sidecar HTTP 调用：同源相对路径，经 coko-app:// 代理附加认证；响应在信任边界按 schema 校验。
 * 失败时抛 ApiError：错误体按 ErrorResponse 校验，不合法时为 bad-response；204 的响应体为 undefined。
 */
export async function requestJson<S extends TSchema>(
  schema: S,
  method: string,
  path: string,
  body?: unknown,
  fetchImpl: Fetch = defaultFetch,
): Promise<Static<S>> {
  let response: Response
  try {
    response = await fetchImpl(path, {
      method,
      ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    })
  } catch (error) {
    throw new ApiError('network', error instanceof Error ? error.message : String(error), 0)
  }
  const value: unknown = response.status === 204 ? undefined : await response.json().catch(() => undefined)
  if (!response.ok) {
    if (Value.Check(ErrorResponse, value)) throw new ApiError(value.error.code, value.error.message, response.status, value.error.details)
    throw new ApiError('bad-response', `Request failed with status ${response.status}`, response.status)
  }
  if (!Value.Check(schema, value)) throw new ApiError('bad-response', `Unexpected response for ${method} ${path}`, response.status)
  return value as Static<S>
}

/** Sidecar HTTP 客户端，每个方法经 requestJson。 */
export function createApiClient(fetchImpl: Fetch = defaultFetch) {
  const call = <S extends TSchema>(schema: S, method: string, path: string, body?: unknown): Promise<Static<S>> =>
    requestJson(schema, method, path, body, fetchImpl)

  return {
    listProjects: async () => (await call(ProjectListResponse, 'GET', API_ROUTES.projects)).projects,
    listWorkspaces: async () => (await call(WorkspaceListResponse, 'GET', API_ROUTES.workspaces)).workspaces,
    registerWorkspace: (path: string) => call(Workspace, 'POST', API_ROUTES.workspaces, { path }),
    listSessions: async () => (await call(SessionListResponse, 'GET', API_ROUTES.sessions)).sessions,
    setSessionPinned: (id: string, pinned: boolean) => call(Session, 'PUT', apiPaths.sessionPin(id), { pinned }),
    deleteSession: (id: string) => call(DeleteSessionResponse, 'DELETE', apiPaths.session(id)),
    renameSession: (id: string, title: string) => call(Session, 'PUT', apiPaths.sessionTitle(id), { title }),
    createSession: (input: CreateSessionRequest) => call(Session, 'POST', API_ROUTES.sessions, input),
    firstSend: (input: FirstSendRequest) => call(FirstSendResponse, 'POST', API_ROUTES.firstSend, input),
    sessionDetail: (id: string) => call(SessionDetailResponse, 'GET', apiPaths.session(id)),
    /** 202 返回新 runId；不开始 Run 的动作（例如 /goal pause）为 204，返回 { done: true }。 */
    submitMessage: async (id: string, text: string, images?: ImageAttachment[]): Promise<SubmitMessageResponse | { done: true }> =>
      (await call(Type.Union([SubmitMessageResponse, NoContent]), 'POST', apiPaths.sessionMessages(id), { text, ...(images?.length ? { images } : {}) })) ?? {
        done: true as const,
      },
    /** 重新执行出错的上一轮，不追加用户消息。 */
    retryRun: (id: string) => call(SubmitMessageResponse, 'POST', apiPaths.sessionRetry(id), {}),
    abortRun: (id: string) => call(AbortRunResponse, 'POST', apiPaths.sessionAbort(id), {}),
    /** 追加指令：当前工具批次结束后送达；没有进行中的 Run 时以 no-active-run 拒绝。 */
    steerRun: (id: string, text: string) => call(NoContent, 'POST', runPaths.sessionSteer(id), { text }),
    /** 暂停：当前批次完成后停下，Run 以 paused 结束。 */
    pauseRun: (id: string) => call(NoContent, 'POST', runPaths.sessionPause(id), {}),
    /** 接着暂停或中断的上一 Run；202 返回新 runId。 */
    continueRun: (id: string) => call(SubmitMessageResponse, 'POST', runPaths.sessionContinue(id), {}),
    /** 回答待审批请求；请求不在等待中时以 approval-not-pending 拒绝。 */
    answerApproval: (id: string, requestId: string, answer: AnswerApprovalRequest) => call(NoContent, 'POST', apiPaths.sessionApproval(id, requestId), answer),
    /** 回答恢复时结果不明的调用；没有待回答的确认时以 not-found 拒绝。 */
    answerConfirmation: (id: string, toolCallId: string, answer: ConfirmationAnswer) =>
      call(NoContent, 'POST', runPaths.sessionConfirmation(id, toolCallId), { answer }),
    /** 有效上下文中的用户消息（Checkpoint）与回退代码到该处时涉及的路径。 */
    listCheckpoints: async (id: string) => (await call(CheckpointListResponse, 'GET', checkpointPaths.sessionCheckpoints(id))).checkpoints,
    /** 回退（dryRun 只返回将发生的变化）；Run 进行中或等待审批时以 session-busy 拒绝。 */
    rewind: (id: string, request: RewindRequest) => call(RewindResponse, 'POST', checkpointPaths.sessionRewind(id), request),
    /** 从某条用户消息分叉：返回新 Session 的 id 与目标文本。 */
    fork: (id: string, targetSeq: number, title?: string) =>
      call(ForkResponse, 'POST', checkpointPaths.sessionFork(id), { targetSeq, ...(title === undefined ? {} : { title }) }),
    /** thinkingLevel 缺省时 Sidecar 保留当前档位（新模型不能选它时回到 off）。 */
    setSessionModel: (id: string, model: SessionModel, thinkingLevel?: ThinkingLevel) =>
      call(Session, 'PUT', apiPaths.sessionModel(id), { model, ...(thinkingLevel === undefined ? {} : { thinkingLevel }) }),
    /** 切换 Session 的 Permission Mode；返回当前模式与 Session 规则。 */
    setPermissionMode: (id: string, mode: PermissionMode) => call(SessionPermissionsResponse, 'PUT', permissionPaths.sessionPermissionMode(id), { mode }),
    removeSessionRule: (id: string, rule: PermissionRule) => call(SessionPermissionsResponse, 'DELETE', permissionPaths.sessionPermissionRules(id), { rule }),
    /** 默认模式与全局规则；给出 workspaceId 时另带该 Workspace 的规则。 */
    getPermissions: (workspaceId?: string) =>
      call(
        PermissionsResponse,
        'GET',
        workspaceId ? `${permissionPaths.permissions}?workspaceId=${encodeURIComponent(workspaceId)}` : permissionPaths.permissions,
      ),
    /** revision 不一致时以 revision-conflict 拒绝。 */
    updatePermissions: (request: UpdatePermissionsRequest) => call(PermissionsResponse, 'PUT', permissionPaths.permissions, request),
    listSettings: async () => (await call(SettingsResponse, 'GET', API_ROUTES.settings)).settings,
    /** expectedRevision 不一致时以 revision-conflict 拒绝，details 带 expected 与 actual。 */
    putSetting: (key: string, value: unknown, expectedRevision: number) => call(Setting, 'PUT', apiPaths.setting(key), { value, expectedRevision }),
    listProviders: async () => (await call(ProviderListResponse, 'GET', API_ROUTES.providers)).providers,
    /** 引用该 Provider 的 Session 数量；删除确认用。 */
    providerReferences: (id: string) => call(ProviderReferencesResponse, 'GET', apiPaths.providerReferences(id)),
    /** 同时删除其 Credential；引用它的 Session 模型字段被清空，默认模型指向它时回退。 */
    deleteProvider: (id: string) => call(NoContent, 'DELETE', apiPaths.provider(id)),
    listModels: () => call(ModelListResponse, 'GET', API_ROUTES.models),
  }
}

export type ApiClient = ReturnType<typeof createApiClient>

/** 项目表单的协议边界；不依赖会话生命周期。 */
export const projectApi = {
  create: (input: ProjectFields) => requestJson(CreateProjectResponse, 'POST', API_ROUTES.projects, input),
  checkFolder: (path: string) => requestJson(CheckProjectFolderResponse, 'POST', API_ROUTES.projectFolderCheck, { path }),
}
