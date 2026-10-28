import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { Type } from 'typebox'
import { Value } from 'typebox/value'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createLocalExecPort } from '../ports/local-exec.ts'
import { createFauxModels, fauxAssistantMessage, fauxToolCall } from '../testing/faux.ts'
import { isProcessAlive, readPids, waitFor } from '../testing/process.ts'
import { createTempWorkspace, type TempWorkspace } from '../testing/workspace.ts'
import { bashOutputSchema } from '../tools/builtin/bash.ts'
import { createGrepTool } from '../tools/builtin/grep.ts'
import { createBuiltinToolRegistry } from '../tools/builtin/index.ts'
import { readOutputSchema } from '../tools/builtin/read.ts'
import { createToolRegistry } from '../tools/registry.ts'
import type { CokoTool } from '../tools/types.ts'
import { createAgentRuntime, NothingToRetryError, RuntimeBusyError, type AgentRuntimeOptions } from './runtime.ts'
import type { ProgressEvent, RunEntry } from './types.ts'

let ws: TempWorkspace
beforeEach(async () => {
  ws = await createTempWorkspace('coko-runtime-')
})
afterEach(async () => {
  await ws.dispose()
})

type HarnessOptions = Partial<Omit<AgentRuntimeOptions, 'models' | 'model'>> & { tokensPerSecond?: number }

function harness(options: HarnessOptions = {}) {
  const { tokensPerSecond, ...runtimeOptions } = options
  const { faux, models, model } = createFauxModels(tokensPerSecond === undefined ? {} : { tokensPerSecond })
  const entries: RunEntry[] = []
  const progress: ProgressEvent[] = []
  const runtime = createAgentRuntime({
    models,
    model,
    cwd: ws.dir,
    commit: async () => {},
    retry: { maxRetries: 2, baseDelayMs: 1 },
    ...runtimeOptions,
  })
  runtime.subscribe((event) => {
    if (event.kind === 'entry') entries.push(event.entry)
    else progress.push(event.event)
  })
  return { faux, runtime, entries, progress }
}

const messagesOf = (entries: RunEntry[]): AgentMessage[] => entries.flatMap((entry) => (entry.kind === 'message' ? [entry.message] : []))
const toolResultsOf = (entries: RunEntry[]) => messagesOf(entries).flatMap((message) => (message.role === 'toolResult' ? [message] : []))
const assistantsOf = (entries: RunEntry[]) => messagesOf(entries).flatMap((message) => (message.role === 'assistant' ? [message] : []))
const textOf = (content: readonly { type: string; text?: string }[]) => content.map((block) => (block.type === 'text' ? (block.text ?? '') : '')).join('')

function deferred<T = void>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

function hostTool(name: string, execute: CokoTool['execute']): CokoTool {
  return { name, label: name, description: `host tool ${name}`, parameters: Type.Object({}), execute }
}

