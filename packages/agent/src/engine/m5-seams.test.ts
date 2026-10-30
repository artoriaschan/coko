// M5 运行时接入点：onStop（继续至多 3 次）、beforeCompact（阻止自动压缩、追加摘要要求，溢出恢复不调用）、摘要模式（trigger handoff
// 只发一次无工具的请求，经 beforeRequest，不提交消息）、run_start 的 schedule 与新的停止原因。faux 模型 + 临时 Workspace；
// 工具执行与控制调用的交叠由 deferred 控制，不用 sleep。
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type { Context } from '@earendil-works/pi-ai'
import { Type } from 'typebox'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { EntryLike } from '../entries/index.ts'
import { createFauxModels, fauxAssistantMessage, fauxToolCall } from '../testing/faux.ts'
import { createTempWorkspace, type TempWorkspace } from '../testing/workspace.ts'
import { createToolRegistry } from '../tools/registry.ts'
import type { CokoTool } from '../tools/types.ts'
import { createAgentRuntime, ONSTOP_CONTINUE_LIMIT, type AgentRuntimeOptions } from './runtime.ts'
import type { RunError, RuntimeContext, StopInfo } from './types.ts'

let ws: TempWorkspace
beforeEach(async () => {
  ws = await createTempWorkspace('coko-m5-seams-')
})
afterEach(async () => {
  await ws.dispose()
})

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

function gated(name: string) {
  const started = deferred()
  const release = deferred()
  const tool: CokoTool = {
    name,
    label: name,
    description: 'host tool ' + name,
    parameters: Type.Object({}),
    effect: 'read',
    async execute() {
      started.resolve()
      await release.promise
      return { content: [{ type: 'text', text: name + ' done' }], details: undefined }
    },
  }
  return { tool, started: started.promise, release: release.resolve }
}

type Step = ReturnType<typeof fauxAssistantMessage> | ((context: Context) => ReturnType<typeof fauxAssistantMessage>)

/** 40k 窗口、4k 输出：自动压缩阈值 23 000；保留最近 1000 tokens。 */
function harness(options: { context?: RuntimeContext; tools?: AgentRuntimeOptions['tools'] } = {}) {
  const { faux, models, model } = createFauxModels({ models: [{ id: 'small', contextWindow: 40_000, maxTokens: 4_000 }] })
  const stored: EntryLike[] = []
  const requests: Context[] = []
  const runtime = createAgentRuntime({
    models,
    model,
    cwd: ws.dir,
    sessionId: 's1',
    tools: options.tools ?? createToolRegistry(),
    commit: async (entry) => {
      stored.push({ seq: stored.length + 1, kind: entry.kind, runId: entry.runId ?? null, payload: entry.payload })
    },
    compaction: { entries: async () => stored, autoCompact: () => true, keepRecentTokens: 1_000 },
    ...(options.context ? { context: options.context } : {}),
  })
  const reply = (...steps: Step[]) =>
    faux.setResponses(
      steps.map((step) => (context: Context) => {
        requests.push(structuredClone(context))
        return typeof step === 'function' ? step(context) : step
      }),
    )
  return { runtime, stored, requests, reply }
}

const text = (message: unknown) => {
  const content = (message as { content: unknown }).content
  return typeof content === 'string' ? content : (content as { type: string; text?: string }[]).map((b) => b.text ?? '').join('')
}
/** 请求中模型可用的工具：pi 经系统消息的 toolsAdded / toolsRemoved 声明。 */
const toolSet = (context: Context) => {
  const names = new Set<string>()
  for (const m of context.messages) {
    if (m.role !== 'system') continue
    for (const t of (m as { toolsAdded?: { name: string }[] }).toolsAdded ?? []) names.add(t.name)
    for (const t of (m as { toolsRemoved?: { name: string }[] }).toolsRemoved ?? []) names.delete(t.name)
  }
  return [...names]
}
const kinds = (entries: readonly EntryLike[]) => entries.map((e) => (e.kind === 'message' ? 'message:' + (e.payload as AgentMessage).role : e.kind))
const big = (n: number, c: string) => c.repeat(n)
const ok = (t = 'ok') => fauxAssistantMessage(t)

