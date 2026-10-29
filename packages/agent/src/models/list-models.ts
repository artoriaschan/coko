import { isHttpUrl } from './base-url.ts'
import type { ModelProtocol } from './registry.ts'

// 模型列表适配：按协议请求供应商的模型列表，只取模型 ID（ADR 0010 获取可用模型）。时限、按值脱敏与 Key 的来源由宿主负责；
// 这里不缓存、不记日志。

/** 失败的种类（ListModelsError.code）；宿主映射为自己的错误码（apps/server 编译期比对它与 protocol 的 ProviderModelsErrorCode）。 */
export type ListModelsErrorCode = 'bad-request' | 'unreachable' | 'upstream-error' | 'invalid-response' | 'cancelled'

export class ListModelsError extends Error {
  override readonly name = 'ListModelsError'
  readonly code: ListModelsErrorCode
  readonly status: number | undefined

  constructor(code: ListModelsErrorCode, message: string, status?: number) {
    super(message)
    this.code = code
    this.status = status
  }
}

export interface ListProviderModelsOptions {
  api: ModelProtocol
  baseUrl: string
  key: string
  /** 中止时以 cancelled 失败，并中止对供应商的请求。 */
  signal?: AbortSignal | undefined
}

/** 错误说明中保留的供应商返回体长度。 */
const BODY_EXCERPT = 300
const ANTHROPIC_VERSION = '2023-06-01'
/** Anthropic 每页的模型数（接口上限）。 */
const ANTHROPIC_PAGE_SIZE = 1000
/** 跟随 has_more 的最多页数：供应商一直返回 has_more 时不无限请求（以每页 1000 计，足以覆盖任何真实目录）。 */
export const MAX_MODEL_PAGES = 20

/** 一页模型列表的地址与鉴权头：OpenAI 两种协议为 <地址>/models（地址通常含 /v1），Anthropic 为 <地址>/v1/models（after 为上一页最后一个 ID）。 */
function requestOf(api: ModelProtocol, base: URL, key: string, after: string | undefined): { url: string; headers: Record<string, string> } {
  const root = base.href.replace(/\/+$/, '')
  if (api === 'anthropic-messages') {
    const query = `limit=${ANTHROPIC_PAGE_SIZE}${after === undefined ? '' : `&after_id=${encodeURIComponent(after)}`}`
    return { url: `${root}/v1/models?${query}`, headers: { 'x-api-key': key, 'anthropic-version': ANTHROPIC_VERSION, accept: 'application/json' } }
  }
  return { url: `${root}/models`, headers: { authorization: `Bearer ${key}`, accept: 'application/json' } }
}

/** 一页中的模型 ID（{ data: [{ id }] }，OpenAI 与 Anthropic 同形）与 Anthropic 的翻页信息；形状不对时 undefined。 */
function pageOf(body: unknown): { ids: string[]; next: string | undefined; hasMore: boolean } | undefined {
  const { data, has_more: hasMore, last_id: last } = (body ?? {}) as { data?: unknown; has_more?: unknown; last_id?: unknown }
  if (!Array.isArray(data)) return undefined
  const ids: string[] = []
  for (const item of data) {
    const id = (item as { id?: unknown } | null)?.id
    if (typeof id !== 'string' || id === '') return undefined
    ids.push(id)
  }
  return { ids, hasMore: hasMore === true, next: typeof last === 'string' && last !== '' ? last : undefined }
}

/** 网络失败的简短原因：优先底层错误码（ECONNREFUSED 等），其次其说明。 */
const networkCause = (error: unknown): string => {
  const cause = (error as { cause?: { code?: unknown; message?: unknown } } | null)?.cause
  if (cause && typeof cause.code === 'string') return cause.code
  if (cause && typeof cause.message === 'string') return cause.message
  return error instanceof Error ? error.message : String(error)
}

/**
 * 请求供应商的模型列表，按返回顺序去重；Anthropic 跟随 has_more 取全部页（至多 MAX_MODEL_PAGES 页，超过视为 invalid-response）。
 * 失败抛 ListModelsError：bad-request（地址不是 http(s)）、unreachable、upstream-error（非 2xx 或重定向；不跟随重定向，Key 不会被带到
 * 其他主机）、invalid-response、cancelled（signal 中止）。错误文本可能含供应商回显的内容，宿主负责脱敏。
 */
export async function listProviderModels(options: ListProviderModelsOptions): Promise<string[]> {
  const { api, key, signal } = options
  if (!isHttpUrl(options.baseUrl)) throw new ListModelsError('bad-request', 'API address must be an http or https URL')
  const base = new URL(options.baseUrl)

  const ids: string[] = []
  let after: string | undefined
  for (let page = 1; ; page++) {
    const result = await fetchPage(requestOf(api, base, key, after), base, signal)
    for (const id of result.ids) if (!ids.includes(id)) ids.push(id)
    if (api !== 'anthropic-messages' || !result.hasMore) return ids
    if (result.next === undefined) throw new ListModelsError('invalid-response', 'The provider did not say where the next page starts')
    if (page >= MAX_MODEL_PAGES) throw new ListModelsError('invalid-response', `The provider returned more than ${MAX_MODEL_PAGES} pages of models`)
    after = result.next
  }
}

async function fetchPage(request: { url: string; headers: Record<string, string> }, base: URL, signal: AbortSignal | undefined) {
  const cancelled = () => new ListModelsError('cancelled', 'Cancelled')
  const { url, headers } = request
  let response: Response
  try {
    response = await fetch(url, { method: 'GET', headers, redirect: 'manual', ...(signal ? { signal } : {}) })
  } catch (error) {
    if (signal?.aborted) throw cancelled()
    throw new ListModelsError('unreachable', `Could not reach ${base.host}: ${networkCause(error)}`)
  }
  let text: string
  try {
    text = await response.text()
  } catch (error) {
    if (signal?.aborted) throw cancelled()
    throw new ListModelsError('unreachable', `Connection to ${base.host} failed: ${networkCause(error)}`)
  }
  if (!response.ok) {
    const excerpt = text.trim().slice(0, BODY_EXCERPT)
    throw new ListModelsError('upstream-error', `HTTP ${response.status}${excerpt ? `: ${excerpt}` : ''}`, response.status)
  }
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    throw new ListModelsError('invalid-response', 'The provider did not return a model list')
  }
  const page = pageOf(body)
  if (!page) throw new ListModelsError('invalid-response', 'The provider did not return a model list')
  return page
}
