import { appendFile, readFile } from 'node:fs/promises'
import {
  calculateCost,
  createFauxCore,
  createProvider,
  fauxAssistantMessage,
  fauxText,
  fauxThinking,
  fauxToolCall,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type FauxResponseStep,
  type StreamFunction,
  type StreamOptions,
  type Usage,
} from '@earendil-works/pi-ai'
import type { ModelRegistry } from '@coko/agent'
import type { SessionModel } from '@coko/protocol'

/**
 * 测试用 faux provider 的脚本（COKO_FAUX_SCRIPT 指向的 JSON 文件）。responses 按模型调用顺序依次消费，
 * 所有 Session 共用一个队列；带 match 的回复只在请求的最后一条 user message 或系统提示含该子串时取用（并行的 Session 各取自己的回复），
 * 其余按顺序。
 *
 * { "tokensPerSecond": 200, "contextWindow": 40000, "responses": [{ "content": [{ "type": "toolCall", "name": "write", "arguments": {...} }] }, { "content": "done" }] }
 */
export interface FauxScript {
  input?: ('text' | 'image')[]
  tokensPerSecond?: number
  /** faux 模型的上下文窗口与最大输出（缺省 128 000 / 16 384）；上下文用量与压缩测试用小窗口。 */
  contextWindow?: number
  maxTokens?: number
  responses: FauxScriptResponse[]
  /** 测试观察用：每次模型请求前把其上下文消息作为一行 JSON 追加到该文件。 */
  requestLog?: string
  /**
   * faux 模型的价格（每百万 token，同 Model Catalog 的 price）：省略时未定价。有价格时，usage 未给出 cost 的回复按价格计算费用
   * （pi-ai calculateCost，与真实 Provider 相同）。
   */
  price?: { input: number; output: number; cacheRead?: number; cacheWrite?: number }
}

export interface FauxScriptResponse {
  /** 字符串等同于一个 text 块。 */
  content: string | FauxScriptBlock[]
  /** 默认：含 toolCall 时为 toolUse，否则 stop。 */
  stopReason?: 'stop' | 'length' | 'toolUse' | 'error'
  errorMessage?: string
  /**
   * 这条回复的 usage（替换 faux 按字符估算的值）；省略的字段为 0，totalTokens 为四项之和。用量、预算与费用测试用。
   */
  usage?: FauxScriptUsage
  /** 只在最后一条 user message 或系统提示含该子串时取用；没有 match 的回复按顺序取用。 */
  match?: string
}

export interface FauxScriptUsage {
  input?: number
  output?: number
  cacheRead?: number
  cacheWrite?: number
  cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; total?: number }
}

export type FauxScriptBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'toolCall'; name: string; arguments: Record<string, unknown>; id?: string }

export const FAUX_PROVIDER_ID = 'faux'
export const FAUX_MODEL_ID = 'faux-1'

/** 脚本给出的 usage 经 responseId 带过 faux 的复制与估算，在流结束前换回（responseId 随之清除）。 */
const USAGE_MARKER = 'coko-faux-usage:'

export function toUsage(input: FauxScriptUsage): Usage {
  const tokens = { input: input.input ?? 0, output: input.output ?? 0, cacheRead: input.cacheRead ?? 0, cacheWrite: input.cacheWrite ?? 0 }
  const cost = {
    input: input.cost?.input ?? 0,
    output: input.cost?.output ?? 0,
    cacheRead: input.cost?.cacheRead ?? 0,
    cacheWrite: input.cost?.cacheWrite ?? 0,
  }
  return {
    ...tokens,
    totalTokens: tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite,
    cost: { ...cost, total: input.cost?.total ?? cost.input + cost.output + cost.cacheRead + cost.cacheWrite },
  }
}

