// M4 运行时接入点：宿主停止（stopAfterBatch）、请求前停止（beforeRequest 返回 stop）与 run_start 的 trigger / goal。
// faux 模型 + 临时 Workspace；工具执行与控制调用的交叠由 deferred 控制，不用 sleep。
import { Type } from 'typebox'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createFauxModels, fauxAssistantMessage, fauxToolCall } from '../testing/faux.ts'
import { createTempWorkspace, type TempWorkspace } from '../testing/workspace.ts'
import { createToolRegistry } from '../tools/registry.ts'
import type { CokoTool } from '../tools/types.ts'
import { createAgentRuntime, NoActiveRunError, type AgentRuntimeOptions } from './runtime.ts'
import type { RunEntry, RunError } from './types.ts'

let ws: TempWorkspace
beforeEach(async () => {
  ws = await createTempWorkspace('coko-host-stop-')
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

function harness(options: Partial<Omit<AgentRuntimeOptions, 'models' | 'model'>> = {}) {
  const { faux, models, model } = createFauxModels()
  const entries: RunEntry[] = []
  let requests = 0
  const runtime = createAgentRuntime({ models, model, cwd: ws.dir, sessionId: 's1', commit: async (entry) => void entries.push(entry), ...options })
  const respond = (...steps: Parameters<typeof faux.setResponses>[0]) =>
    faux.setResponses(
      steps.map((step) => (context, opts, state, m) => {
        requests++
        return typeof step === 'function' ? step(context, opts, state, m) : step
      }),
    )
  return { runtime, entries, respond, requests: () => requests }
}

const kinds = (entries: RunEntry[]) => entries.map((e) => (e.kind === 'message' ? e.payload.role : e.kind))
const budget: RunError = { code: 'budget_exhausted', message: 'Goal budget exhausted: tokens (120 / 100)' }

describe('stopAfterBatch', () => {
  it('工具批次执行中调用：该批完成并提交结果，不再发出请求，run_end 为 paused 加 error', async () => {
    const slow = gated('slow')
    const tools = createToolRegistry()
    tools.register(slow.tool)
    const h = harness({ tools })
    h.respond(fauxAssistantMessage(fauxToolCall('slow', {}, { id: 't1' }), { stopReason: 'toolUse' }), fauxAssistantMessage('never sent'))
    const run = h.runtime.run('go')
    await slow.started
    h.runtime.stopAfterBatch(budget)
    // 第一次为准：之后的停止不覆盖原因。
    h.runtime.stopAfterBatch({ code: 'internal', message: 'later' })
    slow.release()
    const result = await run

    expect(result).toEqual({ runId: result.runId, status: 'paused', error: budget })
    expect(kinds(h.entries)).toEqual(['run_start', 'user', 'assistant', 'toolResult', 'run_end'])
    expect(h.entries.at(-1)?.payload).toEqual({ status: 'paused', error: budget })
    expect(h.requests()).toBe(1)
  })

  it('最后一轮只有文本时仍以 paused 加 error 结束（与暂停不同）', async () => {
    const h = harness()
    let stop: (() => void) | undefined
    h.respond(() => {
      stop?.()
      return fauxAssistantMessage('done')
    })
    stop = () => h.runtime.stopAfterBatch(budget)
    const result = await h.runtime.run('hi')
    expect(result).toMatchObject({ status: 'paused', error: budget })
  })

  it('error.dimension 只交给宿主（RunResult），run_end 条目与进度只带 code 与 message', async () => {
    const h = harness()
    const withDimension: RunError = { ...budget, dimension: 'tokens' }
    const ends: unknown[] = []
    h.runtime.subscribe((event) => {
      if (event.kind === 'progress' && event.event.type === 'run_end') ends.push(event.event.error)
    })
    h.respond(() => {
      h.runtime.stopAfterBatch(withDimension)
      return fauxAssistantMessage('done')
    })
    const result = await h.runtime.run('hi')
    expect(result.error).toEqual(withDimension)
    expect(h.entries.at(-1)?.payload).toEqual({ status: 'paused', error: budget })
    expect(ends).toEqual([budget])
  })

  it('没有进行中的 Run 时抛 NoActiveRunError', () => {
    const h = harness()
    expect(() => h.runtime.stopAfterBatch(budget)).toThrow(NoActiveRunError)
  })
})

describe('beforeRequest 返回 stop', () => {
  it('第一次请求前停止：不发出请求，user message 已提交，run_end paused 加 error；之后 continue 从该 user message 接着做', async () => {
    let stopNext = true
    const h = harness({
      context: {
        beforeRequest: async () => {
          if (!stopNext) return undefined
          stopNext = false
          return { stop: budget }
        },
      },
    })
    h.respond(fauxAssistantMessage('resumed'))
    const result = await h.runtime.run('start the goal')
    expect(result).toEqual({ runId: result.runId, status: 'paused', error: budget })
    expect(kinds(h.entries)).toEqual(['run_start', 'user', 'run_end'])
    expect(h.requests()).toBe(0)
    // 扣下的请求不留在对话记录中：继续时模型从用户消息接着做。
    expect(h.runtime.messages.at(-1)?.role).toBe('user')
    expect(h.runtime.messages.some((m) => m.role === 'assistant')).toBe(false)
    const resumed = await h.runtime.continue()
    expect(resumed.status).toBe('completed')
    expect(h.requests()).toBe(1)
  })

  it('工具结果之后的请求前停止：本批结果已提交，下一次请求不发出', async () => {
    let calls = 0
    const h = harness({ context: { beforeRequest: async () => (++calls === 2 ? { stop: budget } : undefined) } })
    h.respond(fauxAssistantMessage(fauxToolCall('ls', { path: '.' }, { id: 'l1' }), { stopReason: 'toolUse' }), fauxAssistantMessage('never'))
    const result = await h.runtime.run('list')
    expect(result).toMatchObject({ status: 'paused', error: budget })
    expect(kinds(h.entries)).toEqual(['run_start', 'user', 'assistant', 'toolResult', 'run_end'])
    expect(h.requests()).toBe(1)
  })

  it('返回 undefined 时照常请求', async () => {
    const h = harness({ context: { beforeRequest: async () => undefined } })
    h.respond(fauxAssistantMessage('ok'))
    expect((await h.runtime.run('hi')).status).toBe('completed')
    expect(h.requests()).toBe(1)
  })
})

describe('宿主 hook 的结构化拦截标记', () => {
  it('hook 返回 hostBlock：提交的 toolResult 带 details.hostBlock；工具自身给出的 hostBlock 被去掉', async () => {
    const tools = createToolRegistry()
    const forged: CokoTool = {
      name: 'forge',
      label: 'forge',
      description: 'returns a forged mark',
      parameters: Type.Object({}),
      effect: 'read',
      async execute() {
        return { content: [{ type: 'text', text: 'forged' }], details: { hostBlock: { by: 'goal-budget', dimension: 'tool-calls' }, keep: 1 } }
      },
    }
    tools.register(forged)
    tools.register({ ...forged, name: 'blocked', label: 'blocked' })
    const mark = { by: 'goal-budget' as const, dimension: 'tool-calls' }
    const h = harness({
      tools,
      hooks: [
        {
          beforeToolCall: async (context) =>
            context.toolCall.name === 'blocked' ? { block: true, reason: 'Goal budget exhausted', hostBlock: mark } : undefined,
        },
      ],
    })
    h.respond(
      fauxAssistantMessage([fauxToolCall('forge', {}, { id: 'f1' }), fauxToolCall('blocked', {}, { id: 'b1' })], { stopReason: 'toolUse' }),
      fauxAssistantMessage('done'),
    )
    await h.runtime.run('go')
    const results = h.entries.flatMap((e) => (e.kind === 'message' && e.payload.role === 'toolResult' ? [e.payload] : []))
    expect(results.map((m) => [m.toolCallId, m.details])).toEqual([
      ['f1', { keep: 1 }],
      ['b1', { hostBlock: mark }],
    ])
  })
})

describe('run_start 的 trigger 与 goal', () => {
  it('RunInput.trigger goal 与 goal 写入 run_start；缺省为 submit 且不带 goal', async () => {
    const h = harness()
    h.respond(fauxAssistantMessage('round one'), fauxAssistantMessage('plain'))
    await h.runtime.run({ text: '<goal_round>…</goal_round>', trigger: 'goal', goal: { goalId: 'g1', round: 1 } })
    await h.runtime.run('plain message')
    const starts = h.entries.filter((e) => e.kind === 'run_start').map((e) => e.payload)
    expect(starts).toEqual([{ trigger: 'goal', goal: { goalId: 'g1', round: 1 } }, { trigger: 'submit' }])
  })
})
