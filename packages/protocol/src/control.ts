import { Type, type Static } from 'typebox'
import { ErrorCode } from './errors.ts'
import { ModelProtocol, Provider, ProviderFields, ProviderId, ProviderSaveMode } from './http.ts'
import { SecretName } from './secrets.ts'

// Sidecar 与 Electron main 之间经 Node IPC（结构化克隆）传递的控制消息：生命周期、inspect-quit、provider.save、provider.models、credential.* 与 secret.*；
// 以及两端共用的按 requestId 挂起请求的工具（运行时无关，只用 setTimeout 与 AbortSignal）。

const strict = { additionalProperties: false } as const
const RequestId = Type.Integer({ minimum: 1 })

/** 32 字节随机启动令牌的 base64url 编码（无填充，43 个字符）。 */
export const LaunchToken = Type.String({ pattern: '^[A-Za-z0-9_-]{43}$' })

export const SidecarStarting = Type.Object({ type: Type.Literal('starting') }, strict)
export const SidecarReady = Type.Object({ type: Type.Literal('ready'), port: Type.Integer({ minimum: 1, maximum: 65535 }), token: LaunchToken }, strict)
export const SidecarFatal = Type.Object({ type: Type.Literal('fatal'), code: Type.String({ minLength: 1 }), message: Type.String() }, strict)
export const SidecarShutdownComplete = Type.Object({ type: Type.Literal('shutdown-complete') }, strict)
/** 对 inspect-quit 的回答：当前未结束的 Run 数量。 */
export const SidecarInspectQuitResult = Type.Object(
  { type: Type.Literal('inspect-quit.result'), requestId: RequestId, activeRuns: Type.Integer({ minimum: 0 }) },
  strict,
)

// ---- Provider 与 Credential（ADR 0004、0010）----
// Node IPC 默认按 JSON 序列化，二进制密文以标准 base64 传输。

/** safeStorage 密文的 base64 编码。 */
export const CredentialCiphertext = Type.String({ minLength: 1, pattern: '^[A-Za-z0-9+/]+={0,2}$' })

/** sidecar 需要某个 Provider 的明文时，请 main 用 safeStorage 解密库中的密文。 */
export const SidecarCredentialDecrypt = Type.Object(
  { type: Type.Literal('credential.decrypt'), requestId: RequestId, ciphertext: CredentialCiphertext },
  strict,
)
/** 对 provider.save 的回答：成功给出保存后的 Provider（只含提示），失败给出错误码；失败时配置与密文都没有写入。 */
export const SidecarProviderSaveResult = Type.Union([
  Type.Object({ type: Type.Literal('provider.save.result'), requestId: RequestId, ok: Type.Literal(true), provider: Provider }, strict),
  Type.Object(
    {
      type: Type.Literal('provider.save.result'),
      requestId: RequestId,
      ok: Type.Literal(false),
      error: Type.Object({ code: ErrorCode, message: Type.String(), details: Type.Optional(Type.Record(Type.String(), Type.Unknown())) }, strict),
    },
    strict,
  ),
])
export type SidecarProviderSaveResult = Static<typeof SidecarProviderSaveResult>

/**
 * 获取可用模型的失败原因：no-credential（编辑时没有已保存的 Key）、bad-request（地址不是 http(s) 或请求不合要求）、
 * unreachable（连不上或网络错误）、upstream-error（供应商返回非 2xx，带 status）、invalid-response（返回体不是模型列表）、
 * timeout、cancelled。
 */
export const ProviderModelsErrorCode = Type.Union([
  Type.Literal('no-credential'),
  Type.Literal('bad-request'),
  Type.Literal('unreachable'),
  Type.Literal('upstream-error'),
  Type.Literal('invalid-response'),
  Type.Literal('timeout'),
  Type.Literal('cancelled'),
])
export type ProviderModelsErrorCode = Static<typeof ProviderModelsErrorCode>

/** 对 provider.models 的回答：成功时只有供应商返回的模型 ID（保持返回顺序）；错误文本已按 ADR 0004 脱敏。 */
export const SidecarProviderModelsResult = Type.Union([
  Type.Object({ type: Type.Literal('provider.models.result'), requestId: RequestId, ok: Type.Literal(true), models: Type.Array(Type.String()) }, strict),
  Type.Object(
    {
      type: Type.Literal('provider.models.result'),
      requestId: RequestId,
      ok: Type.Literal(false),
      error: Type.Object({ code: ProviderModelsErrorCode, message: Type.String(), status: Type.Optional(Type.Integer()) }, strict),
    },
    strict,
  ),
])
export type SidecarProviderModelsResult = Static<typeof SidecarProviderModelsResult>

// ---- Secret（ADR 0007）：与 Credential 同一通道，按名字登记 ----

/** sidecar 需要某个 Secret 的明文时（MCP Server 启动或连接），请 main 用 safeStorage 解密库中的密文。 */
export const SidecarSecretDecrypt = Type.Object({ type: Type.Literal('secret.decrypt'), requestId: RequestId, ciphertext: CredentialCiphertext }, strict)
/** 对 secret.store 的确认；ok 为 false 时密文未保存。 */
export const SidecarSecretStoreResult = Type.Object(
  { type: Type.Literal('secret.store.result'), requestId: RequestId, ok: Type.Boolean(), error: Type.Optional(Type.String()) },
  strict,
)