describe('Agent 运行时：内置工具闭环', () => {
  it('faux 模型调用 write 后文件内容正确，read / edit / ls / find / grep / bash 结果与 schema 一致', async () => {
    const keep = await ws.write('keep.txt', 'do not touch\n')
    const keepBefore = await readFile(keep)
    const h = harness()
    h.faux.setResponses([
      fauxAssistantMessage(fauxToolCall('write', { path: 'notes/a.txt', content: 'alpha\nbeta\n' }, { id: 'w1' }), { stopReason: 'toolUse' }),
      fauxAssistantMessage(
        [
          fauxToolCall('read', { path: 'notes/a.txt' }, { id: 'r1' }),
          fauxToolCall('ls', { path: 'notes' }, { id: 'l1' }),
          fauxToolCall('find', { pattern: '*.txt' }, { id: 'f1' }),
          fauxToolCall('grep', { pattern: 'beta' }, { id: 'g1' }),
          fauxToolCall('bash', { command: 'cat notes/a.txt' }, { id: 'b1' }),
        ],
        { stopReason: 'toolUse' },
      ),
      fauxAssistantMessage(fauxToolCall('edit', { path: 'notes/a.txt', edits: [{ oldText: 'beta', newText: 'gamma' }] }, { id: 'e1' }), {
        stopReason: 'toolUse',
      }),
      fauxAssistantMessage('done'),
    ])

    const result = await h.runtime.run('please edit the notes')

    expect(result.status).toBe('completed')
    expect(await readFile(ws.path('notes/a.txt'), 'utf-8')).toBe('alpha\ngamma\n')
    expect((await readFile(keep)).equals(keepBefore)).toBe(true)
    expect(toolResultsOf(h.entries).map((message) => [message.toolCallId, message.isError, textOf(message.content)])).toEqual([
      ['w1', false, 'Successfully wrote to notes/a.txt'],
      ['r1', false, 'alpha\nbeta\n'],
      ['l1', false, 'a.txt'],
      ['f1', false, 'keep.txt\nnotes/a.txt'],
      ['g1', false, 'notes/a.txt:2: beta'],
      ['b1', false, 'alpha\nbeta\n'],
      ['e1', false, 'Successfully replaced 1 block(s) in notes/a.txt.'],
    ])
    const toolEnds = new Map(h.progress.flatMap((event) => (event.type === 'tool_end' ? [[event.toolCallId, event] as const] : [])))
    expect(Value.Check(readOutputSchema, toolEnds.get('r1')?.result.structuredContent)).toBe(true)
    expect(Value.Check(bashOutputSchema, toolEnds.get('b1')?.result.structuredContent)).toBe(true)
    expect(toolEnds.get('e1')?.result.details).toMatchObject({ patch: expect.stringContaining('+gamma') })

    expect(h.entries[0]).toMatchObject({ kind: 'message', runId: result.runId, message: { role: 'user' } })
    expect(h.entries.at(-1)).toEqual({ kind: 'run_end', runId: result.runId, status: 'completed' })
    expect(textOf(assistantsOf(h.entries).at(-1)?.content ?? [])).toBe('done')
  })

  it('文本增量只作 progress，最终回复作为已提交条目', async () => {
    const h = harness()
    h.faux.setResponses([fauxAssistantMessage('hello streaming world')])
    await h.runtime.run('hi')
    const deltas = h.progress.flatMap((event) => (event.type === 'assistant_delta' && event.kind === 'text' ? [event.delta] : []))
    expect(deltas.join('')).toBe('hello streaming world')
    expect(deltas.length).toBeGreaterThan(1)
    expect(h.entries.map((entry) => entry.kind)).toEqual(['message', 'message', 'run_end'])
  })

  it('以已提交条目恢复上下文后继续对话', async () => {
    const first = harness()
    first.faux.setResponses([fauxAssistantMessage('first answer')])
    await first.runtime.run('first question')

    let seen = ''
    const second = harness({ messages: messagesOf(first.entries) })
    second.faux.setResponses([
      (context) => {
        seen = JSON.stringify(context.messages)
        return fauxAssistantMessage('second answer')
      },
    ])
    await second.runtime.run('second question')
    expect(seen).toContain('first question')
    expect(seen).toContain('first answer')
    expect(seen).toContain('second question')
  })
})

