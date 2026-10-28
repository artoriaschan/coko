// 工具调度（票 04）：并发上限、effect 分区与执行记录。faux 模型 + 测试工具，经 createAgentRuntime 的公开接口观察；
// 每个调用何时完成由 deferred 控制，不用 sleep。
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { Type } from 'typebox'
import { describe, expect, it } from 'vitest'
import { createAgentRuntime, type AgentRuntimeOptions } from '../engine/runtime.ts'
import type { RunEntry } from '../engine/types.ts'
import { createFauxModels, fauxAssistantMessage, fauxToolCall } from '../testing/faux.ts'
import { createToolRegistry } from './registry.ts'
import type { CokoTool, ToolEffect, ToolExecutionContext } from './types.ts'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

/** 一组测试工具：look（read）、poke（side-effect）、legacy（未声明 effect）。每个调用开始后等待按 toolCallId 放行。 */
function probes(options: { auto?: boolean; onStart?: (toolCallId: string) => void } = {}) {
  const log: string[] = []
  const contexts = new Map<string, ToolExecutionContext | undefined>()
  const gates = new Map<string, ReturnType<typeof deferred>>()
  const starts = new Map<string, ReturnType<typeof deferred>>()
  const of = (map: Map<string, ReturnType<typeof deferred>>, id: string) => {
    let d = map.get(id)
    if (!d) map.set(id, (d = deferred()))
    return d
  }
  let running = 0
  let maxRunning = 0
  const make = (name: string, effect: ToolEffect | undefined): CokoTool => ({
    name,
    label: name,
    description: `${effect ?? 'undeclared'} probe`,
    parameters: Type.Object({}),
    ...(effect ? { effect } : {}),
    async execute(toolCallId, _params, signal, _onUpdate, context) {
      running++
      maxRunning = Math.max(maxRunning, running)
      log.push(`start:${toolCallId}`)
      contexts.set(toolCallId, context)
      options.onStart?.(toolCallId)
      of(starts, toolCallId).resolve()
      try {
        await new Promise<void>((resolve, reject) => {
          if (options.auto) return resolve()
          void of(gates, toolCallId).promise.then(resolve)
          signal?.addEventListener('abort', () => reject(new Error('probe aborted')), { once: true })
        })
        return { content: [{ type: 'text', text: `ok:${toolCallId}` }], details: {} }
      } finally {
        running--
        log.push(`end:${toolCallId}`)
      }
    },
  })
  const registry = createToolRegistry()
  registry.register(make('look', 'read'))
  registry.register(make('poke', 'side-effect'))
  registry.register(make('legacy', undefined))
  return {
    registry,
    log,
    contexts,
    started: (id: string) => of(starts, id).promise,
    release: (id: string) => of(gates, id).resolve(),
    get maxRunning() {
      return maxRunning
    },
  }
}

function harness(tools: ReturnType<typeof probes>, options: Partial<Omit<AgentRuntimeOptions, 'models' | 'model' | 'cwd' | 'tools'>> = {}) {
  const { faux, models, model } = createFauxModels()
  const entries: RunEntry[] = []
  const ended = new Map<string, ReturnType<typeof deferred>>()
  const endedOf = (id: string) => {
    let d = ended.get(id)
    if (!d) ended.set(id, (d = deferred()))
    return d
  }
  const runtime = createAgentRuntime({ models, model, cwd: process.cwd(), tools: tools.registry, sessionId: 's1', commit: async () => {}, ...options })
  runtime.subscribe((event) => {
    if (event.kind === 'entry') entries.push(event.entry)
    else if (event.event.type === 'tool_end') endedOf(event.event.toolCallId).resolve()
  })
  return { faux, runtime, entries, toolEnded: (id: string) => endedOf(id).promise }
}

const batch = (...calls: [name: string, id: string][]) =>
  fauxAssistantMessage(
    calls.map(([name, id]) => fauxToolCall(name, {}, { id })),
    { stopReason: 'toolUse' },
  )
