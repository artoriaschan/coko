// 运行控制：追加指令（steer）、暂停（pause）与继续（continue）。faux 模型 + 临时 Workspace，
// 工具执行的交叠位置由 deferred 控制，不用 sleep。
import { access } from 'node:fs/promises'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { Type } from 'typebox'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createLocalExecPort } from '../ports/local-exec.ts'
import { createFauxModels, fauxAssistantMessage, fauxToolCall } from '../testing/faux.ts'
import { createTempWorkspace, type TempWorkspace } from '../testing/workspace.ts'
import { createToolRegistry } from '../tools/registry.ts'
import type { CokoTool } from '../tools/types.ts'
import { createAgentRuntime, NoActiveRunError, NothingToContinueError, RuntimeBusyError, type AgentRuntimeOptions } from './runtime.ts'
import type { RunEntry } from './types.ts'

let ws: TempWorkspace
beforeEach(async () => {
  ws = await createTempWorkspace('coko-run-control-')
})
afterEach(async () => {
  await ws.dispose()
})

function deferred<T = void>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

/** 受控的宿主工具：开始时兑现 started，release 后返回。 */
function gatedTool(name = 'slow') {
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
  return { tool, started: started.promise, release: () => release.resolve() }
}

function harness(options: Partial<Omit<AgentRuntimeOptions, 'models' | 'model'>> = {}) {
  const { faux, models, model } = createFauxModels()
  const entries: RunEntry[] = []
  const waiters = new Set<() => void>()
  const runtime = createAgentRuntime({ models, model, cwd: ws.dir, sessionId: 's1', commit: async () => {}, ...options })
  runtime.subscribe((event) => {
    if (event.kind !== 'entry') return
    entries.push(event.entry)
    for (const waiter of waiters) waiter()
  })
  const until = (predicate: () => boolean) =>
    new Promise<void>((resolve) => {
      const check = () => {
        if (!predicate()) return
        waiters.delete(check)
        resolve()
      }
      waiters.add(check)
      check()
    })
  return { faux, runtime, entries, until }
}

function withSlow() {
  const slow = gatedTool()
  const tools = createToolRegistry()
  tools.register(slow.tool)
  return { slow, tools }
}

const callSlow = () => fauxAssistantMessage(fauxToolCall('slow', {}, { id: 's1' }), { stopReason: 'toolUse' })
const kinds = (entries: RunEntry[]) => entries.map((e) => (e.kind === 'message' ? e.payload.role : e.kind))
const textOf = (message: AgentMessage) => {
  const content = (message as { content: unknown }).content
  if (typeof content === 'string') return content
  return (content as { type: string; text?: string }[]).map((b) => b.text ?? '').join('')
}
const users = (entries: RunEntry[]) => entries.flatMap((e) => (e.kind === 'message' && e.payload.role === 'user' ? [textOf(e.payload)] : []))

