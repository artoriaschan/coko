// 无人回答的运行（ADR 0019）：RuntimePermissions.unattended 给出时，需要审批的调用不等待，在 PermissionRequest Hook 之后立即以
// approval_decision { outcome: denied, by: headless } 结束；模型看到宿主给出的文本，Run 继续（不按无反馈的拒绝停下）。faux 模型 + 临时 Workspace。
import { access } from 'node:fs/promises'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createAgentRuntime } from '../engine/runtime.ts'
import type { RunEntry } from '../engine/types.ts'
import type { HookToolCall, HookVerdict } from '../extensions/hooks/types.ts'
import { createLocalExecPort } from '../ports/local-exec.ts'
import type { ApprovalReview, PermissionMode, SessionEntryPayloads } from '../session-entries/index.ts'
import { createFauxModels, fauxAssistantMessage, fauxToolCall } from '../testing/faux.ts'
import { createTempWorkspace, type TempWorkspace } from '../testing/workspace.ts'
import type { ReviewOutcome } from './gate.ts'

const DENIED = 'Denied: no approver in this run.'

let ws: TempWorkspace
beforeEach(async () => {
  ws = await createTempWorkspace('coko-unattended-')
})
afterEach(async () => {
  await ws.dispose()
})

function harness(setup: { mode?: PermissionMode; request?: (call: HookToolCall) => HookVerdict; review?: () => ReviewOutcome } = {}) {
  const review = setup.review
  let reviews = 0
  const { faux, models, model } = createFauxModels()
  const entries: RunEntry[] = []
  const runtime = createAgentRuntime({
    models,
    model,
    cwd: ws.dir,
    sessionId: 's1',
    exec: createLocalExecPort({ sandbox: { wrap: () => [], denialSignature: 'operation not permitted' } }),
    commit: async () => {},
    permissions: {
      mode: () => setup.mode ?? 'default',
      rules: () => [],
      unattended: { deniedText: DENIED },
      hooks: { preToolUse: async () => ({}), permissionRequest: async (call) => setup.request?.(call) ?? {} },
      ...(review ? { reviewer: { review: async () => (reviews++, review()) } } : {}),
    },
  })
  runtime.subscribe((event) => {
    if (event.kind === 'entry') entries.push(event.entry)
  })
  return { faux, runtime, entries, reviews: () => reviews }
}

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  )
const toolResults = (entries: RunEntry[]) =>
  entries.flatMap((e) => (e.kind === 'message' && e.payload.role === 'toolResult' ? [e.payload as Extract<AgentMessage, { role: 'toolResult' }>] : []))
const text = (message: { content: readonly { type: string; text?: string }[] }) => message.content.map((b) => b.text ?? '').join('')
const write = (id: string, path: string) => fauxToolCall('write', { path, content: 'x' }, { id })
/** auto-review 下可写根内的编辑不询问（与 accept-edits 相同），未被规则覆盖的命令才到第 7 步。 */
const bash = (id: string) => fauxToolCall('bash', { command: 'printf x > a.txt' }, { id })
const payloads = <K extends RunEntry['kind']>(entries: RunEntry[], kind: K): SessionEntryPayloads[K][] =>
  entries.filter((e) => e.kind === kind).map((e) => e.payload as SessionEntryPayloads[K])

describe('无人回答的运行：审批立即拒绝', () => {
  it('default 模式的写入：请求与 by headless 的拒绝相继提交，同批两个调用都得到宿主文本，未执行，Run 继续并 completed', async () => {
    const h = harness()
    h.faux.setResponses([fauxAssistantMessage([write('w1', 'a.txt'), write('w2', 'b.txt')], { stopReason: 'toolUse' }), fauxAssistantMessage('gave up')])
    const result = await h.runtime.run('go')
    expect(result.status).toBe('completed')
    expect(toolResults(h.entries).map((r) => [r.toolCallId, r.isError, text(r)])).toEqual([
      ['w1', true, DENIED],
      ['w2', true, DENIED],
    ])
    const requests = payloads(h.entries, 'approval_request')
    expect(requests.map((r) => r.toolCallId)).toEqual(['w1', 'w2'])
    expect(payloads(h.entries, 'approval_decision')).toEqual(requests.map((r) => ({ requestId: r.requestId, outcome: 'denied', by: 'headless' })))
    expect(h.runtime.pendingApprovals).toEqual([])
    expect(await exists(ws.path('a.txt'))).toBe(false)
    expect(await exists(ws.path('b.txt'))).toBe(false)
  })

  it('PermissionRequest Hook 的 allow 先于拒绝生效（by hook），调用执行', async () => {
    const h = harness({ request: () => ({ decision: 'allow', source: 'global' }) })
    h.faux.setResponses([fauxAssistantMessage([write('w1', 'a.txt')], { stopReason: 'toolUse' }), fauxAssistantMessage('done')])
    expect((await h.runtime.run('go')).status).toBe('completed')
    expect(payloads(h.entries, 'approval_decision')).toEqual([expect.objectContaining({ outcome: 'allowed', by: 'hook' })])
    expect(await exists(ws.path('a.txt'))).toBe(true)
  })

  it('不经 PermissionRequest 的询问（受保护路径）同样立即拒绝', async () => {
    const h = harness({ mode: 'accept-edits' })
    h.faux.setResponses([fauxAssistantMessage([write('w1', '.git/hooks/x')], { stopReason: 'toolUse' }), fauxAssistantMessage('done')])
    expect((await h.runtime.run('go')).status).toBe('completed')
    expect(text(toolResults(h.entries)[0]!)).toBe(DENIED)
    expect(payloads(h.entries, 'approval_decision')).toEqual([expect.objectContaining({ outcome: 'denied', by: 'headless' })])
  })
})