function toStep(response: FauxScriptResponse): FauxResponseStep {
  const blocks = typeof response.content === 'string' ? [{ type: 'text' as const, text: response.content }] : response.content
  const content = blocks.map((block) => {
    if (block.type === 'text') return fauxText(block.text)
    if (block.type === 'thinking') return fauxThinking(block.thinking)
    return fauxToolCall(block.name, block.arguments as never, block.id ? { id: block.id } : {})
  })
  const stopReason = response.stopReason ?? (blocks.some((block) => block.type === 'toolCall') ? 'toolUse' : 'stop')
  return fauxAssistantMessage(content, {
    stopReason,
    ...(response.errorMessage ? { errorMessage: response.errorMessage } : {}),
    ...(response.usage ? { responseId: USAGE_MARKER + JSON.stringify(response.usage) } : {}),
  })
}

/**
 * 把脚本的 usage 换回到结束消息上（done / error 事件与 end 共用同一个消息对象）。模型有价格且脚本没有给出 cost 时按价格计算
 * （包括 faux 按字符估算的 usage）。
 */
function restoreUsage(message: AssistantMessage | undefined, model: Parameters<typeof calculateCost>[0]): void {
  if (!message) return
  let scripted: FauxScriptUsage | undefined
  if (message.responseId?.startsWith(USAGE_MARKER)) {
    scripted = JSON.parse(message.responseId.slice(USAGE_MARKER.length)) as FauxScriptUsage
    message.usage = toUsage(scripted)
    delete message.responseId
  }
  const { input, output, cacheRead, cacheWrite } = model.cost
  if (scripted?.cost === undefined && message.usage && (input > 0 || output > 0 || cacheRead > 0 || cacheWrite > 0))
    message.usage.cost = calculateCost(model, message.usage)
}

function withScriptedUsage<O extends StreamOptions>(stream: StreamFunction<string, O>): StreamFunction<string, O> {
  return ((model, context, options) => {
    const events = stream(model, context, options) as AssistantMessageEventStream
    const push = events.push.bind(events)
    events.push = (event) => {
      if (event.type === 'done') restoreUsage(event.message, model)
      else if (event.type === 'error') restoreUsage(event.error, model)
      push(event)
    }
    return events
  }) as StreamFunction<string, O>
}

/**
 * 工具调用参数中的 `$LAST_JOB_ID` 在请求时替换为上下文中最近一次 "Started background job <id>" 工具结果的 jobId（Job id 随机生成，
 * 脚本无法预先写出）。
 */
export const LAST_JOB_ID = '$LAST_JOB_ID'
const STARTED_JOB = /Started background job (\S+?):/g

function lastJobId(messages: readonly unknown[]): string | undefined {
  let found: string | undefined
  for (const message of messages) {
    const m = message as { role?: string; content?: unknown }
    if (m.role !== 'toolResult' || !Array.isArray(m.content)) continue
    for (const block of m.content as { type?: string; text?: string }[])
      if (block.type === 'text' && block.text) for (const match of block.text.matchAll(STARTED_JOB)) found = match[1]
  }
  return found
}

function withLastJobId(response: FauxScriptResponse, jobId: string | undefined): FauxScriptResponse {
  if (jobId === undefined) return response
  return JSON.parse(JSON.stringify(response).replaceAll(LAST_JOB_ID, jobId)) as FauxScriptResponse
}

const blockText = (content: unknown): string =>
  typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? (content as { type?: string; text?: string }[]).map((block) => (block.type === 'text' ? (block.text ?? '') : '')).join('\n')
      : ''

/** 请求中 match 比对的文本：最后一条 user message 与系统提示（含 sections）。 */
function matchTexts(context: { systemPrompt?: string; messages: readonly unknown[] }): string[] {
  const messages = context.messages as { role?: string; content?: unknown; sections?: Record<string, string> }[]
  const lastUser = [...messages].reverse().find((m) => m.role === 'user')
  const system = messages.filter((m) => m.role === 'system').map((m) => [blockText(m.content), ...Object.values(m.sections ?? {})].join('\n'))
  return [lastUser ? blockText(lastUser.content) : '', context.systemPrompt ?? '', ...system]
}