describe('onStop', () => {
  it('返回 continue 时以该 user message 再请求一次；每 Run 至多继续 3 次，第 4 次的 continue 被忽略', async () => {
    const calls: StopInfo[] = []
    const h = harness({
      context: {
        onStop: async (info) => {
          calls.push({ ...info })
          return { continue: [{ type: 'text', text: 'keep going ' + calls.length }] }
        },
      },
    })
    h.reply(ok('a'), ok('b'), ok('c'), ok('d'), ok('never'))
    const result = await h.runtime.run('start')
    expect(result.status).toBe('completed')
    expect(ONSTOP_CONTINUE_LIMIT).toBe(3)
    expect(h.requests).toHaveLength(4)
    expect(calls.map((c) => [c.trigger, c.continuations, c.stopHookActive])).toEqual([
      ['submit', 0, false],
      ['submit', 1, true],
      ['submit', 2, true],
      ['submit', 3, true],
    ])
    expect(calls.every((c) => c.runId === result.runId)).toBe(true)
    expect(h.stored.filter((e) => e.kind === 'message' && (e.payload as AgentMessage).role === 'user').map((e) => text(e.payload))).toEqual([
      'start',
      'keep going 1',
      'keep going 2',
      'keep going 3',
    ])
    expect(text(h.requests[3]!.messages.at(-1))).toBe('keep going 3')
  })

  it('返回 void 时正常结束；暂停、停止与 compact 的 Run 不调用 onStop', async () => {
    let calls = 0
    const slow = gated('slow')
    const tools = createToolRegistry()
    tools.register(slow.tool)
    const h = harness({ tools, context: { onStop: async () => void calls++ } })
    h.reply(ok('done'), fauxAssistantMessage(fauxToolCall('slow', {}, { id: 't1' }), { stopReason: 'toolUse' }), ok('never'))
    expect((await h.runtime.run('one')).status).toBe('completed')
    expect(calls).toBe(1)
    const run = h.runtime.run('two')
    await slow.started
    h.runtime.pause()
    slow.release()
    expect((await run).status).toBe('paused')
    expect(calls).toBe(1)
  })

  it('继续的请求同样经过 beforeRequest：返回 stop 时不发出，Run 以 paused 加该 error 结束', async () => {
    const budget: RunError = { code: 'budget_exhausted', message: 'Goal budget exhausted' }
    let checks = 0
    const h = harness({
      context: {
        beforeRequest: async () => (++checks === 2 ? { stop: budget } : undefined),
        onStop: async () => ({ continue: [{ type: 'text', text: 'again' }] }),
      },
    })
    h.reply(ok('a'), ok('never'))
    const result = await h.runtime.run('start')
    expect(result).toMatchObject({ status: 'paused', error: budget })
    expect(h.requests).toHaveLength(1)
  })
})