describe('追加指令（steer）', () => {
  it('工具执行中 steer：user message 位于这次 toolResult 之后、下一条 assistant 之前；下一次请求上下文含该文本', async () => {
    const { slow, tools } = withSlow()
    const h = harness({ tools })
    const contexts: string[] = []
    h.faux.setResponses([
      callSlow(),
      (context) => {
        contexts.push(JSON.stringify(context.messages))
        return fauxAssistantMessage('adjusted')
      },
    ])
    const run = h.runtime.run('start')
    await slow.started
    h.runtime.steer('also check the README')
    slow.release()
    const result = await run

    expect(result).toEqual({ runId: result.runId, status: 'completed' })
    expect(kinds(h.entries)).toEqual(['run_start', 'user', 'assistant', 'toolResult', 'user', 'assistant', 'run_end'])
    expect(users(h.entries)).toEqual(['start', 'also check the README'])
    expect(h.entries.every((e) => e.runId === result.runId)).toBe(true)
    expect(contexts).toHaveLength(1)
    expect(contexts[0]).toContain('also check the README')
    expect(h.entries.at(-1)?.payload).toEqual({ status: 'completed' })
  })

  it('多条追加指令按发送顺序在同一时机送达', async () => {
    const { slow, tools } = withSlow()
    const h = harness({ tools })
    h.faux.setResponses([callSlow(), fauxAssistantMessage('ok')])
    const run = h.runtime.run('start')
    await slow.started
    h.runtime.steer('first')
    h.runtime.steer('second')
    slow.release()
    await run
    expect(kinds(h.entries)).toEqual(['run_start', 'user', 'assistant', 'toolResult', 'user', 'user', 'assistant', 'run_end'])
    expect(users(h.entries)).toEqual(['start', 'first', 'second'])
  })

  it('steer 后立刻 abort（未送达）：run_end 带 undeliveredSteering，没有对应 user message', async () => {
    const { slow, tools } = withSlow()
    const h = harness({ tools })
    h.faux.setResponses([callSlow(), fauxAssistantMessage('never')])
    const run = h.runtime.run('start')
    await slow.started
    h.runtime.steer('not yet')
    h.runtime.abort()
    slow.release()
    const result = await run

    expect(result).toMatchObject({ status: 'aborted', undeliveredSteering: ['not yet'] })
    expect(h.entries.at(-1)).toEqual({ kind: 'run_end', runId: result.runId, payload: { status: 'aborted', undeliveredSteering: ['not yet'] } })
    expect(users(h.entries)).toEqual(['start'])
    expect(h.faux.state.callCount).toBe(1)
  })

  it('最后一轮只有文本时也送达（模型再回应一次）；追加指令不延续到下一个 Run', async () => {
    const h = harness()
    const streaming = deferred()
    const release = deferred()
    h.faux.setResponses([
      async () => {
        streaming.resolve()
        await release.promise
        return fauxAssistantMessage('first reply')
      },
      fauxAssistantMessage('saw the steer'),
      fauxAssistantMessage('next run'),
    ])
    const run = h.runtime.run('start')
    await streaming.promise
    h.runtime.steer('one more thing')
    release.resolve()
    expect((await run).status).toBe('completed')
    expect(users(h.entries)).toEqual(['start', 'one more thing'])
    expect(h.faux.state.callCount).toBe(2)

    const before = h.entries.length
    await h.runtime.run('again')
    expect(users(h.entries.slice(before))).toEqual(['again'])
  })

  it('没有 Run 时 steer 与 pause 报 NoActiveRunError', () => {
    const h = harness()
    expect(() => h.runtime.steer('x')).toThrow(NoActiveRunError)
    expect(() => h.runtime.pause()).toThrow(NoActiveRunError)
  })
})

