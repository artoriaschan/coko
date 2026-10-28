// 审批闭环的运行时行为：faux 模型 + 临时 Workspace，经 createAgentRuntime 的公开接口观察条目、文件与运行结果。
import { access, readFile, symlink } from 'node:fs/promises'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createAgentRuntime, type AgentRuntime } from '../engine/runtime.ts'
import type { RunEntry } from '../engine/types.ts'
import { createFauxModels, fauxAssistantMessage, fauxToolCall } from '../testing/faux.ts'
import { createTempWorkspace, type TempWorkspace } from '../testing/workspace.ts'
import { ApprovalNotPendingError } from './broker.ts'

let ws: TempWorkspace
let outside: TempWorkspace
beforeEach(async () => {
  ws = await createTempWorkspace('coko-approval-')
  outside = await createTempWorkspace('coko-outside-')
})
afterEach(async () => {
  await ws.dispose()
  await outside.dispose()
})

function harness() {
  const { faux, models, model } = createFauxModels()
  const entries: RunEntry[] = []
  const waiters = new Set<() => void>()
  const runtime = createAgentRuntime({
    models,
    model,
    cwd: ws.dir,
    sessionId: 's1',
    commit: async () => {},
    permissions: { mode: () => 'default', rules: () => [] },
  })
  runtime.subscribe((event) => {
    if (event.kind !== 'entry') return
    entries.push(event.entry)
    for (const waiter of waiters) waiter()
  })
  /** 等第 n 条（从 1 起）approval_request 条目。 */
  const request = (n = 1) =>
    new Promise<Extract<RunEntry, { kind: 'approval_request' }>>((resolve) => {
      const check = () => {
        const found = entries.filter((e): e is Extract<RunEntry, { kind: 'approval_request' }> => e.kind === 'approval_request')[n - 1]
        if (!found) return
        waiters.delete(check)
        resolve(found)
      }
      waiters.add(check)
      check()
    })
  return { faux, runtime, entries, request }
}

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  )
const kinds = (entries: RunEntry[]) => entries.map((e) => (e.kind === 'message' ? e.payload.role : e.kind))
const toolResults = (entries: RunEntry[]) =>
  entries.flatMap((e) => (e.kind === 'message' && e.payload.role === 'toolResult' ? [e.payload as Extract<AgentMessage, { role: 'toolResult' }>] : []))
const text = (message: { content: readonly { type: string; text?: string }[] }) => message.content.map((b) => b.text ?? '').join('')
const bashWrite = (id: string, name: string) => fauxToolCall('bash', { command: `printf hi > ${name}` }, { id })