describe('Agent 运行时：顺序与提交屏障', () => {
  it('并行工具调用的持久化顺序等于模型调用顺序，progress 按完成顺序', async () => {
    const fastDone = deferred()
    const tools = createToolRegistry()
    tools.register(
      hostTool('slow', async () => {
        await fastDone.promise
        return { content: [{ type: 'text', text: 'slow result' }], details: undefined }
      }),
    )
    tools.register(
      hostTool('fast', async () => {
        fastDone.resolve()
        return { content: [{ type: 'text', text: 'fast result' }], details: undefined }
      }),
    )
    const h = harness({ tools })
    h.faux.setResponses([
      fauxAssistantMessage([fauxToolCall('slow', {}, { id: 'call-slow' }), fauxToolCall('fast', {}, { id: 'call-fast' })], { stopReason: 'toolUse' }),
      fauxAssistantMessage('both done'),
    ])
    await h.runtime.run('go')
    expect(toolResultsOf(h.entries).map((message) => message.toolCallId)).toEqual(['call-slow', 'call-fast'])
    expect(h.progress.flatMap((event) => (event.type === 'tool_end' ? [event.toolCallId] : []))).toEqual(['call-fast', 'call-slow'])
  })

  it('message_end 的提交完成后工具才开始执行', async () => {
    const log: string[] = []
    // gate 控制提交何时完成；committing 标记提交已开始，确定交叠位置。
    const gate = deferred()
    const committing = deferred()
    const tools = createToolRegistry()
    tools.register(
      hostTool('probe', async () => {
        log.push('tool-start')
        return { content: [{ type: 'text', text: 'ok' }], details: undefined }
      }),
    )
    const h = harness({
      tools,
      commit: async (entry) => {
        if (entry.kind !== 'message' || entry.message.role !== 'assistant' || log.includes('commit-end:assistant')) return
        log.push('commit-start:assistant')
        committing.resolve()
        await gate.promise
        log.push('commit-end:assistant')
      },
    })
    h.faux.setResponses([fauxAssistantMessage(fauxToolCall('probe', {}, { id: 'p1' }), { stopReason: 'toolUse' }), fauxAssistantMessage('end')])
    const running = h.runtime.run('go')
    await committing.promise
    // 让已排队的微任务与 I/O 回调跑完（一轮事件循环，不是按时长等待）；若工具不等提交，它此时已经开始。
    await new Promise((resolve) => setImmediate(resolve))
    // 提交挂起期间工具不得开始。
    expect(log).toEqual(['commit-start:assistant'])
    expect(h.progress.some((event) => event.type === 'tool_start')).toBe(false)
    gate.resolve()
    await running
    expect(log).toEqual(['commit-start:assistant', 'commit-end:assistant', 'tool-start'])
  })

  it('提交失败时 Run 以 commit_failed 结束且不再执行工具', async () => {
    const h = harness({
      commit: async (entry) => {
        if (entry.kind === 'message' && entry.message.role === 'assistant') throw new Error('disk full')
      },
    })
    h.faux.setResponses([
      fauxAssistantMessage(fauxToolCall('bash', { command: 'touch ran' }, { id: 'b1' }), { stopReason: 'toolUse' }),
      fauxAssistantMessage('end'),
    ])
    const result = await h.runtime.run('go')
    expect(result.status).toBe('error')
    expect(result.error).toEqual({ code: 'commit_failed', message: 'disk full' })
    await expect(access(ws.path('ran'))).rejects.toThrow(/ENOENT/)
    expect(h.entries.map((entry) => (entry.kind === 'message' ? entry.message.role : entry.kind))).toEqual(['user'])
    expect(h.progress.at(-1)).toEqual({ type: 'run_end', runId: result.runId, status: 'error', error: { code: 'commit_failed', message: 'disk full' } })
  })

  it('每个 Run 以 run_end progress 结束；run_end 条目提交失败时 progress 仍报告结束', async () => {
    const ok = harness()
    ok.faux.setResponses([fauxAssistantMessage('fine')])
    const done = await ok.runtime.run('hi')
    expect(ok.progress.at(-1)).toEqual({ type: 'run_end', runId: done.runId, status: 'completed' })
    expect(ok.progress.filter((event) => event.type === 'run_end')).toHaveLength(1)

    const h = harness({
      commit: async (entry) => {
        if (entry.kind === 'run_end') throw new Error('lease lost')
      },
    })
    h.faux.setResponses([fauxAssistantMessage('fine')])
    const result = await h.runtime.run('hi')
    expect(result).toMatchObject({ status: 'error', error: { code: 'commit_failed', message: 'lease lost' } })
    expect(h.entries.some((entry) => entry.kind === 'run_end')).toBe(false)
    expect(h.progress.at(-1)).toEqual({ type: 'run_end', runId: result.runId, status: 'error', error: { code: 'commit_failed', message: 'lease lost' } })
    expect(h.runtime.isRunning).toBe(false)
  })
})