/**
 * 选出本次请求的回复：第一条未用且 match 命中的回复，否则第一条未用且没有 match 的回复。都没有时 undefined（faux 以脚本耗尽报错）。
 */
export function pickResponse(
  responses: readonly FauxScriptResponse[],
  used: boolean[],
  context: { systemPrompt?: string; messages: readonly unknown[] },
): number | undefined {
  const texts = matchTexts(context)
  const matched = responses.findIndex((r, i) => !used[i] && r.match !== undefined && texts.some((t) => t.includes(r.match!)))
  const index = matched >= 0 ? matched : responses.findIndex((r, i) => !used[i] && r.match === undefined)
  if (index < 0) return undefined
  used[index] = true
  return index
}

const stripMatch = ({ match: _match, ...response }: FauxScriptResponse): FauxScriptResponse => response

/** 读取脚本并把 faux provider 注册进 registry；返回其模型，作为没有默认设置时的 Session 模型。 */
export async function installFauxProvider(registry: ModelRegistry, path: string): Promise<SessionModel> {
  const script = JSON.parse(await readFile(path, 'utf8')) as FauxScript
  if (!script || !Array.isArray(script.responses)) throw new Error('Faux script must have a responses array')
  for (const key of ['contextWindow', 'maxTokens'] as const) {
    const value = script[key]
    if (value !== undefined && !(Number.isInteger(value) && value > 0)) throw new Error(`Faux script ${key} must be a positive integer`)
  }
  const core = createFauxCore({
    provider: FAUX_PROVIDER_ID,
    models: [
      {
        id: FAUX_MODEL_ID,
        name: 'Faux',
        input: script.input ?? ['text'],
        ...(script.contextWindow === undefined ? {} : { contextWindow: script.contextWindow }),
        ...(script.maxTokens === undefined ? {} : { maxTokens: script.maxTokens }),
        ...(script.price
          ? {
              cost: {
                input: script.price.input,
                output: script.price.output,
                cacheRead: script.price.cacheRead ?? 0,
                cacheWrite: script.price.cacheWrite ?? 0,
              },
            }
          : {}),
      },
    ],
    ...(script.tokensPerSecond ? { tokensPerSecond: script.tokensPerSecond } : {}),
  })
  const log = script.requestLog
  const scripted = script.responses
  if (scripted.some((response) => response.match !== undefined)) {
    // 带 match 的脚本：每次请求按上下文选回复（调用次数仍为回复数）。
    const used = scripted.map(() => false)
    core.setResponses(
      scripted.map(() => async (context) => {
        if (log) await appendFile(log, JSON.stringify(context.messages) + '\n')
        const index = pickResponse(scripted, used, context)
        if (index === undefined) return fauxAssistantMessage([], { stopReason: 'error', errorMessage: 'Faux script has no response for this request' })
        const response = stripMatch(scripted[index]!)
        return toStep(withLastJobId(response, lastJobId(context.messages))) as Exclude<FauxResponseStep, (...args: never[]) => unknown>
      }),
    )
  } else
    core.setResponses(
      scripted.map((response) => {
        const placeholder = JSON.stringify(response).includes(LAST_JOB_ID)
        const step = toStep(response)
        if (!log && !placeholder) return step
        return async (context) => {
          if (log) await appendFile(log, JSON.stringify(context.messages) + '\n')
          const resolved = placeholder ? toStep(withLastJobId(response, lastJobId(context.messages))) : step
          return resolved as Exclude<FauxResponseStep, (...args: never[]) => unknown>
        }
      }),
    )
  registry.models.setProvider(
    createProvider({
      id: core.provider,
      auth: { apiKey: { name: 'Faux', resolve: async () => ({ auth: {} }) } },
      models: core.models,
      api: {
        stream: withScriptedUsage(core.stream),
        streamSimple: withScriptedUsage(core.streamSimple),
        fetchDeferred: core.fetchDeferred,
        cancelDeferred: core.cancelDeferred,
      },
    }),
  )
  return { providerId: FAUX_PROVIDER_ID, modelId: FAUX_MODEL_ID }
}