describe('暂停与继续', () => {
  it('工具执行中 pause：工具完成且 toolResult 提交，之后不发新请求，run_end paused；continue 开始新 Run（trigger continue）', async () => {
    const { slow, tools } = withSlow()
    const h = harness({ tools })
    const contexts: string[] = []
    h.faux.setResponses([
      callSlow(),
      (context) => {
        contexts.push(JSON.stringify(context.messages))
        return fauxAssistantMessage('continued')
      },
    ])
    const run = h.runtime.run('start')
    await slow.started
    h.runtime.pause()
    slow.release()
    const paused = await run

    expect(paused).toEqual({ runId: paused.runId, status: 'paused' })
    expect(kinds(h.entries)).toEqual(['run_start', 'user', 'assistant', 'toolResult', 'run_end'])
    expect(h.entries.at(-1)?.payload).toEqual({ status: 'paused' })
    expect(textOf((h.entries[3] as Extract<RunEntry, { kind: 'message' }>).payload)).toBe('slow done')
    expect(h.faux.state.callCount).toBe(1)
    expect(h.runtime.isRunning).toBe(false)

    const continued = await h.runtime.continue()
    expect(continued.status).toBe('completed')
    expect(continued.runId).not.toBe(paused.runId)
    const second = h.entries.filter((e) => e.runId === continued.runId)
    expect(second[0]).toEqual({ kind: 'run_start', runId: continued.runId, payload: { trigger: 'continue' } })
    expect(kinds(second)).toEqual(['run_start', 'assistant', 'run_end'])
    expect(h.faux.state.callCount).toBe(2)
    expect(contexts[0]).toContain('slow done')
    await expect(h.runtime.continue()).rejects.toThrow(NothingToContinueError)
  })

  it('pause 时未送达的追加指令随 run_end 退回', async () => {
    const { slow, tools } = withSlow()
    const h = harness({ tools })
    h.faux.setResponses([callSlow(), fauxAssistantMessage('never')])
    const run = h.runtime.run('start')
    await slow.started
    h.runtime.steer('later')
    h.runtime.pause()
    slow.release()
    const result = await run
    expect(result).toMatchObject({ status: 'paused', undeliveredSteering: ['later'] })
    expect(h.entries.at(-1)?.payload).toEqual({ status: 'paused', undeliveredSteering: ['later'] })
    expect(users(h.entries)).toEqual(['start'])
  })

  it('只有文本的最后一轮中 pause：Run 照常完成，没有可继续的内容', async () => {
    const h = harness()
    const streaming = deferred()
    const release = deferred()
    h.faux.setResponses([
      async () => {
        streaming.resolve()
        await release.promise
        return fauxAssistantMessage('all done')
      },
    ])
    const run = h.runtime.run('start')
    await streaming.promise
    h.runtime.pause()
    release.resolve()
    expect((await run).status).toBe('completed')
    await expect(h.runtime.continue()).rejects.toThrow(NothingToContinueError)
  })

  it('上一 Run 不是 paused / interrupted 时 continue 报 NothingToContinueError；Run 进行中报 RuntimeBusyError', async () => {
    await expect(harness().runtime.continue()).rejects.toThrow(NothingToContinueError)

    const { slow, tools } = withSlow()
    const h = harness({ tools })
    h.faux.setResponses([callSlow(), fauxAssistantMessage('done')])
    const run = h.runtime.run('start')
    await slow.started
    await expect(h.runtime.continue()).rejects.toThrow(RuntimeBusyError)
    h.runtime.abort()
    slow.release()
    expect((await run).status).toBe('aborted')
    // 停止是用户的明确结束，之后不能 continue。
    await expect(h.runtime.continue()).rejects.toThrow(NothingToContinueError)
  })

  it('从已提交条目恢复的运行时按 lastRunStatus 判断能否 continue', async () => {
    const { slow, tools } = withSlow()
    const first = harness({ tools })
    first.faux.setResponses([callSlow()])
    const run = first.runtime.run('start')
    await slow.started
    first.runtime.pause()
    slow.release()
    expect((await run).status).toBe('paused')

    const messages = first.entries.flatMap((e) => (e.kind === 'message' ? [e.payload] : []))
    const restored = harness({ tools, messages, lastRunStatus: 'paused' })
    restored.faux.setResponses([fauxAssistantMessage('resumed')])
    expect((await restored.runtime.continue()).status).toBe('completed')
    expect(restored.faux.state.callCount).toBe(1)

    const interrupted = harness({ tools, messages, lastRunStatus: 'interrupted' })
    interrupted.faux.setResponses([fauxAssistantMessage('resumed')])
    expect((await interrupted.runtime.continue()).status).toBe('completed')

    await expect(harness({ tools, messages, lastRunStatus: 'completed' }).runtime.continue()).rejects.toThrow(NothingToContinueError)
  })

  it('等待审批时 pause：请求 cancelled、调用未执行、run_end paused，没有新的模型请求', async () => {
    const h = harness({
      exec: createLocalExecPort({ sandbox: { wrap: () => [], denialSignature: 'operation not permitted' } }),
      permissions: { mode: () => 'default', rules: () => [] },
    })
    h.faux.setResponses([
      fauxAssistantMessage(fauxToolCall('bash', { command: 'printf hi > out.txt' }, { id: 'b1' }), { stopReason: 'toolUse' }),
      fauxAssistantMessage('never'),
    ])
    const run = h.runtime.run('write it')
    await h.until(() => h.entries.some((e) => e.kind === 'approval_request'))
    const request = h.entries.find((e): e is Extract<RunEntry, { kind: 'approval_request' }> => e.kind === 'approval_request')!
    h.runtime.pause()
    const result = await run

    expect(result.status).toBe('paused')
    expect(h.entries.find((e) => e.kind === 'approval_decision')?.payload).toEqual({ requestId: request.payload.requestId, outcome: 'cancelled' })
    expect(h.runtime.pendingApprovals).toEqual([])
    expect(h.entries.some((e) => e.kind === 'tool_exec')).toBe(false)
    expect(kinds(h.entries)).toEqual(['run_start', 'user', 'assistant', 'approval_request', 'approval_decision', 'toolResult', 'run_end'])
    const toolResult = h.entries.find((e) => e.kind === 'message' && e.payload.role === 'toolResult') as Extract<RunEntry, { kind: 'message' }>
    expect(toolResult.payload).toMatchObject({ toolCallId: 'b1', isError: true })
    expect(textOf(toolResult.payload)).toMatch(/paused/i)
    expect(h.faux.state.callCount).toBe(1)
    await expect(access(ws.path('out.txt'))).rejects.toThrow(/ENOENT/)
  })
})