describe('Agent 运行时：取消', () => {
  it('abort 后 Run 以取消结束，bash 子进程已退出', async () => {
    const pidFile = ws.path('pids')
    const h = harness()
    h.faux.setResponses([
      fauxAssistantMessage(fauxToolCall('bash', { command: `sleep 30 & echo "$$ $!" > ${pidFile}; wait` }, { id: 'b1' }), { stopReason: 'toolUse' }),
      fauxAssistantMessage('should not be reached'),
    ])
    const running = h.runtime.run('run something long')
    expect(await waitFor(async () => (await readPids(pidFile)).length === 2)).toBe(true)
    const [shellPid, childPid] = await readPids(pidFile)

    h.runtime.abort()
    const result = await running

    expect(result.status).toBe('aborted')
    expect(h.entries.at(-1)).toEqual({ kind: 'run_end', runId: result.runId, status: 'aborted' })
    expect(isProcessAlive(shellPid as number)).toBe(false)
    expect(await waitFor(() => !isProcessAlive(childPid as number), 2_000)).toBe(true)
    const [bashResult] = toolResultsOf(h.entries)
    expect(bashResult?.isError).toBe(true)
    expect(textOf(bashResult?.content ?? [])).toContain('Command aborted')
    expect(h.runtime.isRunning).toBe(false)
  })

  it('流式输出中 abort，Run 以取消结束', async () => {
    const h = harness({ tokensPerSecond: 40 })
    h.faux.setResponses([fauxAssistantMessage('a fairly long reply that streams slowly '.repeat(5))])
    h.runtime.subscribe((event) => {
      if (event.kind === 'progress' && event.event.type === 'assistant_delta') h.runtime.abort()
    })
    const result = await h.runtime.run('talk')
    expect(result.status).toBe('aborted')
    expect(assistantsOf(h.entries).at(-1)?.stopReason).toBe('aborted')
  })

  it('运行中再次 run 报 RuntimeBusyError', async () => {
    const h = harness({ tokensPerSecond: 40 })
    h.faux.setResponses([fauxAssistantMessage('slow reply '.repeat(20))])
    const running = h.runtime.run('first')
    await expect(h.runtime.run('second')).rejects.toThrow(RuntimeBusyError)
    h.runtime.abort()
    expect((await running).status).toBe('aborted')
  })
})

describe('Agent 运行时：模型错误与重试', () => {
  const unavailable = () => fauxAssistantMessage([], { stopReason: 'error', errorMessage: '503 Service Unavailable' })

  it('可重试错误按策略重试，失败的尝试不进入已提交条目', async () => {
    const h = harness()
    h.faux.setResponses([unavailable(), fauxAssistantMessage('recovered')])
    const result = await h.runtime.run('hi')
    expect(result.status).toBe('completed')
    expect(h.faux.state.callCount).toBe(2)
    expect(assistantsOf(h.entries).map((message) => textOf(message.content))).toEqual(['recovered'])
    expect(h.progress.filter((event) => event.type === 'retry')).toEqual([
      { type: 'retry', runId: result.runId, attempt: 1, maxRetries: 2, delayMs: expect.any(Number), errorMessage: '503 Service Unavailable' },
    ])
  })

  it('重试耗尽后转为 Run 错误条目', async () => {
    const h = harness()
    h.faux.setResponses([unavailable(), unavailable(), unavailable(), fauxAssistantMessage('never')])
    const result = await h.runtime.run('hi')
    expect(h.faux.state.callCount).toBe(3)
    expect(result).toMatchObject({ status: 'error', error: { code: 'model_error', message: '503 Service Unavailable' } })
    expect(h.entries.at(-1)).toEqual({
      kind: 'run_end',
      runId: result.runId,
      status: 'error',
      error: { code: 'model_error', message: '503 Service Unavailable' },
    })
  })

  it('不可重试的流错误立即转为 Run 错误条目', async () => {
    const h = harness()
    h.faux.setResponses([fauxAssistantMessage([], { stopReason: 'error', errorMessage: 'Invalid API key' }), fauxAssistantMessage('never')])
    const result = await h.runtime.run('hi')
    expect(h.faux.state.callCount).toBe(1)
    expect(result.error).toEqual({ code: 'model_error', message: 'Invalid API key' })
    expect(assistantsOf(h.entries).at(-1)).toMatchObject({ stopReason: 'error', errorMessage: 'Invalid API key' })
  })

  it('retry 重新执行出错的上一轮：不追加用户消息，模型看到的上下文中用户请求只出现一次', async () => {
    const h = harness()
    const contexts: string[] = []
    h.faux.setResponses([
      fauxAssistantMessage([], { stopReason: 'error', errorMessage: 'Invalid API key' }),
      (context) => {
        contexts.push(JSON.stringify(context.messages))
        return fauxAssistantMessage('recovered')
      },
    ])
    const failed = await h.runtime.run('do the thing')
    expect(failed.status).toBe('error')
    const retried = await h.runtime.retry()
    expect(retried.status).toBe('completed')
    expect(retried.runId).not.toBe(failed.runId)
    const retriedEntries = h.entries.filter((entry) => entry.runId === retried.runId)
    expect(retriedEntries.map((entry) => (entry.kind === 'message' ? entry.message.role : entry.kind))).toEqual(['assistant', 'run_end'])
    expect(contexts[0]?.split('do the thing')).toHaveLength(2)
    expect(h.runtime.messages.filter((message) => message.role === 'user')).toHaveLength(1)
    expect(h.progress.filter((event) => event.runId === retried.runId).map((event) => event.type)).toContain('run_start')
  })

  it('从已提交条目恢复后也能重试；上一轮没有出错时 retry 拒绝', async () => {
    const first = harness()
    first.faux.setResponses([fauxAssistantMessage([], { stopReason: 'error', errorMessage: 'Invalid API key' })])
    await first.runtime.run('restore me')
    const second = harness({ messages: messagesOf(first.entries) })
    second.faux.setResponses([fauxAssistantMessage('back')])
    expect((await second.runtime.retry()).status).toBe('completed')
    await expect(second.runtime.retry()).rejects.toThrow(NothingToRetryError)
    await expect(harness().runtime.retry()).rejects.toThrow(NothingToRetryError)
  })

  it('已输出内容后出错不重试，避免重复展示', async () => {
    const h = harness()
    h.faux.setResponses([fauxAssistantMessage('partial', { stopReason: 'error', errorMessage: '503 Service Unavailable' }), fauxAssistantMessage('never')])
    const result = await h.runtime.run('hi')
    expect(h.faux.state.callCount).toBe(1)
    expect(result.status).toBe('error')
  })
})