describe('无人回答的运行：自动审查（ADR 0029）', () => {
  it('Reviewer 放行：请求与 by reviewer 的允许相继提交，调用执行', async () => {
    const h = harness({ mode: 'auto-review', review: () => ({ verdict: 'allow', reason: 'asked for' }) })
    h.faux.setResponses([fauxAssistantMessage([bash('w1')], { stopReason: 'toolUse' }), fauxAssistantMessage('done')])
    expect((await h.runtime.run('go')).status).toBe('completed')
    const [request] = payloads(h.entries, 'approval_request')
    expect(request).not.toHaveProperty('review')
    expect(payloads(h.entries, 'approval_decision')).toEqual([
      { requestId: request!.requestId, outcome: 'allowed', scope: 'once', by: 'reviewer', reason: 'asked for' },
    ])
    expect(await exists(ws.path('a.txt'))).toBe(true)
  })

  const cases: [ReviewOutcome, ApprovalReview][] = [
    [
      { verdict: 'escalate', reason: 'unsure' },
      { outcome: 'escalated', reason: 'unsure' },
    ],
    ...(['timeout', 'request-failed', 'invalid-output', 'no-model', 'budget', 'too-long'] as const).map((code): [ReviewOutcome, ApprovalReview] => [
      { verdict: 'failed', code },
      { outcome: 'failed', code },
    ]),
  ]
  it.each(cases)('转交或失败（%j）：请求带 review，by headless 拒绝，模型看到宿主文本，Run 继续', async (outcome, review) => {
    const h = harness({ mode: 'auto-review', review: () => outcome })
    h.faux.setResponses([fauxAssistantMessage([bash('w1')], { stopReason: 'toolUse' }), fauxAssistantMessage('gave up')])
    expect((await h.runtime.run('go')).status).toBe('completed')
    const [request] = payloads(h.entries, 'approval_request')
    expect(request).toMatchObject({ toolCallId: 'w1', review })
    expect(payloads(h.entries, 'approval_decision')).toEqual([{ requestId: request!.requestId, outcome: 'denied', by: 'headless' }])
    expect(toolResults(h.entries).map((r) => [r.toolCallId, r.isError, text(r)])).toEqual([['w1', true, DENIED]])
    expect(await exists(ws.path('a.txt'))).toBe(false)
  })

  it('PermissionRequest Hook 给出决定时不送审；受保护路径不送审，直接以 headless 拒绝', async () => {
    const hooked = harness({
      mode: 'auto-review',
      request: () => ({ decision: 'allow', source: 'global' }),
      review: () => ({ verdict: 'escalate', reason: 'x' }),
    })
    hooked.faux.setResponses([fauxAssistantMessage([bash('w1')], { stopReason: 'toolUse' }), fauxAssistantMessage('done')])
    await hooked.runtime.run('go')
    expect(payloads(hooked.entries, 'approval_decision')).toEqual([expect.objectContaining({ outcome: 'allowed', by: 'hook' })])
    expect(hooked.reviews()).toBe(0)

    const guarded = harness({ mode: 'auto-review', review: () => ({ verdict: 'allow', reason: 'x' }) })
    guarded.faux.setResponses([fauxAssistantMessage([write('w1', '.git/hooks/x')], { stopReason: 'toolUse' }), fauxAssistantMessage('done')])
    await guarded.runtime.run('go')
    expect(payloads(guarded.entries, 'approval_request')[0]).not.toHaveProperty('review')
    expect(payloads(guarded.entries, 'approval_decision')).toEqual([expect.objectContaining({ outcome: 'denied', by: 'headless' })])
    expect(guarded.reviews()).toBe(0)
  })
})