describe('beforeCompact', () => {
  it('自动压缩：block 时跳过本次压缩，请求照常发出（没有摘要请求、没有 compaction 条目）', async () => {
    const seen: unknown[] = []
    const h = harness({ context: { beforeCompact: async (info) => (seen.push(info), { block: 'not now' }) } })
    h.reply(ok(), ok('second'))
    await h.runtime.run(big(60_000, 'a'))
    const result = await h.runtime.run(big(40_000, 'b'))
    expect(result.status).toBe('completed')
    expect(seen).toEqual([{ trigger: 'auto' }])
    expect(h.requests).toHaveLength(2)
    expect(kinds(h.stored).includes('compaction')).toBe(false)
  })

  it('返回 instructions 时追加为摘要要求（自动）', async () => {
    const h = harness({ context: { beforeCompact: async ({ trigger }) => ({ instructions: 'HOOK WANTS ' + trigger }) } })
    h.reply(ok(), ok('SUMMARY'), ok('done'))
    await h.runtime.run(big(60_000, 'a'))
    await h.runtime.run(big(40_000, 'b'))
    expect(text(h.requests[1]!.messages.at(-1))).toContain('HOOK WANTS auto')
  })

  it('返回 instructions 时追加在用户的 /compact 要求之后（手动）', async () => {
    const seen: unknown[] = []
    const h = harness({ context: { beforeCompact: async (info) => (seen.push(info), { instructions: 'HOOK WANTS ' + info.trigger }) } })
    h.reply(ok(), ok(), ok('SUMMARY'))
    await h.runtime.run(big(40_000, 'a'))
    await h.runtime.run(big(8_000, 'b'))
    const manual = await h.runtime.compact('focus on tests')
    expect(manual.status).toBe('completed')
    expect(seen).toEqual([{ trigger: 'manual', instructions: 'focus on tests' }])
    const prompt = text(h.requests.at(-1)!.messages.at(-1))
    expect(prompt).toContain('focus on tests')
    expect(prompt.indexOf('HOOK WANTS manual')).toBeGreaterThan(prompt.indexOf('focus on tests'))
  })

  it('手动压缩被 block：不发摘要请求，Run 以 error（hook_stopped）结束', async () => {
    const h = harness({ context: { beforeCompact: async () => ({ block: 'formatter failed' }) } })
    h.reply(ok(), ok(), ok('never'))
    await h.runtime.run(big(40_000, 'a'))
    await h.runtime.run(big(8_000, 'b'))
    const result = await h.runtime.compact()
    expect(result).toMatchObject({ status: 'error', error: { code: 'hook_stopped', message: 'formatter failed' } })
    expect(h.requests).toHaveLength(2)
    expect(kinds(h.stored).includes('compaction')).toBe(false)
  })

  it('溢出恢复不调用 beforeCompact', async () => {
    let calls = 0
    const h = harness({ context: { beforeCompact: async () => void calls++ } })
    const overflow = fauxAssistantMessage([], { stopReason: 'error', errorMessage: 'prompt is too long: 50000 tokens > 40000 maximum' })
    h.reply(ok(), ok(), overflow, ok('SUMMARY'), ok('after'))
    await h.runtime.run(big(40_000, 'a'))
    await h.runtime.run(big(8_000, 'b'))
    const result = await h.runtime.run('small')
    expect(result.status).toBe('completed')
    expect(kinds(h.stored).filter((k) => k === 'compaction')).toHaveLength(1)
    expect(calls).toBe(0)
  })
})

describe('第一次模型请求之前停止', () => {
  // run_start 进度同步发出（Run 已开始），此时 pi 还没有开始请求：agent.abort() 没有可停止的流。停止必须在请求前的检查中生效，
  // 否则请求照常发出、流到结束（交接的摘要请求可能要几分钟）。
  it.each(['handoff', 'submit'] as const)('%s：不发出模型请求，Run 以 aborted 结束', async (trigger) => {
    const h = harness()
    h.reply(ok('never'))
    const off = h.runtime.subscribe((event) => {
      if (event.kind === 'progress' && event.event.type === 'run_start') h.runtime.abort()
    })
    const result = await h.runtime.run(trigger === 'handoff' ? { text: 'sum', trigger: 'handoff' } : 'question')
    off()
    expect(result.status).toBe('aborted')
    expect(h.requests).toHaveLength(0)
  })
})

