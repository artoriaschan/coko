// 无人回答的运行（ADR 0019）：RuntimePermissions.unattended 给出时，需要审批的调用不等待，在 PermissionRequest Hook 之后立即以
// approval_decision { outcome: denied, by: headless } 结束；模型看到宿主给出的文本，Run 继续（不按无反馈的拒绝停下）。faux 模型 + 临时 Workspace。
import { access } from 'node:fs/promises'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createAgentRuntime } from '../engine/runtime.ts'
import type { RunEntry } from '../engine/types.ts'
import type { HookToolCall, HookVerdict } from '../extensions/hooks/types.ts'
import { createLocalExecPort } from '../ports/local-exec.ts'
import type { PermissionMode, SessionEntryPayloads } from '../session-entries/index.ts'
import { createFauxModels, fauxAssistantMessage, fauxToolCall } from '../testing/faux.ts'
import { createTempWorkspace, type TempWorkspace } from '../testing/workspace.ts'

const DENIED = 'Denied: no approver in this run.'

let ws: TempWorkspace
beforeEach(async () => {
  ws = await createTempWorkspace('coko-unattended-')
})
afterEach(async () => {
  await ws.dispose()
})

function harness(setup: { mode?: PermissionMode; request?: (call: HookToolCall) => HookVerdict } = {}) {
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
    },
  })
  runtime.subscribe((event) => {
    if (event.kind === 'entry') entries.push(event.entry)
  })
  return { faux, runtime, entries }
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
