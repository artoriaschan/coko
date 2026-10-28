// 模式或规则变更后重新判定待审批请求（permissions.md 的重新判定）：faux 模型 + 临时 Workspace，经运行时公开接口观察条目与文件。
import { access, readFile } from 'node:fs/promises'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createAgentRuntime } from '../engine/runtime.ts'
import type { RunEntry } from '../engine/types.ts'
import type { PermissionMode, PermissionRule } from '../session-entries/index.ts'
import { createFauxModels, fauxAssistantMessage, fauxToolCall } from '../testing/faux.ts'
import { createTempWorkspace, type TempWorkspace } from '../testing/workspace.ts'
import { ApprovalNotPendingError } from './broker.ts'

let ws: TempWorkspace
beforeEach(async () => {
  ws = await createTempWorkspace('coko-reevaluate-')
})
afterEach(async () => {
  await ws.dispose()
})

function harness() {
  const { faux, models, model } = createFauxModels()
  const state: { mode: PermissionMode; rules: PermissionRule[] } = { mode: 'default', rules: [] }
  const entries: RunEntry[] = []
  const waiters = new Set<() => void>()
  const runtime = createAgentRuntime({
    models,
    model,
    cwd: ws.dir,
    commit: async () => {},
    permissions: { mode: () => state.mode, rules: () => state.rules },
  })
  runtime.subscribe((event) => {
    if (event.kind !== 'entry') return
    entries.push(event.entry)
    for (const waiter of waiters) waiter()
  })
  const request = () =>
    new Promise<Extract<RunEntry, { kind: 'approval_request' }>>((resolve) => {
      const check = () => {
        const found = entries.find((e): e is Extract<RunEntry, { kind: 'approval_request' }> => e.kind === 'approval_request')
        if (!found) return
        waiters.delete(check)
        resolve(found)
      }
      waiters.add(check)
      check()
    })
  return { faux, runtime, state, entries, request }
}

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  )
const toolResults = (entries: RunEntry[]) =>
  entries.flatMap((e) => (e.kind === 'message' && e.payload.role === 'toolResult' ? [e.payload as Extract<AgentMessage, { role: 'toolResult' }>] : []))
const text = (message: { content: readonly { type: string; text?: string }[] }) => message.content.map((b) => b.text ?? '').join('')
const bashWrite = fauxToolCall('bash', { command: 'printf hi > out.txt' }, { id: 'b1' })

describe('待审批请求的重新判定', () => {
  it('切到 full-access 后重新判定 → superseded 并执行', async () => {
    const h = harness()
    h.faux.setResponses([fauxAssistantMessage(bashWrite, { stopReason: 'toolUse' }), fauxAssistantMessage('done')])
    const run = h.runtime.run('write it')
    const request = await h.request()
    h.state.mode = 'full-access'
    await h.runtime.answerApproval(request.payload.requestId, { decision: 'reevaluate' })
    expect((await run).status).toBe('completed')
    expect(await readFile(ws.path('out.txt'), 'utf8')).toBe('hi')
    expect(h.entries.filter((e) => e.kind === 'approval_decision').map((e) => e.payload)).toEqual([
      { requestId: request.payload.requestId, outcome: 'superseded' },
    ])
    await expect(h.runtime.answerApproval(request.payload.requestId, { decision: 'allow' })).rejects.toBeInstanceOf(ApprovalNotPendingError)
  })

  it('新增拒绝规则后重新判定 → superseded，调用以规则拒绝，Run 继续', async () => {
    const h = harness()
    h.faux.setResponses([fauxAssistantMessage(bashWrite, { stopReason: 'toolUse' }), fauxAssistantMessage('ok')])
    const run = h.runtime.run('write it')
    const request = await h.request()
    h.state.rules = [{ behavior: 'deny', tool: 'Bash', content: 'printf *' }]
    await h.runtime.answerApproval(request.payload.requestId, { decision: 'reevaluate' })
    expect((await run).status).toBe('completed')
    expect(await exists(ws.path('out.txt'))).toBe(false)
    const [result] = toolResults(h.entries)
    expect(result?.isError).toBe(true)
    expect(text(result!)).toBe('Permission denied by rule Bash(printf *).')
    expect(h.entries.find((e) => e.kind === 'approval_decision')?.payload).toEqual({ requestId: request.payload.requestId, outcome: 'superseded' })
  })

  it('变更后仍需询问时请求保持等待，之后仍可回答', async () => {
    const h = harness()
    h.faux.setResponses([fauxAssistantMessage(bashWrite, { stopReason: 'toolUse' }), fauxAssistantMessage('done')])
    const run = h.runtime.run('write it')
    const request = await h.request()
    h.state.mode = 'accept-edits'
    await h.runtime.answerApproval(request.payload.requestId, { decision: 'reevaluate' })
    expect(h.runtime.pendingApprovals.map((p) => p.requestId)).toEqual([request.payload.requestId])
    expect(h.entries.some((e) => e.kind === 'approval_decision')).toBe(false)
    await h.runtime.answerApproval(request.payload.requestId, { decision: 'allow' })
    expect((await run).status).toBe('completed')
  })

  it('重新判定已结束的请求报 not pending', async () => {
    const h = harness()
    await expect(h.runtime.answerApproval('missing', { decision: 'reevaluate' })).rejects.toBeInstanceOf(ApprovalNotPendingError)
  })
})