describe('审批闭环（default 模式）', () => {
  it('bash 写文件先提交 approval_request，允许一次后执行并提交 allowed once；再次回答报 not pending', async () => {
    const h = harness()
    h.faux.setResponses([fauxAssistantMessage(bashWrite('b1', 'out.txt'), { stopReason: 'toolUse' }), fauxAssistantMessage('done')])
    const run = h.runtime.run('write it')
    const request = await h.request()

    expect(request.payload).toEqual({
      requestId: expect.any(String),
      toolCallId: 'b1',
      toolName: 'bash',
      kind: 'tool',
      subject: 'printf hi > out.txt',
      suggestions: [{ behavior: 'allow', tool: 'Bash', content: 'printf hi > out.txt' }],
    })
    expect(h.runtime.pendingApprovals.map((p) => p.requestId)).toEqual([request.payload.requestId])
    expect(await exists(ws.path('out.txt'))).toBe(false)

    await h.runtime.answerApproval(request.payload.requestId, { decision: 'allow', scope: 'once' })
    await expect(h.runtime.answerApproval(request.payload.requestId, { decision: 'allow', scope: 'once' })).rejects.toBeInstanceOf(ApprovalNotPendingError)
    const result = await run

    expect(result.status).toBe('completed')
    expect(await readFile(ws.path('out.txt'), 'utf8')).toBe('hi')
    expect(kinds(h.entries)).toEqual([
      'run_start',
      'user',
      'assistant',
      'approval_request',
      'approval_decision',
      'tool_exec',
      'toolResult',
      'assistant',
      'run_end',
    ])
    expect(h.entries.find((e) => e.kind === 'approval_decision')).toEqual({
      kind: 'approval_decision',
      runId: result.runId,
      payload: { requestId: request.payload.requestId, outcome: 'allowed', scope: 'once' },
    })
    expect(request.runId).toBe(result.runId)
    expect(h.runtime.pendingApprovals).toEqual([])
  })

  it('Workspace 内读取不询问；Workspace 外读取询问', async () => {
    await ws.write('in.txt', 'inside')
    await outside.write('secret.txt', 'outside')
    await symlink(outside.dir, ws.path('link'))
    const h = harness()
    h.faux.setResponses([
      fauxAssistantMessage([fauxToolCall('read', { path: 'in.txt' }, { id: 'r1' }), fauxToolCall('read', { path: 'link/secret.txt' }, { id: 'r2' })], {
        stopReason: 'toolUse',
      }),
      fauxAssistantMessage('done'),
    ])
    const run = h.runtime.run('read')
    const request = await h.request()
    expect(request.payload).toMatchObject({ toolCallId: 'r2', toolName: 'read', subject: 'link/secret.txt' })
    await h.runtime.answerApproval(request.payload.requestId, { decision: 'allow' })
    await run
    expect(h.entries.filter((e) => e.kind === 'approval_request')).toHaveLength(1)
    expect(toolResults(h.entries).map((m) => [m.toolCallId, text(m)])).toEqual([
      ['r1', 'inside'],
      ['r2', 'outside'],
    ])
  })

  it('无反馈拒绝：结果为拒绝错误，Run 以 aborted 结束，不再请求模型，文件不存在', async () => {
    const h = harness()
    h.faux.setResponses([fauxAssistantMessage(bashWrite('b1', 'out.txt'), { stopReason: 'toolUse' }), fauxAssistantMessage('should not be used')])
    const run = h.runtime.run('write it')
    const request = await h.request()
    await h.runtime.answerApproval(request.payload.requestId, { decision: 'deny' })
    const result = await run

    expect(result.status).toBe('aborted')
    expect(h.faux.getPendingResponseCount()).toBe(1)
    expect(await exists(ws.path('out.txt'))).toBe(false)
    const [denied] = toolResults(h.entries)
    expect(denied?.isError).toBe(true)
    expect(text(denied!)).toMatch(/rejected/i)
    expect(h.entries.find((e) => e.kind === 'approval_decision')?.payload).toEqual({ requestId: request.payload.requestId, outcome: 'denied' })
    expect(h.entries.at(-1)).toMatchObject({ kind: 'run_end', payload: { status: 'aborted' } })
  })

  it('带反馈拒绝：反馈出现在工具结果中，Run 继续到下一次模型请求', async () => {
    const h = harness()
    let context = ''
    h.faux.setResponses([
      fauxAssistantMessage(bashWrite('b1', 'out.txt'), { stopReason: 'toolUse' }),
      (ctx) => {
        context = JSON.stringify(ctx.messages)
        return fauxAssistantMessage('ok, using another way')
      },
    ])
    const run = h.runtime.run('write it')
    const request = await h.request()
    await h.runtime.answerApproval(request.payload.requestId, { decision: 'deny', feedback: 'use notes/ instead' })
    const result = await run

    expect(result.status).toBe('completed')
    expect(await exists(ws.path('out.txt'))).toBe(false)
    expect(text(toolResults(h.entries)[0]!)).toContain('use notes/ instead')
    expect(context).toContain('use notes/ instead')
    expect(h.entries.find((e) => e.kind === 'approval_decision')?.payload).toEqual({
      requestId: request.payload.requestId,
      outcome: 'denied',
      feedback: 'use notes/ instead',
    })
  })

  it('同批两个需审批的调用按调用顺序逐个出现', async () => {
    const h = harness()
    h.faux.setResponses([
      fauxAssistantMessage([bashWrite('b1', 'one.txt'), bashWrite('b2', 'two.txt')], { stopReason: 'toolUse' }),
      fauxAssistantMessage('done'),
    ])
    const run = h.runtime.run('write both')
    const first = await h.request(1)
    expect(first.payload.toolCallId).toBe('b1')
    expect(h.runtime.pendingApprovals).toHaveLength(1)
    await h.runtime.answerApproval(first.payload.requestId, { decision: 'allow' })
    const second = await h.request(2)
    expect(second.payload.toolCallId).toBe('b2')
    await h.runtime.answerApproval(second.payload.requestId, { decision: 'allow' })
    expect((await run).status).toBe('completed')
    expect(await readFile(ws.path('one.txt'), 'utf8')).toBe('hi')
    expect(await readFile(ws.path('two.txt'), 'utf8')).toBe('hi')
  })

  it('无反馈拒绝后同批其余调用不再询问、不执行', async () => {
    const h = harness()
    h.faux.setResponses([fauxAssistantMessage([bashWrite('b1', 'one.txt'), bashWrite('b2', 'two.txt')], { stopReason: 'toolUse' })])
    const run = h.runtime.run('write both')
    await h.runtime.answerApproval((await h.request()).payload.requestId, { decision: 'deny' })
    expect((await run).status).toBe('aborted')
    expect(h.entries.filter((e) => e.kind === 'approval_request')).toHaveLength(1)
    expect(toolResults(h.entries).map((m) => [m.toolCallId, m.isError])).toEqual([
      ['b1', true],
      ['b2', true],
    ])
    expect(await exists(ws.path('two.txt'))).toBe(false)
  })

  it('等待审批时停止：请求 cancelled，调用不执行，Run aborted', async () => {
    const h = harness()
    h.faux.setResponses([fauxAssistantMessage(bashWrite('b1', 'out.txt'), { stopReason: 'toolUse' }), fauxAssistantMessage('should not be used')])
    const run = h.runtime.run('write it')
    const request = await h.request()
    h.runtime.abort()
    const result = await run

    expect(result.status).toBe('aborted')
    expect(await exists(ws.path('out.txt'))).toBe(false)
    expect(h.entries.find((e) => e.kind === 'approval_decision')?.payload).toEqual({ requestId: request.payload.requestId, outcome: 'cancelled' })
    expect(h.runtime.pendingApprovals).toEqual([])
    await expect(h.runtime.answerApproval(request.payload.requestId, { decision: 'allow' })).rejects.toBeInstanceOf(ApprovalNotPendingError)
    const order = kinds(h.entries)
    expect(order.indexOf('approval_decision')).toBeLessThan(order.indexOf('run_end'))
  })

  it('没有 permissions 选项时不经审批（库调用方自行负责）', async () => {
    const { faux, models, model } = createFauxModels()
    const runtime: AgentRuntime = createAgentRuntime({ models, model, cwd: ws.dir, commit: async () => {} })
    faux.setResponses([fauxAssistantMessage(bashWrite('b1', 'out.txt'), { stopReason: 'toolUse' }), fauxAssistantMessage('done')])
    expect((await runtime.run('write')).status).toBe('completed')
    expect(await exists(ws.path('out.txt'))).toBe(true)
  })
})
