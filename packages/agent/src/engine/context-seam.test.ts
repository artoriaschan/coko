// 运行时 seam：context.systemSections 组成开头系统消息的 sections（基础提示为第一段）、RunInput.before 的条目位于
// run_start 之后与 user message 之前、transformMessages 只改请求不改条目、每条 assistant 提交后发 context_usage。
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { getSystemMessageText, type Context, type SystemMessage } from '@earendil-works/pi-ai'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createFauxModels, fauxAssistantMessage, fauxToolCall } from '../testing/faux.ts'
import { createTempWorkspace, type TempWorkspace } from '../testing/workspace.ts'
import { BASE_SYSTEM_SECTION, createAgentRuntime, DEFAULT_SYSTEM_PROMPT, type AgentRuntimeOptions } from './runtime.ts'
import type { ProgressEvent, RunEntry } from './types.ts'

let ws: TempWorkspace
beforeEach(async () => {
  ws = await createTempWorkspace('coko-seam-')
})
afterEach(async () => {
  await ws.dispose()
})

function harness(options: Partial<Omit<AgentRuntimeOptions, 'models' | 'model'>> = {}) {
  const { faux, models, model } = createFauxModels()
  const entries: RunEntry[] = []
  const progress: ProgressEvent[] = []
  const requests: Context[] = []
  const runtime = createAgentRuntime({
    models,
    model,
    cwd: ws.dir,
    commit: async (entry) => {
      entries.push(entry)
    },
    ...options,
  })
  runtime.subscribe((event) => {
    if (event.kind === 'progress') progress.push(event.event)
  })
  /** 每条回复先记下请求上下文。 */
  const reply = (...messages: ReturnType<typeof fauxAssistantMessage>[]) =>
    faux.setResponses(
      messages.map((message) => (context: Context) => {
        requests.push(structuredClone(context))
        return message
      }),
    )
  return { runtime, entries, progress, requests, reply, model }
}

const leadingOf = (context: Context) => context.messages[0] as SystemMessage
const textOf = (message: AgentMessage) => {
  const content = (message as { content: unknown }).content
  return typeof content === 'string' ? content : (content as { type: string; text?: string }[]).map((b) => b.text ?? '').join('')
}

describe('context.systemSections', () => {
  it('每个 Run 开始时取一次，组成 SystemMessage.sections，DEFAULT_SYSTEM_PROMPT 为第一段', async () => {
    let calls = 0
    let version = 1
    const h = harness({
      context: {
        systemSections: async () => {
          calls++
          return [
            { name: 'instructions', text: `<instructions>v${version}</instructions>` },
            { name: 'empty', text: '' },
          ]
        },
      },
    })
    h.reply(
      fauxAssistantMessage(fauxToolCall('ls', { path: '.' }, { id: 'l1' }), { stopReason: 'toolUse' }),
      fauxAssistantMessage('one'),
      fauxAssistantMessage('two'),
    )
    await h.runtime.run('first')
    version = 2
    await h.runtime.run('second')
    expect(calls).toBe(2)
    const sections = h.requests.map((r) => leadingOf(r).sections)
    expect(sections[0]).toEqual({ [BASE_SYSTEM_SECTION]: DEFAULT_SYSTEM_PROMPT, instructions: '<instructions>v1</instructions>' })
    expect(Object.keys(sections[0]!)[0]).toBe(BASE_SYSTEM_SECTION)
    // 同一 Run 内的两次请求用同一份段落；下一 Run 重新读取。
    expect(sections[1]).toEqual(sections[0])
    expect(sections[2]).toMatchObject({ instructions: '<instructions>v2</instructions>' })
    expect(getSystemMessageText(leadingOf(h.requests[2]!))).toBe(DEFAULT_SYSTEM_PROMPT + '\n\n<instructions>v2</instructions>')
    // 开头的系统消息不是条目。
    expect(h.entries.some((e) => e.kind === 'message' && e.payload.role === 'system')).toBe(false)
  })

  it('没有贡献或全部为空时，请求中的系统提示与没有 seam 时相同', async () => {
    const plain = harness()
    plain.reply(fauxAssistantMessage('ok'))
    await plain.runtime.run('hi')
    const empty = harness({ context: { systemSections: async () => [] } })
    empty.reply(fauxAssistantMessage('ok'))
    await empty.runtime.run('hi')
    const strip = (m: SystemMessage) => ({ ...m, timestamp: 0 })
    expect(strip(leadingOf(empty.requests[0]!))).toEqual(strip(leadingOf(plain.requests[0]!)))
    expect(leadingOf(plain.requests[0]!).content).toBe(DEFAULT_SYSTEM_PROMPT)
  })
})