describe('摘要模式（trigger handoff）', () => {
  it('只发一次请求：没有工具、带有效上下文与调用方的提示，经 beforeRequest；只提交 run_start / run_end，对话记录不变', async () => {
    const slow = gated('slow')
    const tools = createToolRegistry()
    tools.register(slow.tool)
    const checked: string[] = []
    const h = harness({ tools, context: { beforeRequest: async ({ runId }) => void checked.push(runId) } })
    h.reply(ok('earlier answer'), ok('## Context\nsummary text'))
    await h.runtime.run('earlier question')
    const messages = h.runtime.messages.slice()
    const before = h.stored.length
    const result = await h.runtime.run({ text: 'Write a handoff summary', trigger: 'handoff' })
    expect(result).toMatchObject({ status: 'completed', summary: '## Context\nsummary text' })
    expect(result.summaryUsage).toMatchObject({ input: expect.any(Number), output: expect.any(Number) })
    expect(h.requests).toHaveLength(2)
    const request = h.requests[1]!
    expect(toolSet(h.requests[0]!)).toEqual(['slow'])
    expect(toolSet(request)).toEqual([])
    expect(request.messages.filter((m) => m.role !== 'system').map((m) => [m.role, text(m)])).toEqual([
      ['user', 'earlier question'],
      ['assistant', 'earlier answer'],
      ['user', 'Write a handoff summary'],
    ])
    expect(checked).toEqual([h.stored[0]!.runId, result.runId])
    expect(kinds(h.stored.slice(before))).toEqual(['run_start', 'run_end'])
    expect(h.stored[before]!.payload).toEqual({ trigger: 'handoff' })
    expect(h.runtime.messages).toEqual(messages)
    // 之后的 Run 照常有工具。
    h.reply(ok('later'))
    await h.runtime.run('next')
    // 之后的请求：工具恢复，对话记录中没有摘要请求留下的系统消息。
    expect(toolSet(h.requests[2]!)).toEqual(['slow'])
    expect(h.requests[2]!.messages.filter((m) => m.role === 'system')).toHaveLength(1)
  })

  it('模型调用工具或返回空文本：以 model_error 结束，没有 summary；beforeRequest 返回 stop 时不发出请求', async () => {
    const h = harness()
    h.reply(fauxAssistantMessage(fauxToolCall('read', { path: 'x' }, { id: 't' }), { stopReason: 'toolUse' }), ok('   '))
    const toolCall = await h.runtime.run({ text: 'sum', trigger: 'handoff' })
    expect(toolCall).toMatchObject({ status: 'error', error: { code: 'model_error' } })
    expect(toolCall.summary).toBeUndefined()
    const empty = await h.runtime.run({ text: 'sum', trigger: 'handoff' })
    expect(empty).toMatchObject({ status: 'error', error: { code: 'model_error' } })
    expect(h.requests).toHaveLength(2)

    const stop: RunError = { code: 'budget_exhausted', message: 'out of budget' }
    const g = harness({ context: { beforeRequest: async () => ({ stop }) } })
    g.reply(ok('never'))
    const transcript = g.runtime.messages.slice()
    expect(await g.runtime.run({ text: 'sum', trigger: 'handoff' })).toMatchObject({ status: 'paused', error: stop })
    expect(g.requests).toHaveLength(0)
    expect(g.runtime.messages).toEqual(transcript)
  })

  it('不调用 onStop 与自动压缩', async () => {
    let stops = 0
    let compacts = 0
    const h = harness({ context: { onStop: async () => void stops++, beforeCompact: async () => void compacts++ } })
    h.reply(ok(), ok('summary'))
    await h.runtime.run(big(100_000, 'a'))
    stops = 0
    compacts = 0
    expect((await h.runtime.run({ text: 'sum', trigger: 'handoff' })).summary).toBe('summary')
    expect([stops, compacts]).toEqual([0, 0])
  })
})

describe('新的 trigger 与停止原因', () => {
  it('run_start 写入 schedule / subagent trigger 与 schedule 字段', async () => {
    const h = harness()
    h.reply(ok(), ok())
    await h.runtime.run({ text: '<scheduled_task>', trigger: 'schedule', schedule: { scheduleId: 'sc1', occurrence: 1_000 } })
    await h.runtime.run({ text: 'child task', trigger: 'subagent' })
    expect(h.stored.filter((e) => e.kind === 'run_start').map((e) => e.payload)).toEqual([
      { trigger: 'schedule', schedule: { scheduleId: 'sc1', occurrence: 1_000 } },
      { trigger: 'subagent' },
    ])
  })

  it.each([
    { code: 'hook_stopped', message: 'Stopped by hook: lint failed' },
    { code: 'max_turns', message: 'Subagent reached its turn limit (50)' },
  ] as RunError[])('stopAfterBatch($code)：本批完成后 run_end 为 paused 加该 error', async (error) => {
    const slow = gated('slow')
    const tools = createToolRegistry()
    tools.register(slow.tool)
    const h = harness({ tools })
    h.reply(fauxAssistantMessage(fauxToolCall('slow', {}, { id: 't1' }), { stopReason: 'toolUse' }), ok('never sent'))
    const run = h.runtime.run('go')
    await slow.started
    h.runtime.stopAfterBatch(error)
    slow.release()
    const result = await run
    expect(result).toEqual({ runId: result.runId, status: 'paused', error })
    expect(kinds(h.stored)).toEqual(['run_start', 'message:user', 'message:assistant', 'message:toolResult', 'run_end'])
    expect(h.stored.at(-1)!.payload).toEqual({ status: 'paused', error })
    expect(h.requests).toHaveLength(1)
  })
})