describe('Agent 运行时：Hook 与工具覆盖', () => {
  it('before / after 调度点作用于内置与宿主工具', async () => {
    const tools = createBuiltinToolRegistry({ cwd: ws.dir, exec: createLocalExecPort() })
    tools.register(hostTool('host_echo', async () => ({ content: [{ type: 'text', text: 'raw' }], details: undefined })))
    const seen: string[] = []
    const h = harness({
      tools,
      hooks: [
        {
          beforeToolCall: async ({ toolCall }) => {
            seen.push(`before:${toolCall.name}`)
            return toolCall.name === 'bash' ? { block: true, reason: 'bash blocked by hook' } : undefined
          },
          afterToolCall: async ({ toolCall, result }) => {
            seen.push(`after:${toolCall.name}`)
            return toolCall.name === 'host_echo' ? { content: [{ type: 'text', text: `${textOf(result.content)}+hooked` }] } : undefined
          },
        },
      ],
    })
    h.faux.setResponses([
      fauxAssistantMessage([fauxToolCall('bash', { command: 'touch ran' }, { id: 'b1' }), fauxToolCall('host_echo', {}, { id: 'h1' })], {
        stopReason: 'toolUse',
      }),
      fauxAssistantMessage('end'),
    ])
    await h.runtime.run('go')
    expect(toolResultsOf(h.entries).map((message) => [message.toolCallId, message.isError, textOf(message.content)])).toEqual([
      ['b1', true, 'bash blocked by hook'],
      ['h1', false, 'raw+hooked'],
    ])
    await expect(access(ws.path('ran'))).rejects.toThrow(/ENOENT/)
    // A blocked call never executes, so pi does not run after hooks for it.
    expect(seen).toEqual(['before:bash', 'before:host_echo', 'after:host_echo'])
  })

  it('声明覆盖的宿主 grep 在运行时生效', async () => {
    const tools = createBuiltinToolRegistry({ cwd: ws.dir, exec: createLocalExecPort() })
    tools.register(
      createGrepTool({
        cwd: ws.dir,
        searcher: async (request) => ({
          matches: [{ filePath: join(request.searchPath, 'virtual.txt'), lineNumber: 7, lineText: 'from host' }],
          limitReached: false,
        }),
      }),
      { override: true },
    )
    const h = harness({ tools })
    h.faux.setResponses([fauxAssistantMessage(fauxToolCall('grep', { pattern: 'x' }, { id: 'g1' }), { stopReason: 'toolUse' }), fauxAssistantMessage('end')])
    await h.runtime.run('search')
    expect(textOf(toolResultsOf(h.entries)[0]?.content ?? [])).toBe('virtual.txt:7: from host')
    expect(tools.implementations().find((entry) => entry.name === 'grep')).toEqual({ name: 'grep', source: 'host' })
  })
})