const kinds = (entries: RunEntry[]) => entries.map((e) => (e.kind === 'message' ? e.payload.role : e.kind))
const toolResults = (entries: RunEntry[]) =>
  entries.flatMap((e) => (e.kind === 'message' && e.payload.role === 'toolResult' ? [e.payload as Extract<AgentMessage, { role: 'toolResult' }>] : []))
const text = (message: { content: readonly { type: string; text?: string }[] }) => message.content.map((b) => b.text ?? '').join('')
const toolExecs = (entries: RunEntry[]) => entries.filter((e) => e.kind === 'tool_exec')

describe('工具调度', () => {
  it('6 个 read 调用、上限 2：任意时刻至多 2 个在执行，结果按调用顺序提交，不提交 tool_exec', async () => {
    const p = probes()
    const h = harness(p, { toolConcurrency: 2 })
    const ids = ['r1', 'r2', 'r3', 'r4', 'r5', 'r6']
    h.faux.setResponses([batch(...ids.map((id) => ['look', id] as [string, string])), fauxAssistantMessage('done')])
    const run = h.runtime.run('go')

    await p.started('r1')
    await p.started('r2')
    expect(p.log).toEqual(['start:r1', 'start:r2'])
    // 乱序放行：空出的执行槽按调用顺序交给排队的调用。
    p.release('r2')
    await p.started('r3')
    p.release('r1')
    await p.started('r4')
    p.release('r4')
    await p.started('r5')
    p.release('r3')
    await p.started('r6')
    p.release('r6')
    p.release('r5')
    const result = await run

    expect(result.status).toBe('completed')
    expect(p.maxRunning).toBe(2)
    expect(p.log.filter((line) => line.startsWith('start:'))).toEqual(ids.map((id) => `start:${id}`))
    expect(toolResults(h.entries).map((m) => [m.toolCallId, text(m)])).toEqual(ids.map((id) => [id, `ok:${id}`]))
    expect(toolExecs(h.entries)).toEqual([])
  })

  it('默认上限为 10', async () => {
    const p = probes()
    const h = harness(p)
    const ids = Array.from({ length: 12 }, (_, i) => `r${i + 1}`)
    h.faux.setResponses([batch(...ids.map((id) => ['look', id] as [string, string])), fauxAssistantMessage('done')])
    const run = h.runtime.run('go')
    for (const id of ids.slice(0, 10)) await p.started(id)
    expect(p.log).toEqual(ids.slice(0, 10).map((id) => `start:${id}`))
    for (const id of ids) p.release(id)
    expect((await run).status).toBe('completed')
    expect(p.maxRunning).toBe(10)
  })

  it('[read, read, write, read]：write 在前两个 read 完成后才开始，最后一个 read 在 write 完成后才开始', async () => {
    const p = probes()
    const h = harness(p)
    h.faux.setResponses([batch(['look', 'r1'], ['look', 'r2'], ['poke', 'w1'], ['look', 'r3']), fauxAssistantMessage('done')])
    const run = h.runtime.run('go')

    await p.started('r1')
    await p.started('r2')
    expect(p.log).toEqual(['start:r1', 'start:r2'])
    p.release('r1')
    await h.toolEnded('r1')
    // 只完成了一个 read：write 仍等待，排在它之后的 read 也不越过它。
    expect(p.log).toEqual(['start:r1', 'start:r2', 'end:r1'])
    p.release('r2')
    await p.started('w1')
    expect(p.log).toEqual(['start:r1', 'start:r2', 'end:r1', 'end:r2', 'start:w1'])
    p.release('w1')
    await p.started('r3')
    expect(p.log).toEqual(['start:r1', 'start:r2', 'end:r1', 'end:r2', 'start:w1', 'end:w1', 'start:r3'])
    p.release('r3')
    const result = await run

    expect(result.status).toBe('completed')
    expect(toolResults(h.entries).map((m) => m.toolCallId)).toEqual(['r1', 'r2', 'w1', 'r3'])
    expect(toolExecs(h.entries).map((e) => e.payload)).toEqual([{ toolCallId: 'w1', toolName: 'poke', idempotencyKey: 's1:w1' }])
  })

  it('side-effect 调用的 tool_exec 在 execute 开始前已提交，幂等键经执行上下文交给工具；read 调用不提交', async () => {
    const committed: RunEntry[] = []
    const committedAtStart = new Map<string, boolean>()
    const p = probes({
      auto: true,
      onStart: (id) =>
        committedAtStart.set(
          id,
          committed.some((e) => e.kind === 'tool_exec' && e.payload.toolCallId === id),
        ),
    })
    const h = harness(p, { commit: async (entry) => void committed.push(entry) })
    h.faux.setResponses([batch(['look', 'r1'], ['poke', 'w1'], ['legacy', 'x1']), fauxAssistantMessage('done')])
    const result = await h.runtime.run('go')

    expect(result.status).toBe('completed')
    expect(kinds(h.entries)).toEqual([
      'run_start',
      'user',
      'assistant',
      'tool_exec',
      'tool_exec',
      'toolResult',
      'toolResult',
      'toolResult',
      'assistant',
      'run_end',
    ])
    expect(toolExecs(h.entries)).toEqual([
      { kind: 'tool_exec', runId: result.runId, payload: { toolCallId: 'w1', toolName: 'poke', idempotencyKey: 's1:w1' } },
      { kind: 'tool_exec', runId: result.runId, payload: { toolCallId: 'x1', toolName: 'legacy', idempotencyKey: 's1:x1' } },
    ])
    expect(Object.fromEntries(committedAtStart)).toEqual({ r1: false, w1: true, x1: true })
    expect(p.contexts.get('w1')).toEqual({ idempotencyKey: 's1:w1' })
  })

  it('tool_exec 提交失败：execute 未被调用，同批其余调用也不执行，Run 以 commit_failed 结束', async () => {
    const p = probes({ auto: true })
    const h = harness(p, {
      commit: async (entry) => {
        if (entry.kind === 'tool_exec') throw new Error('disk full')
      },
    })
    h.faux.setResponses([batch(['poke', 'w1'], ['poke', 'w2']), fauxAssistantMessage('should not be used')])
    const result = await h.runtime.run('go')

    expect(result).toMatchObject({ status: 'error', error: { code: 'commit_failed', message: 'disk full' } })
    expect(p.log).toEqual([])
    expect(kinds(h.entries)).toEqual(['run_start', 'user', 'assistant'])
  })

  it('排队中 abort：未开始的调用返回 Operation aborted 且没有 tool_exec', async () => {
    const p = probes()
    const h = harness(p)
    h.faux.setResponses([batch(['poke', 'w1'], ['poke', 'w2'], ['look', 'r1']), fauxAssistantMessage('should not be used')])
    const run = h.runtime.run('go')
    await p.started('w1')
    h.runtime.abort()
    const result = await run

    expect(result.status).toBe('aborted')
    expect(p.log).toEqual(['start:w1', 'end:w1'])
    expect(toolResults(h.entries).map((m) => [m.toolCallId, m.isError, text(m)])).toEqual([
      ['w1', true, 'probe aborted'],
      ['w2', true, 'Operation aborted'],
      ['r1', true, 'Operation aborted'],
    ])
    expect(toolExecs(h.entries).map((e) => e.payload.toolCallId)).toEqual(['w1'])
  })

  it('toolConcurrency 必须是正整数', () => {
    const { models, model } = createFauxModels()
    expect(() => createAgentRuntime({ models, model, cwd: process.cwd(), commit: async () => {}, toolConcurrency: 0 })).toThrow(RangeError)
  })
})
