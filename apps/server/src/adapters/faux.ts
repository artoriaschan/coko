import { appendFile, readFile } from 'node:fs/promises'
import { fauxAssistantMessage, fauxProvider, fauxText, fauxThinking, fauxToolCall, type FauxResponseStep } from '@earendil-works/pi-ai'
import type { ModelRegistry } from '@coko/agent'
import type { SessionModel } from '@coko/protocol'

/**
 * 测试用 faux provider 的脚本（COKO_FAUX_SCRIPT 指向的 JSON 文件）。responses 按模型调用顺序依次消费，
 * 所有 Session 共用一个队列。
 *
 * { "tokensPerSecond": 200, "contextWindow": 40000, "responses": [{ "content": [{ "type": "toolCall", "name": "write", "arguments": {...} }] }, { "content": "done" }] }
 */
export interface FauxScript {
  tokensPerSecond?: number
  /** faux 模型的上下文窗口与最大输出（缺省 128 000 / 16 384）；上下文用量与压缩测试用小窗口。 */
  contextWindow?: number
  maxTokens?: number
  responses: FauxScriptResponse[]
  /** 测试观察用：每次模型请求前把其上下文消息作为一行 JSON 追加到该文件。 */
  requestLog?: string
}

export interface FauxScriptResponse {
  /** 字符串等同于一个 text 块。 */
  content: string | FauxScriptBlock[]
  /** 默认：含 toolCall 时为 toolUse，否则 stop。 */
  stopReason?: 'stop' | 'length' | 'toolUse' | 'error'
  errorMessage?: string
}

export type FauxScriptBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'toolCall'; name: string; arguments: Record<string, unknown>; id?: string }

export const FAUX_PROVIDER_ID = 'faux'
export const FAUX_MODEL_ID = 'faux-1'

function toStep(response: FauxScriptResponse): FauxResponseStep {
  const blocks = typeof response.content === 'string' ? [{ type: 'text' as const, text: response.content }] : response.content
  const content = blocks.map((block) => {
    if (block.type === 'text') return fauxText(block.text)
    if (block.type === 'thinking') return fauxThinking(block.thinking)
    return fauxToolCall(block.name, block.arguments as never, block.id ? { id: block.id } : {})
  })
  const stopReason = response.stopReason ?? (blocks.some((block) => block.type === 'toolCall') ? 'toolUse' : 'stop')
  return fauxAssistantMessage(content, { stopReason, ...(response.errorMessage ? { errorMessage: response.errorMessage } : {}) })
}

/** 读取脚本并把 faux provider 注册进 registry；返回其模型，作为没有默认设置时的 Session 模型。 */
export async function installFauxProvider(registry: ModelRegistry, path: string): Promise<SessionModel> {
  const script = JSON.parse(await readFile(path, 'utf8')) as FauxScript
  if (!script || !Array.isArray(script.responses)) throw new Error('Faux script must have a responses array')
  for (const key of ['contextWindow', 'maxTokens'] as const) {
    const value = script[key]
    if (value !== undefined && !(Number.isInteger(value) && value > 0)) throw new Error(`Faux script ${key} must be a positive integer`)
  }
  const faux = fauxProvider({
    provider: FAUX_PROVIDER_ID,
    models: [
      {
        id: FAUX_MODEL_ID,
        name: 'Faux',
        ...(script.contextWindow === undefined ? {} : { contextWindow: script.contextWindow }),
        ...(script.maxTokens === undefined ? {} : { maxTokens: script.maxTokens }),
      },
    ],
    ...(script.tokensPerSecond ? { tokensPerSecond: script.tokensPerSecond } : {}),
  })
  const log = script.requestLog
  faux.setResponses(
    script.responses.map((response) => {
      const step = toStep(response)
      if (!log) return step
      return async (context) => {
        await appendFile(log, JSON.stringify(context.messages) + '\n')
        return step as Exclude<FauxResponseStep, (...args: never[]) => unknown>
      }
    }),
  )
  registry.models.setProvider(faux.provider)
  return { providerId: FAUX_PROVIDER_ID, modelId: FAUX_MODEL_ID }
}
