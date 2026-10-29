import { Value } from 'typebox/value'
import { createRequestTracker, MainProviderModels, RequestTimeoutError, type SidecarProviderModelsResult } from '@coko/protocol'
import type { FetchProviderModelsErrorCode, FetchProviderModelsResult } from '../shared/bridge.ts'
import type { SidecarControlChannel } from './control-channel.ts'

// 获取可用模型的 main 一侧（ADR 0010）：renderer 交来的请求在这里校验，经 provider.models 控制消息请 Sidecar 请求供应商的模型列表。
// 表单中的 Key 以明文随这一次请求交给 Sidecar，不加密、不保存、不写日志；编辑时 Key 留空只带 Provider ID（Sidecar 用已保存的 Credential）。

/** 获取模型的时限（规格：15 秒未返回视为失败）。 */
const DEFAULT_TIMEOUT_MS = 15_000
const MAX_SECRET_LENGTH = 4096
const MAX_REQUEST_KEY_LENGTH = 128

export interface ProviderModelsBridge {
  /** renderer 的输入未经信任：先校验，再发送。 */
  fetch(input: unknown): Promise<FetchProviderModelsResult>
  /** 取消 requestKey 对应的进行中请求；未知或已结束时不做任何事。 */
  cancel(requestKey: unknown): void
}

const failure = (code: FetchProviderModelsErrorCode, message: string, status?: number): FetchProviderModelsResult => ({
  ok: false,
  code,
  message,
  ...(status === undefined ? {} : { status }),
})

type Request = { requestKey: string; message: Omit<MainProviderModels, 'requestId'> }

function parseInput(input: unknown): Request | FetchProviderModelsResult {
  const invalid = failure('invalid-input', 'Invalid model list request')
  if (typeof input !== 'object' || input === null) return invalid
  const { requestKey, api, baseUrl, providerId, secret } = input as Record<string, unknown>
  if (typeof requestKey !== 'string' || requestKey === '' || requestKey.length > MAX_REQUEST_KEY_LENGTH) return invalid
  if (secret !== undefined && typeof secret !== 'string') return invalid
  const key = typeof secret === 'string' ? secret.trim() : ''
  if (key.length > MAX_SECRET_LENGTH || /\s/.test(key)) return failure('invalid-input', 'API key must be 1–4096 characters without whitespace')
  const message = { type: 'provider.models', api, baseUrl, ...(providerId === undefined ? {} : { providerId }), ...(key === '' ? {} : { secret: key }) }
  if (!Value.Check(MainProviderModels, { ...message, requestId: 1 })) return invalid
  if (key === '' && providerId === undefined) return failure('invalid-input', 'An API key is required')
  return { requestKey, message: message as Request['message'] }
}

export function createProviderModelsBridge(options: { channel: SidecarControlChannel; timeoutMs?: number }): ProviderModelsBridge {
  const { channel } = options
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const results = createRequestTracker<SidecarProviderModelsResult>({ timeoutMs, timeoutMessage: (ms) => `The provider did not respond within ${ms} ms` })
  /** requestKey → 进行中的 requestId 与取消。 */
  const inflight = new Map<string, { requestId: number; controller: AbortController }>()

  channel.onUnavailable(() => results.rejectAll(new Error('Sidecar exited before answering')))
  channel.onMessage((message) => {
    if (message.type === 'provider.models.result') results.resolve(message.requestId, message)
  })

  const cancelled = new Error('Cancelled')

  return {
    async fetch(input) {
      const parsed = parseInput(input)
      if ('ok' in parsed) return parsed
      if (!channel.isReady()) return failure('sidecar-unavailable', 'Sidecar is not available')
      // 同一 requestKey 的旧请求先取消（renderer 重试）。
      inflight.get(parsed.requestKey)?.controller.abort(cancelled)
      const controller = new AbortController()
      let requestId = 0
      try {
        const result = await results.request(
          (id) => {
            requestId = id
            inflight.set(parsed.requestKey, { requestId: id, controller })
            channel.send({ ...parsed.message, requestId: id })
          },
          { signal: controller.signal },
        )
        return result.ok ? { ok: true, models: result.models } : failure(result.error.code, result.error.message, result.error.status)
      } catch (error) {
        // 超时或取消：请 Sidecar 中止对供应商的请求。
        const timedOut = error instanceof RequestTimeoutError
        if (timedOut || error === cancelled) {
          if (channel.isReady()) channel.send({ type: 'provider.models.cancel', requestId })
          return timedOut ? failure('timeout', error.message) : failure('cancelled', 'Cancelled')
        }
        return failure('sidecar-unavailable', error instanceof Error ? error.message : String(error))
      } finally {
        if (inflight.get(parsed.requestKey)?.controller === controller) inflight.delete(parsed.requestKey)
      }
    },
    cancel(requestKey) {
      if (typeof requestKey !== 'string') return
      inflight.get(requestKey)?.controller.abort(cancelled)
    },
  }
}
