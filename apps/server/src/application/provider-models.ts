import type { CredentialStore } from '@coko/agent'
import { getLogger, redactText, registerSecretValues, REDACTED } from '@coko/logging'
import type { MainToSidecarMessage, ModelProtocol, ProviderModelsErrorCode, SidecarToMainMessage } from '@coko/protocol'

// 获取可用模型（ADR 0010）：按协议请求供应商的模型列表，只取模型 ID。Key 只用于这一次请求：请求期间登记为按值脱敏的值，
// 错误文本中的回显被替换；不缓存、不落库。

/** 获取模型的默认时限（规格：15 秒未返回视为失败）。 */
export const PROVIDER_MODELS_TIMEOUT_MS = 15_000
/** 错误说明中保留的供应商返回体长度。 */
const BODY_EXCERPT = 300
const ANTHROPIC_VERSION = '2023-06-01'

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

export interface ListProviderModelsOptions {
  api: ModelProtocol
  baseUrl: string
  key: string
  signal?: AbortSignal | undefined
  timeoutMs?: number | undefined
}

/** 模型列表的地址与鉴权头：OpenAI 两种协议为 <地址>/models（地址通常含 /v1），Anthropic 为 <地址>/v1/models。 */
function requestOf(api: ModelProtocol, base: URL, key: string): { url: string; headers: Record<string, string> } {
  const root = base.href.replace(/\/+$/, '')
  if (api === 'anthropic-messages')
    return { url: `${root}/v1/models?limit=1000`, headers: { 'x-api-key': key, 'anthropic-version': ANTHROPIC_VERSION, accept: 'application/json' } }
  return { url: `${root}/models`, headers: { authorization: `Bearer ${key}`, accept: 'application/json' } }
}

/** 供应商返回的 { data: [{ id }] }（OpenAI 与 Anthropic 同形）中的模型 ID，保持返回顺序并去重；形状不对时 undefined。 */
function idsOf(body: unknown): string[] | undefined {
  const data = (body as { data?: unknown } | null)?.data
  if (!Array.isArray(data)) return undefined
  const ids: string[] = []
  for (const item of data) {
    const id = (item as { id?: unknown } | null)?.id
    if (typeof id !== 'string' || id === '') return undefined
    if (!ids.includes(id)) ids.push(id)
  }
  return ids
}

const describe = (error: unknown): string => {
  const cause = (error as { cause?: { code?: unknown; message?: unknown } } | null)?.cause
  if (cause && typeof cause.code === 'string') return cause.code
  if (cause && typeof cause.message === 'string') return cause.message
  return error instanceof Error ? error.message : String(error)
}

/**
 * 请求供应商的模型列表。失败抛 ProviderModelsError：bad-request（地址不是 http(s)）、unreachable、upstream-error（非 2xx 或重定向；
 * 不跟随重定向，Key 不会被带到其他主机）、invalid-response、timeout、cancelled（signal 中止）。错误文本已脱敏。
 */
export async function listProviderModels(options: ListProviderModelsOptions): Promise<string[]> {
  const { api, key } = options
  let base: URL
  try {
    base = new URL(options.baseUrl)
  } catch {
    throw new ProviderModelsError('bad-request', 'API address is not a valid URL')
  }
  if (base.protocol !== 'http:' && base.protocol !== 'https:') throw new ProviderModelsError('bad-request', 'API address must be an http or https URL')

  const unregister = registerSecretValues(() => [key], { replacement: REDACTED })
  const timeout = AbortSignal.timeout(options.timeoutMs ?? PROVIDER_MODELS_TIMEOUT_MS)
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
  const aborted = () =>
    timeout.aborted ? new ProviderModelsError('timeout', 'The provider did not respond in time') : new ProviderModelsError('cancelled', 'Cancelled')
  try {
    const { url, headers } = requestOf(api, base, key)
    let response: Response
    try {
      response = await fetch(url, { method: 'GET', headers, redirect: 'manual', signal })
    } catch (error) {
      if (signal.aborted) throw aborted()
      throw new ProviderModelsError('unreachable', redactText(`Could not reach ${base.host}: ${describe(error)}`))
    }
    let text: string
    try {
      text = await response.text()
    } catch (error) {
      if (signal.aborted) throw aborted()
      throw new ProviderModelsError('unreachable', redactText(`Connection to ${base.host} failed: ${describe(error)}`))
    }
    if (!response.ok) {
      const excerpt = text.trim().slice(0, BODY_EXCERPT)
      throw new ProviderModelsError('upstream-error', redactText(`HTTP ${response.status}${excerpt ? `: ${excerpt}` : ''}`), response.status)
    }
    let body: unknown
    try {
      body = JSON.parse(text)
    } catch {
      throw new ProviderModelsError('invalid-response', 'The provider did not return a model list')
    }
    const ids = idsOf(body)
    if (!ids) throw new ProviderModelsError('invalid-response', 'The provider did not return a model list')
    return ids
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
    return listProviderModels({ api: msg.api, baseUrl: msg.baseUrl, key, signal, timeoutMs: options.timeoutMs })
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
