// 外部 Hook 在权限判定中的组合（ADR 0013）：faux 模型 + 临时 Workspace，经 createAgentRuntime 的公开接口观察条目、文件与 Hook 端口收到的调用。
// PreToolUse 与 PermissionRequest 由测试替身端口给出结论；真实 Hook 进程见 tests/integration/sidecar-hooks.test.ts。
import { access, readFile } from 'node:fs/promises'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createAgentRuntime } from '../engine/runtime.ts'
import type { RunEntry } from '../engine/types.ts'
import type { HookToolCall, HookVerdict } from '../extensions/hooks/types.ts'
import { createLocalExecPort } from '../ports/local-exec.ts'
import type { PermissionMode, PermissionRule } from '../session-entries/index.ts'
import { createFauxModels, fauxAssistantMessage, fauxToolCall } from '../testing/faux.ts'
import { createTempWorkspace, type TempWorkspace } from '../testing/workspace.ts'

let ws: TempWorkspace
beforeEach(async () => {
  ws = await createTempWorkspace('coko-hookgate-')
})
afterEach(async () => {
  await ws.dispose()
})

interface Setup {
  mode?: PermissionMode
  rules?: PermissionRule[]
  pre?: (call: HookToolCall) => HookVerdict
  request?: (call: HookToolCall) => HookVerdict
}