// ---- 桌面通知 ----

/** 通知类别：定时任务的 Run 结束、定时任务的 Run 或后台子代理等待审批、后台子代理结束。 */
export const NotificationKind = Type.Union([Type.Literal('schedule-run-ended'), Type.Literal('approval-waiting'), Type.Literal('agent-finished')])
export type NotificationKind = Static<typeof NotificationKind>

/** 设置键 notifications 的值；缺省全开。 */
export const NOTIFICATIONS_SETTING = 'notifications'
export const NotificationSettings = Type.Object(
  { enabled: Type.Boolean(), scheduleRunEnded: Type.Boolean(), approvalWaiting: Type.Boolean(), agentFinished: Type.Boolean() },
  strict,
)
export type NotificationSettings = Static<typeof NotificationSettings>
export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = { enabled: true, scheduleRunEnded: true, approvalWaiting: true, agentFinished: true }

/** renderer 全局开发者偏好；Sidecar 仅保存这个设置键，不读取其语义。 */
export const DEVELOPER_SETTING = 'developer'
export const DeveloperSettings = Type.Object({ sessionDiagnostics: Type.Boolean() }, strict)
export type DeveloperSettings = Static<typeof DeveloperSettings>
export const DEFAULT_DEVELOPER_SETTINGS: DeveloperSettings = { sessionDiagnostics: false }

/** sidecar 请 main 显示桌面通知（窗口不在前台时显示；点击聚焦窗口并打开 sessionId）。title 与 body 已脱敏。 */
export const SidecarNotify = Type.Object(
  { type: Type.Literal('notify'), kind: NotificationKind, sessionId: Type.String({ minLength: 1 }), title: Type.String(), body: Type.String() },
  strict,
)
export type SidecarNotify = Static<typeof SidecarNotify>

export const SidecarToMainMessage = Type.Union([
  SidecarStarting,
  SidecarReady,
  SidecarFatal,
  SidecarShutdownComplete,
  SidecarInspectQuitResult,
  SidecarCredentialDecrypt,
  SidecarProviderSaveResult,
  SidecarProviderModelsResult,
  SidecarSecretDecrypt,
  SidecarSecretStoreResult,
  SidecarNotify,
])
export type SidecarToMainMessage = Static<typeof SidecarToMainMessage>

export const MainShutdown = Type.Object({ type: Type.Literal('shutdown') }, strict)
export const MainInspectQuit = Type.Object({ type: Type.Literal('inspect-quit'), requestId: RequestId }, strict)

/**
 * 一次提交（ADR 0010）：renderer 的完整草稿经 main 加密密钥后，配置与可选的密文、末四位提示一起交给 sidecar，
 * 在一个事务中写入；明文不经过 sidecar。不带 credential 表示保留原 Credential（新建时即没有 Credential）。
 */
export const MainProviderSave = Type.Object(
  {
    type: Type.Literal('provider.save'),
    requestId: RequestId,
    mode: ProviderSaveMode,
    provider: ProviderFields,
    credential: Type.Optional(Type.Object({ ciphertext: CredentialCiphertext, hint: Type.String({ maxLength: 4 }) }, strict)),
  },
  strict,
)
export type MainProviderSave = Static<typeof MainProviderSave>

/** Provider Key 的长度上限（保存与获取模型共用；main 校验与控制消息 schema 都用它）。 */
export const MAX_CREDENTIAL_LENGTH = 4096
/** 获取可用模型的时限（规格 4.6：15 秒未返回视为失败）；main 与 Sidecar 都用它。 */
export const PROVIDER_MODELS_TIMEOUT_MS = 15 * 1000

/**
 * 获取可用模型（ADR 0010）：按表单中的协议与地址请求供应商的模型列表。secret 是表单中填写的明文 Key，只用于这一次请求，
 * 不加密、不落库、不进入 CredentialStore 缓存；没有 secret 时用 providerId 已保存的 Credential（编辑且 Key 留空）。
 */
export const MainProviderModels = Type.Object(
  {
    type: Type.Literal('provider.models'),
    requestId: RequestId,
    api: ModelProtocol,
    baseUrl: Type.String({ minLength: 1, maxLength: 2048 }),
    providerId: Type.Optional(ProviderId),
    secret: Type.Optional(Type.String({ minLength: 1, maxLength: MAX_CREDENTIAL_LENGTH })),
  },
  strict,
)
export type MainProviderModels = Static<typeof MainProviderModels>
/** 取消进行中的 provider.models（弹窗关闭或 main 一侧超时）；sidecar 中止对供应商的请求并以 cancelled 回答。 */
export const MainProviderModelsCancel = Type.Object({ type: Type.Literal('provider.models.cancel'), requestId: RequestId }, strict)
/** 对 credential.decrypt 的回答：成功给出 plaintext，失败给出 error。 */
export const MainCredentialDecryptResult = Type.Union([
  Type.Object({ type: Type.Literal('credential.decrypt.result'), requestId: RequestId, plaintext: Type.String({ minLength: 1 }) }, strict),
  Type.Object({ type: Type.Literal('credential.decrypt.result'), requestId: RequestId, error: Type.String() }, strict),
])

