import { listProviderModels, ListModelsError, type CredentialStore, type ListModelsErrorCode, type ModelProtocol } from '@coko/agent'
import { getLogger, redactText, registerSecretValues, REDACTED } from '@coko/logging'
import { PROVIDER_MODELS_TIMEOUT_MS, type MainToSidecarMessage, type ProviderModelsErrorCode, type SidecarToMainMessage } from '@coko/protocol'

// 获取可用模型的 Sidecar 一侧（ADR 0010）：装配 packages/agent 的模型列表适配，加上时限与按值脱敏。Key 只用于这一次请求：
// 请求期间登记为按值脱敏的值，错误文本中的回显被替换；不缓存、不落库。

// agent 的失败种类都是协议错误码；agent 增加了协议没有的种类时，这里编译失败。
type Assert<T extends true> = T
export type ListModelsCodesAreProtocolCodes = Assert<ListModelsErrorCode extends ProviderModelsErrorCode ? true : false>

export class ProviderModelsError extends Error {
  override readonly name = 'ProviderModelsError'
  readonly code: ProviderModelsErrorCode
  readonly status: number | undefined

  constructor(code: ProviderModelsErrorCode, message: string, status?: number) {
    super(message)
    this.code = code
    this.status = status
  }
}

export interface FetchProviderModelsOptions {
  api: ModelProtocol
  baseUrl: string
  key: string
  signal?: AbortSignal | undefined
  timeoutMs?: number | undefined
}

/** 请求供应商的模型列表：超过时限为 timeout，signal 中止为 cancelled；错误文本已脱敏（含本次 Key 的回显）。 */
export async function fetchProviderModels(options: FetchProviderModelsOptions): Promise<string[]> {
  const { api, baseUrl, key } = options
  const unregister = registerSecretValues(() => [key], { replacement: REDACTED })
  const timeout = AbortSignal.timeout(options.timeoutMs ?? PROVIDER_MODELS_TIMEOUT_MS)
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
  try {
    return await listProviderModels({ api, baseUrl, key, signal })
  } catch (error) {
    if (!(error instanceof ListModelsError)) throw new ProviderModelsError('unreachable', redactText(error instanceof Error ? error.message : String(error)))
    if (error.code === 'cancelled' && timeout.aborted) throw new ProviderModelsError('timeout', 'The provider did not respond in time')
    throw new ProviderModelsError(error.code, redactText(error.message), error.status)
  } finally {
    unregister()
  }
}

/** 控制通道中本模块用到的部分。 */
export interface ProviderModelsChannel {
  send(message: SidecarToMainMessage): Promise<void>
  onMessage(listener: (message: MainToSidecarMessage) => void): () => void
}

/**
 * 回答 main 的 provider.models：有 secret 时用它（表单中的 Key，只用于这一次请求，不进入 CredentialStore）；否则读 providerId
 * 已保存的 Credential（编辑且 Key 留空，即使表单中的地址已改为其他主机）。provider.models.cancel 中止进行中的请求。
 */
export function serveProviderModels(options: { control: ProviderModelsChannel; credentials: Pick<CredentialStore, 'read'>; timeoutMs?: number }): void {
  const { control, credentials } = options
  const log = getLogger(['application', 'provider-models'])
  const inflight = new Map<number, AbortController>()

  const answer = async (msg: Extract<MainToSidecarMessage, { type: 'provider.models' }>, signal: AbortSignal): Promise<string[]> => {
    let key = msg.secret
    if (key === undefined && msg.providerId !== undefined) {
      try {
        const credential = await credentials.read(msg.providerId, { signal })
        if (credential?.type === 'api_key') key = credential.key
      } catch {
        if (signal.aborted) throw new ProviderModelsError('cancelled', 'Cancelled')
        throw new ProviderModelsError('no-credential', 'The saved API key could not be read')
      }
    }
    if (key === undefined) throw new ProviderModelsError('no-credential', 'No API key is available for this provider')
    return fetchProviderModels({ api: msg.api, baseUrl: msg.baseUrl, key, signal, timeoutMs: options.timeoutMs })
  }

  control.onMessage((msg) => {
    if (msg.type === 'provider.models.cancel') {
      inflight.get(msg.requestId)?.abort()
      return
    }
    if (msg.type !== 'provider.models') return
    const { requestId } = msg
    const controller = new AbortController()
    inflight.set(requestId, controller)
    answer(msg, controller.signal)
      .then(
        (models) => {
          log.info('provider models fetched', { api: msg.api, count: models.length, credential: msg.secret === undefined ? 'saved' : 'form' })
          return control.send({ type: 'provider.models.result', requestId, ok: true, models })
        },
        (error: unknown) => {
          const failure =
            error instanceof ProviderModelsError
              ? error
              : new ProviderModelsError('unreachable', redactText(error instanceof Error ? error.message : String(error)))
          log.info('provider models failed', { api: msg.api, code: failure.code, status: failure.status })
          return control.send({
            type: 'provider.models.result',
            requestId,
            ok: false,
            error: { code: failure.code, message: failure.message, ...(failure.status === undefined ? {} : { status: failure.status }) },
          })
        },
      )
      .finally(() => inflight.delete(requestId))
  })
}