function harness(setup: Setup) {
  const { faux, models, model } = createFauxModels()
  const entries: RunEntry[] = []
  const waiters = new Set<() => void>()
  const calls: { pre: HookToolCall[]; request: HookToolCall[] } = { pre: [], request: [] }
  const state = { mode: setup.mode ?? 'default' }
  const runtime = createAgentRuntime({
    models,
    model,
    cwd: ws.dir,
    sessionId: 's1',
    exec: createLocalExecPort({ sandbox: { wrap: () => [], denialSignature: 'operation not permitted' } }),
    commit: async () => {},
    permissions: {
      mode: () => state.mode,
      rules: () => setup.rules ?? [],
      hooks: {
        preToolUse: async (call) => (calls.pre.push(call), setup.pre?.(call) ?? {}),
        permissionRequest: async (call) => (calls.request.push(call), setup.request?.(call) ?? {}),
      },
    },
  })
  runtime.subscribe((event) => {
    if (event.kind !== 'entry') return
    entries.push(event.entry)
    for (const waiter of waiters) waiter()
  })
  const approval = () =>
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
  return { faux, runtime, entries, calls, state, approval }
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
const script = (h: ReturnType<typeof harness>, ...calls: ReturnType<typeof fauxToolCall>[]) =>
  h.faux.setResponses([fauxAssistantMessage(calls, { stopReason: 'toolUse' }), fauxAssistantMessage('done')])
const bash = (id: string, command: string) => fauxToolCall('bash', { command }, { id })
const write = (id: string, path: string) => fauxToolCall('write', { path, content: 'x' }, { id })
const deny: HookVerdict = { decision: 'deny', reason: 'no rm here', source: 'global', hookId: 'global:PreToolUse:0:0', command: 'guard.sh' }

describe('PreToolUse 与判定的组合', () => {
  it('Hook deny 在 full-access 下拒绝：模型看到原因，结果带 hostBlock，未执行，Run 继续', async () => {
    const h = harness({ mode: 'full-access', pre: () => deny })
    script(h, bash('b1', 'printf hi > out.txt'))
    const result = await h.runtime.run('go')
    expect(result.status).toBe('completed')
    const [blocked] = toolResults(h.entries)
    expect([blocked!.isError, text(blocked!), blocked!.details]).toEqual([
      true,
      'Blocked by hook: no rm here',
      { hostBlock: { by: 'hook', hookId: 'global:PreToolUse:0:0', command: 'guard.sh' } },
    ])
    expect(await exists(ws.path('out.txt'))).toBe(false)
    expect(kinds(h.entries)).toEqual(['run_start', 'user', 'assistant', 'toolResult', 'assistant', 'run_end'])
  })

  it('Hook deny 优先于规则拒绝；Hook 端口收到注册名、规则组名、参数与模式', async () => {
    const h = harness({ rules: [{ behavior: 'deny', tool: 'Bash', content: 'rm *' }], pre: () => deny })
    script(h, bash('b1', 'rm x'))
    await h.runtime.run('go')
    expect(text(toolResults(h.entries)[0]!)).toBe('Blocked by hook: no rm here')
    expect(h.calls.pre.map(({ toolCallId, toolName, ruleTool, input, permissionMode }) => ({ toolCallId, toolName, ruleTool, input, permissionMode }))).toEqual(
      [{ toolCallId: 'b1', toolName: 'bash', ruleTool: 'Bash', input: { command: 'rm x' }, permissionMode: 'default' }],
    )
  })

  it('if 匹配器：Bash(rm *) 命中 echo ok && rm x 的子命令，Bash(git *) 不命中', async () => {
    const h = harness({ mode: 'full-access' })
    script(h, bash('b1', 'echo ok && rm -f x'))
    await h.runtime.run('go')
    const call = h.calls.pre[0]!
    expect(call.matchesRule!({ tool: 'Bash', content: 'rm *' })).toBe(true)
    expect(call.matchesRule!({ tool: 'Bash', content: 'git *' })).toBe(false)
    expect(call.matchesRule!({ tool: 'Edit' })).toBe(false)
  })

  it('Hook allow 免掉第 7 步的询问（与允许规则同位）；PermissionRequest 不运行', async () => {
    const h = harness({ pre: () => ({ decision: 'allow', source: 'global' }) })
    script(h, bash('b1', 'printf hi > out.txt'))
    await h.runtime.run('go')
    expect(await readFile(ws.path('out.txt'), 'utf8')).toBe('hi')
    expect(kinds(h.entries)).not.toContain('approval_request')
    expect(h.calls.request).toEqual([])
  })

  const cases: [string, Setup, () => ReturnType<typeof fauxToolCall>][] = [
    ['询问规则', { rules: [{ behavior: 'ask', tool: 'Bash', content: 'printf *' }] }, () => bash('b1', 'printf hi > out.txt')],
    ['.git/config 写入（受保护路径）', { mode: 'full-access' }, () => write('w1', '.git/config')],
    // 系统临时目录是 accept-edits 的可写根：用一个不存在的系统目录（被拒绝，不会写入）。
    ['越出可写根', { mode: 'accept-edits' }, () => write('w1', '/usr/coko-hook-gate-never/x.txt')],
  ]
  it.each(cases)('对手用例：Hook allow 不免掉%s', async (_name, setup, call) => {
    const h = harness({ ...setup, pre: () => ({ decision: 'allow', source: 'global' }) })
    script(h, call())
    const run = h.runtime.run('go')
    const asked = await h.approval()
    expect(asked.payload.suggestions).toEqual([])
    expect(h.calls.request).toEqual([])
    await h.runtime.answerApproval(asked.payload.requestId, { decision: 'deny', feedback: 'no' })
    await run
  })

  it('Hook ask 在 full-access 下出审批卡且没有建议规则；等待中切换模式不使询问消失', async () => {
    const h = harness({ mode: 'full-access', pre: () => ({ decision: 'ask', reason: 'check', source: 'global' }) })
    script(h, bash('b1', 'printf hi > out.txt'))
    const run = h.runtime.run('go')
    const asked = await h.approval()
    expect(asked.payload).toMatchObject({ toolCallId: 'b1', kind: 'tool', suggestions: [] })
    h.state.mode = 'full-access'
    await h.runtime.answerApproval(asked.payload.requestId, { decision: 'reevaluate' })
    expect(h.runtime.pendingApprovals.map((p) => p.requestId)).toEqual([asked.payload.requestId])
    await h.runtime.answerApproval(asked.payload.requestId, { decision: 'allow' })
    await run
    expect(await readFile(ws.path('out.txt'), 'utf8')).toBe('hi')
    expect(h.calls.request).toEqual([])
  })

  it('Hook ask 等待中增加拒绝规则：重新判定以规则拒绝结束', async () => {
    const rules: PermissionRule[] = []
    const h = harness({ rules, pre: () => ({ decision: 'ask', source: 'global' }) })
    script(h, bash('b1', 'printf hi > out.txt'))
    const run = h.runtime.run('go')
    const asked = await h.approval()
    rules.push({ behavior: 'deny', tool: 'Bash' })
    await h.runtime.answerApproval(asked.payload.requestId, { decision: 'reevaluate' })
    await run
    expect(text(toolResults(h.entries)[0]!)).toBe('Permission denied by rule Bash.')
  })
})

describe('PermissionRequest', () => {
  it('allow：不出卡片，提交 approval_request 与 approval_decision { by: hook } 后执行', async () => {
    const h = harness({ request: () => ({ decision: 'allow', source: 'global' }) })
    script(h, bash('b1', 'printf hi > out.txt'))
    const result = await h.runtime.run('go')
    expect(await readFile(ws.path('out.txt'), 'utf8')).toBe('hi')
    const request = h.entries.find((e) => e.kind === 'approval_request')!
    expect(request.payload).toMatchObject({ toolCallId: 'b1', kind: 'tool', subject: 'printf hi > out.txt' })
    expect(h.entries.find((e) => e.kind === 'approval_decision')).toEqual({
      kind: 'approval_decision',
      runId: result.runId,
      payload: { requestId: (request.payload as { requestId: string }).requestId, outcome: 'allowed', scope: 'once', by: 'hook' },
    })
    expect(h.runtime.pendingApprovals).toEqual([])
  })

  it('deny：拒绝，结果带 hostBlock，未执行', async () => {
    const h = harness({ request: () => ({ ...deny, reason: 'not now' }) })
    script(h, bash('b1', 'printf hi > out.txt'))
    await h.runtime.run('go')
    expect(text(toolResults(h.entries)[0]!)).toBe('Blocked by hook: not now')
    expect(await exists(ws.path('out.txt'))).toBe(false)
    expect(kinds(h.entries)).not.toContain('approval_request')
  })

  it('没有决定：出卡片（保留建议规则）', async () => {
    const h = harness({})
    script(h, bash('b1', 'printf hi > out.txt'))
    const run = h.runtime.run('go')
    const asked = await h.approval()
    expect(asked.payload.suggestions).toEqual([{ behavior: 'allow', tool: 'Bash', content: 'printf hi > out.txt' }])
    expect(h.calls.request.map((c) => c.toolCallId)).toEqual(['b1'])
    await h.runtime.answerApproval(asked.payload.requestId, { decision: 'deny', feedback: 'no' })
    await run
  })

  it('对手用例：询问来自询问规则或 Hook 的 ask 时不运行 PermissionRequest（其 allow 不能解决）', async () => {
    const h = harness({ rules: [{ behavior: 'ask', tool: 'Bash' }], request: () => ({ decision: 'allow', source: 'global' }) })
    script(h, bash('b1', 'printf hi > out.txt'))
    const run = h.runtime.run('go')
    const asked = await h.approval()
    expect(h.calls.request).toEqual([])
    await h.runtime.answerApproval(asked.payload.requestId, { decision: 'deny', feedback: 'no' })
    await run
    expect(await exists(ws.path('out.txt'))).toBe(false)
  })
})
