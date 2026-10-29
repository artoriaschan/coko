// 登记明文的按值脱敏在 Session 运行时上的接线（ADR 0004、0007）。唯一的替换函数是 @coko/logging 的 redactSecretValues / redactSecretsDeep；
// 这里只决定替换点：
// - 工具结果在进入运行时之前替换（afterToolCall 链的最后一个 hook），运行时内存、下一次模型请求、库与推送看到的是同一份文本；
// - 每次模型请求前替换整个上下文（模型回显的文本与参数、压缩摘要、恢复后的条目），请求与库中的条目一致；
// - 入库与推送前再替换一次（session-runtimes.ts，第二道防线），流式增量按内容块缓冲（跨增量的值也被替换）。
// 用户自己输入的文本按原样入库（ADR 0007）；File Reference 块在生成时替换（context/references.ts），与 read 工具一致。
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type { ProgressEvent as AgentProgress, ToolHooks } from '@coko/agent'
import { createSecretStreamRedactor, redactSecretsDeep, type SecretStreamRedactor } from '@coko/logging'

/** afterToolCall：替换结果的 content、details 与 structuredContent 中的登记明文；没有命中时不改写结果。 */
export const secretRedactionHook: ToolHooks = {
  async afterToolCall({ result }) {
    const content = redactSecretsDeep(result.content)
    const details = redactSecretsDeep(result.details)
    const structured = redactSecretsDeep(result.structuredContent)
    if (content === result.content && details === result.details && structured === result.structuredContent) return undefined
    return { content, details, ...(structured === undefined ? {} : { structuredContent: structured }) }
  },
}

/** 模型请求的上下文：全部消息中的登记明文替换为标记（没有命中时原数组）。 */
export const redactModelMessages = (messages: AgentMessage[]): AgentMessage[] => redactSecretsDeep(messages)

/**
 * 运行时进度的按值替换：assistant 增量按 (kind, contentIndex) 缓冲，其余事件整体替换。每条消息开始时（entry 提交之后）reset：
 * 下一条 assistant 消息的 contentIndex 从 0 重新开始；留在缓冲中的结尾由已提交的完整条目取代，不再单独发出。
 */
export function createProgressRedactor(): { redact(event: AgentProgress): AgentProgress | undefined; reset(): void } {
  let streams = new Map<string, SecretStreamRedactor>()
  return {
    redact(event) {
      if (event.type === 'run_start' || event.type === 'run_end') streams = new Map()
      if (event.type !== 'assistant_delta') return redactSecretsDeep(event)
      const key = `${event.kind}:${event.contentIndex}`
      let stream = streams.get(key)
      if (!stream) streams.set(key, (stream = createSecretStreamRedactor()))
      const delta = stream.push(event.delta)
      return delta === '' ? undefined : { ...event, delta }
    },
    reset() {
      streams = new Map()
    },
  }
}