/** main 加密 renderer 输入的 Secret 后，把名字、密文与末四位提示交给 sidecar 存库；明文不经过 sidecar。 */
export const MainSecretStore = Type.Object(
  { type: Type.Literal('secret.store'), requestId: RequestId, name: SecretName, ciphertext: CredentialCiphertext, hint: Type.String({ maxLength: 4 }) },
  strict,
)
/** 对 secret.decrypt 的回答：成功给出 plaintext，失败给出 error。 */
export const MainSecretDecryptResult = Type.Union([
  Type.Object({ type: Type.Literal('secret.decrypt.result'), requestId: RequestId, plaintext: Type.String({ minLength: 1 }) }, strict),
  Type.Object({ type: Type.Literal('secret.decrypt.result'), requestId: RequestId, error: Type.String() }, strict),
])

export const MainToSidecarMessage = Type.Union([
  MainShutdown,
  MainInspectQuit,
  MainProviderSave,
  MainProviderModels,
  MainProviderModelsCancel,
  MainCredentialDecryptResult,
  MainSecretStore,
  MainSecretDecryptResult,
])
export type MainToSidecarMessage = Static<typeof MainToSidecarMessage>

// ---- 按 requestId 挂起的请求 ----

/** 请求在时限内没有回答。 */
export class RequestTimeoutError extends Error {
  override readonly name = 'RequestTimeoutError'
  readonly timeoutMs: number

  constructor(message: string, timeoutMs: number) {
    super(message)
    this.timeoutMs = timeoutMs
  }
}

export interface RequestTrackerOptions {
  /** 每个请求等待回答的上限。 */
  readonly timeoutMs: number
  /** 超时错误的文案；默认 "Request timed out after <ms> ms"。 */
  readonly timeoutMessage?: (timeoutMs: number) => string
}

export interface RequestTracker<T> {
  /**
   * 分配下一个 requestId（从 1 递增），登记等待后调用 send 发出请求。
   * 结束方式：resolve / reject 交付的结果；超时（RequestTimeoutError）；signal 中止（中止原因）；send 抛错；rejectAll。
   */
  request(send: (requestId: number) => void, options?: { signal?: AbortSignal | undefined }): Promise<T>
  /** 交付回答；id 未知或已结束时返回 false。 */
  resolve(requestId: number, value: T): boolean
  reject(requestId: number, error: Error): boolean
  /** 通道断开或对端退出：以给定错误立即结束全部挂起请求。 */
  rejectAll(error: Error): void
  /** 当前挂起的请求数。 */
  readonly size: number
}

/** 按 requestId 挂起并带超时的请求；回答、超时、中止与断开都只结束一次并清理计时器。 */
export function createRequestTracker<T>(options: RequestTrackerOptions): RequestTracker<T> {
  const { timeoutMs } = options
  const timeoutMessage = options.timeoutMessage ?? ((ms: number) => `Request timed out after ${ms} ms`)
  const pending = new Map<number, { resolve: (value: T) => void; reject: (error: Error) => void }>()
  let nextId = 1

  return {
    request(send, requestOptions) {
      const signal = requestOptions?.signal
      return new Promise<T>((resolve, reject) => {
        if (signal?.aborted) {
          reject(abortReason(signal))
          return
        }
        const requestId = nextId++
        const settle =
          <V>(fn: (value: V) => void) =>
          (value: V) => {
            pending.delete(requestId)
            clearTimeout(timer)
            signal?.removeEventListener('abort', onAbort)
            fn(value)
          }
        const onAbort = () => settle(reject)(abortReason(signal!))
        const timer = setTimeout(() => settle(reject)(new RequestTimeoutError(timeoutMessage(timeoutMs), timeoutMs)), timeoutMs)
        signal?.addEventListener('abort', onAbort, { once: true })
        pending.set(requestId, { resolve: settle(resolve), reject: settle(reject) })
        try {
          send(requestId)
        } catch (error) {
          settle(reject)(error instanceof Error ? error : new Error(String(error)))
        }
      })
    },
    resolve(requestId, value) {
      const waiter = pending.get(requestId)
      waiter?.resolve(value)
      return waiter !== undefined
    },
    reject(requestId, error) {
      const waiter = pending.get(requestId)
      waiter?.reject(error)
      return waiter !== undefined
    },
    rejectAll(error) {
      // 每个 waiter 结束时只删除自己的条目；Map 迭代允许删除当前项。
      for (const waiter of pending.values()) waiter.reject(error)
    },
    get size() {
      return pending.size
    },
  }
}

const abortReason = (signal: AbortSignal): Error => (signal.reason instanceof Error ? signal.reason : new Error('Aborted'))