describe('RunInput', () => {
  it('before 的条目位于 run_start 之后、user message 之前，带本 Run 的 runId；content 替换 user message 内容', async () => {
    const h = harness()
    h.reply(fauxAssistantMessage('done'))
    const result = await h.runtime.run({
      text: '/review src',
      content: [{ type: 'text', text: 'Review the files in src.' }],
      before: [{ kind: 'command', payload: { name: 'review', args: 'src', source: 'project' } }],
    })
    expect(h.entries.map((e) => (e.kind === 'message' ? `message:${e.payload.role}` : e.kind))).toEqual([
      'run_start',
      'command',
      'message:user',
      'message:assistant',
      'run_end',
    ])
    expect(h.entries.every((e) => e.runId === result.runId)).toBe(true)
    expect(textOf((h.entries[2] as Extract<RunEntry, { kind: 'message' }>).payload)).toBe('Review the files in src.')
    expect(textOf(h.requests[0]!.messages.at(-1) as AgentMessage)).toBe('Review the files in src.')
  })

  it('steer 的 before 条目紧接在该 user message 之前提交；未送达时退回的是用户输入的 text', async () => {
    const h = harness()
    h.reply(fauxAssistantMessage(fauxToolCall('ls', { path: '.' }, { id: 'l1' }), { stopReason: 'toolUse' }), fauxAssistantMessage('after steer'))
    const unsubscribe = h.runtime.subscribe((event) => {
      if (event.kind === 'progress' && event.event.type === 'tool_start') {
        h.runtime.steer({
          text: '/hint x',
          content: [{ type: 'text', text: 'Hint: x' }],
          before: [{ kind: 'command', payload: { name: 'hint', args: 'x', source: 'user' } }],
        })
      }
    })
    await h.runtime.run('go')
    unsubscribe()
    const kinds = h.entries.map((e) => (e.kind === 'message' ? `message:${e.payload.role}` : e.kind))
    expect(kinds).toEqual(['run_start', 'message:user', 'message:assistant', 'message:toolResult', 'command', 'message:user', 'message:assistant', 'run_end'])

    // 停止时未送达：退回 text。
    const stopped = harness()
    stopped.reply(fauxAssistantMessage(fauxToolCall('bash', { command: 'sleep 5' }, { id: 'b1' }), { stopReason: 'toolUse' }))
    const off = stopped.runtime.subscribe((event) => {
      if (event.kind === 'progress' && event.event.type === 'tool_start') {
        stopped.runtime.steer({ text: '/hint y', content: [{ type: 'text', text: 'Hint: y' }] })
        stopped.runtime.abort()
      }
    })
    const ended = await stopped.runtime.run('go')
    off()
    expect(ended.undeliveredSteering).toEqual(['/hint y'])
  })
})

describe('context.transformMessages', () => {
  it('只改发给模型的请求，不改已提交的条目与运行时的对话记录', async () => {
    const h = harness({
      context: {
        transformMessages: (messages) => messages.map((m) => (m.role === 'user' ? { ...m, content: [{ type: 'text', text: 'TRANSFORMED' }] } : m)),
      },
    })
    h.reply(fauxAssistantMessage('ok'))
    await h.runtime.run('original')
    expect(textOf(h.requests[0]!.messages.at(-1) as AgentMessage)).toBe('TRANSFORMED')
    const user = h.entries.find((e) => e.kind === 'message' && e.payload.role === 'user') as Extract<RunEntry, { kind: 'message' }>
    expect(textOf(user.payload)).toBe('original')
    expect(textOf(h.runtime.messages.find((m) => m.role === 'user')!)).toBe('original')
  })
})

describe('context.beforeRequest', () => {
  it('每次模型请求之前调用，带本 Run 的 runId 与当时的上下文', async () => {
    const seen: { runId: string; last: string | undefined }[] = []
    const h = harness({ context: { beforeRequest: async (state) => void seen.push({ runId: state.runId, last: state.messages.at(-1)?.role }) } })
    h.reply(fauxAssistantMessage(fauxToolCall('ls', { path: '.' }, { id: 'l1' }), { stopReason: 'toolUse' }), fauxAssistantMessage('ok'))
    const result = await h.runtime.run('hi')
    expect(seen).toEqual([
      { runId: result.runId, last: 'user' },
      { runId: result.runId, last: 'toolResult' },
    ])
  })
})

describe('context_usage', () => {
  it('每条 assistant 消息提交后发出：tokens 为该消息 usage 的 input + cacheRead + cacheWrite + output，contextWindow 来自模型', async () => {
    // sessionId 使 faux 模拟提示缓存（第二次请求有 cacheRead）。
    const h = harness({ sessionId: 's1' })
    h.reply(fauxAssistantMessage(fauxToolCall('ls', { path: '.' }, { id: 'l1' }), { stopReason: 'toolUse' }), fauxAssistantMessage('ok'))
    await h.runtime.run('hi')
    const assistants = h.entries.flatMap((e) => (e.kind === 'message' && e.payload.role === 'assistant' ? [e.payload] : []))
    const usage = h.progress.filter((e) => e.type === 'context_usage')
    expect(usage).toHaveLength(2)
    expect(assistants.some((a) => a.usage.cacheRead + a.usage.cacheWrite > 0)).toBe(true)
    expect(usage.map((e) => e.tokens)).toEqual(assistants.map((a) => a.usage.input + a.usage.cacheRead + a.usage.cacheWrite + a.usage.output))
    expect(usage.every((e) => e.contextWindow === h.model.contextWindow && e.contextWindow > 0)).toBe(true)
    // 发在 run_end 之前。
    expect(h.progress.findIndex((e) => e.type === 'context_usage')).toBeLessThan(h.progress.findIndex((e) => e.type === 'run_end'))
  })
})
