// 运行时上的沙箱与提权（ADR 0005）与 Secrets 注入：faux 模型 + 临时 Workspace + 记录请求的执行端口，
// 经 createAgentRuntime 的公开接口观察条目、交给执行端口的沙箱策略与工具收到的执行上下文。
import { realpath } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { Type } from 'typebox'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createAgentRuntime } from '../engine/runtime.ts'
import type { RunEntry } from '../engine/types.ts'
import type { ExecOutcome, ExecPort, ExecRequest } from '../ports/exec.ts'
import type { SecretProvider } from '../ports/secrets.ts'
import type { PermissionMode, PermissionRule } from '../session-entries/index.ts'
import { createFauxModels, fauxAssistantMessage, fauxToolCall } from '../testing/faux.ts'
import { createTempWorkspace, type TempWorkspace } from '../testing/workspace.ts'
import { createBuiltinToolRegistry } from '../tools/builtin/index.ts'
import type { CokoTool } from '../tools/types.ts'

let ws: TempWorkspace
beforeEach(async () => {
  ws = await createTempWorkspace('coko-escalation-')
})
afterEach(async () => {
  await ws.dispose()
})

function recordingExec(respond: (request: ExecRequest) => ExecOutcome = () => ({ kind: 'exited', exitCode: 0 })) {
  const requests: ExecRequest[] = []
  const port: ExecPort = {
    async exec(request) {
      requests.push(request)
      request.onData(Buffer.from('out\n'))
      return respond(request)
    },
  }
  return { requests, port }
}

function harness(
  options: { mode?: PermissionMode; planning?: boolean; rules?: PermissionRule[]; exec?: ExecPort; tools?: CokoTool[]; secrets?: SecretProvider } = {},
) {
  const { faux, models, model } = createFauxModels()
  const state = { mode: options.mode ?? 'default', rules: options.rules ?? [], planning: options.planning ?? false }
  const entries: RunEntry[] = []
  const waiters = new Set<() => void>()
  const exec = options.exec ?? recordingExec().port
  const registry = createBuiltinToolRegistry({ cwd: ws.dir, exec })
  for (const tool of options.tools ?? []) registry.register(tool)
  const runtime = createAgentRuntime({
    models,
    model,
    cwd: ws.dir,
    sessionId: 's1',
    tools: registry,
    commit: async () => {},
    ...(options.tools ? {} : { permissions: { mode: () => state.mode, rules: () => state.rules, planning: () => state.planning } }),
    ...(options.secrets ? { secrets: options.secrets } : {}),
  })
  runtime.subscribe((event) => {
    if (event.kind !== 'entry') return
    entries.push(event.entry)
    for (const waiter of waiters) waiter()
  })
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
  return { faux, runtime, entries, request, state }
}

const toolResults = (entries: RunEntry[]) =>
  entries.flatMap((e) => (e.kind === 'message' && e.payload.role === 'toolResult' ? [e.payload as Extract<AgentMessage, { role: 'toolResult' }>] : []))
const text = (message: { content: readonly { type: string; text?: string }[] }) => message.content.map((b) => b.text ?? '').join('')
const bash = (id: string, args: Record<string, unknown>) => fauxToolCall('bash', { command: 'echo x > /elsewhere/f', ...args }, { id })
const allowBash: PermissionRule = { behavior: 'allow', tool: 'Bash' }
/** workspace-write 下被沙箱拒绝、更宽档位成功：提权只用于重试被拒绝过的同一命令（ADR 0005）。 */
const deniedUnderWorkspaceWrite = () =>
  recordingExec((request) =>
    request.sandbox?.mode === 'workspace-write' ? { kind: 'exited', exitCode: 1, sandboxDenied: true } : { kind: 'exited', exitCode: 0 },
  )

describe('命令的沙箱档位', () => {
  it.each([
    ['read-only', 'read-only'],
    ['default', 'workspace-write'],
    ['accept-edits', 'workspace-write'],
    ['full-access', 'danger-full-access'],
  ] as const)('%s 模式下命令以 %s 运行（执行时的模式）', async (mode, sandbox) => {
    const exec = recordingExec()
    const h = harness({ mode, rules: [allowBash], exec: exec.port })
    h.faux.setResponses([fauxAssistantMessage(bash('b1', {}), { stopReason: 'toolUse' }), fauxAssistantMessage('done')])
    await h.runtime.run('go')
    expect(exec.requests.map((r) => r.sandbox?.mode)).toEqual([sandbox])
    // 规格的可写根：Workspace、/tmp 与 os.tmpdir() 的真实路径；不含主目录（~/.npm、~/.cache 不默认可写）。
    const workspaceWrite = [...new Set([await realpath(ws.dir), await realpath('/tmp'), await realpath(tmpdir())])]
    const expected = { 'read-only': [], 'workspace-write': workspaceWrite, 'danger-full-access': ['/'] }[sandbox]
    expect([...exec.requests[0]!.sandbox!.writableRoots].sort()).toEqual([...expected].sort())
    expect(exec.requests[0]!.sandbox!.writableRoots).not.toContain(homedir())
  })
})

describe('单次提权', () => {
  it('被沙箱拒绝后以更宽档位重试 → kind=escalation 的请求（目标档位、理由、无建议规则），允许规则也不能免掉；批准一次只对该调用有效', async () => {
    const exec = deniedUnderWorkspaceWrite()
    const h = harness({ rules: [allowBash], exec: exec.port })
    h.faux.setResponses([
      fauxAssistantMessage(bash('p0', {}), { stopReason: 'toolUse' }),
      fauxAssistantMessage(bash('b1', { sandbox_permissions: 'danger-full-access', justification: 'needs ~/.npm' }), { stopReason: 'toolUse' }),
      fauxAssistantMessage(bash('b2', {}), { stopReason: 'toolUse' }),
      fauxAssistantMessage('done'),
    ])
    const run = h.runtime.run('go')
    const request = await h.request()
    expect(request.payload).toEqual({
      requestId: expect.any(String),
      toolCallId: 'b1',
      toolName: 'bash',
      kind: 'escalation',
      subject: 'echo x > /elsewhere/f',
      targetMode: 'danger-full-access',
      justification: 'needs ~/.npm',
      suggestions: [],
    })
    expect(exec.requests).toHaveLength(1)
    // 提权请求不随模式或规则变更重新判定。
    await h.runtime.answerApproval(request.payload.requestId, { decision: 'reevaluate' })
    expect(h.runtime.pendingApprovals).toHaveLength(1)
    await h.runtime.answerApproval(request.payload.requestId, { decision: 'allow' })
    expect((await run).status).toBe('completed')
    expect(exec.requests.map((r) => r.sandbox?.mode)).toEqual(['workspace-write', 'danger-full-access', 'workspace-write'])
    expect(h.entries.filter((e) => e.kind === 'approval_request')).toHaveLength(1)
  })

  it('等于当前档位不提权：按普通判定（询问一次，kind=tool）并以当前档位运行', async () => {
    const exec = recordingExec()
    const h = harness({ exec: exec.port })
    h.faux.setResponses([fauxAssistantMessage(bash('b1', { sandbox_permissions: 'workspace-write' }), { stopReason: 'toolUse' }), fauxAssistantMessage('done')])
    const run = h.runtime.run('go')
    const request = await h.request()
    expect(request.payload.kind).toBe('tool')
    await h.runtime.answerApproval(request.payload.requestId, { decision: 'allow' })
    await run
    expect(exec.requests.map((r) => r.sandbox?.mode)).toEqual(['workspace-write'])
  })

  it('参数错误（只给理由、更窄）→ 工具错误，不询问也不执行，Run 继续', async () => {
    const exec = recordingExec()
    const h = harness({ mode: 'full-access', exec: exec.port })
    h.faux.setResponses([
      fauxAssistantMessage([bash('b1', { justification: 'just because' }), bash('b2', { sandbox_permissions: 'workspace-write', justification: 'narrow' })], {
        stopReason: 'toolUse',
      }),
      fauxAssistantMessage('done'),
    ])
    expect((await h.runtime.run('go')).status).toBe('completed')
    const [first, second] = toolResults(h.entries)
    expect(first).toMatchObject({ toolCallId: 'b1', isError: true })
    expect(text(first!)).toContain('justification is only valid together with sandbox_permissions')
    expect(text(second!)).toContain('not strictly wider than this call\'s current "danger-full-access" mode')
    expect(h.entries.some((e) => e.kind === 'approval_request')).toBe(false)
    expect(exec.requests).toHaveLength(0)
  })

  it('拒绝规则先于提权：直接拒绝，不询问', async () => {
    const exec = recordingExec()
    const h = harness({ rules: [{ behavior: 'deny', tool: 'Bash', content: 'echo *' }], exec: exec.port })
    h.faux.setResponses([
      fauxAssistantMessage(bash('b1', { sandbox_permissions: 'danger-full-access', justification: 'x' }), { stopReason: 'toolUse' }),
      fauxAssistantMessage('done'),
    ])
    await h.runtime.run('go')
    expect(text(toolResults(h.entries)[0]!)).toContain('Permission denied by rule Bash(echo *)')
    expect(h.entries.some((e) => e.kind === 'approval_request')).toBe(false)
  })

  it('无反馈拒绝提权 → 错误文本要求停止并说明，命令不执行，Run 以 aborted 结束', async () => {
    const exec = deniedUnderWorkspaceWrite()
    const h = harness({ rules: [allowBash], exec: exec.port })
    h.faux.setResponses([
      fauxAssistantMessage(bash('p0', {}), { stopReason: 'toolUse' }),
      fauxAssistantMessage(bash('b1', { sandbox_permissions: 'danger-full-access', justification: 'x' }), { stopReason: 'toolUse' }),
      fauxAssistantMessage('should not be used'),
    ])
    const run = h.runtime.run('go')
    const request = await h.request()
    await h.runtime.answerApproval(request.payload.requestId, { decision: 'deny' })
    expect((await run).status).toBe('aborted')
    expect(text(toolResults(h.entries).find((r) => r.toolCallId === 'b1')!)).toBe(
      'The user rejected escalating this command to "danger-full-access"; it stays denied, so stop and explain instead of working around it.',
    )
    expect(exec.requests.map((r) => r.sandbox?.mode)).toEqual(['workspace-write'])
  })
})

describe('规划中（计划阶段，ADR 0028）', () => {
  const PLANNING_WRITE_REFUSED =
    'Refused: plan mode is active, so file writes are blocked until the user approves a plan. Do not retry or work around this; describe the intended change in the plan (or in your report to the parent agent) instead.'
  const PLANNING_ESCALATION_REFUSED =
    'invalid escalation: plan mode is active, so commands run in a read-only sandbox and cannot be escalated. Do not retry; describe the step that needs write access in the plan instead.'

  it('文件写入直接拒绝（T3）：不询问，文件不存在；允许规则与 full-access 都不能放行', async () => {
    const h = harness({ mode: 'full-access', planning: true, rules: [{ behavior: 'allow', tool: 'Edit' }] })
    h.faux.setResponses([
      fauxAssistantMessage([fauxToolCall('write', { path: 'new.txt', content: 'x' }, { id: 'w1' })], { stopReason: 'toolUse' }),
      fauxAssistantMessage('done'),
    ])
    expect((await h.runtime.run('go')).status).toBe('completed')
    const [result] = toolResults(h.entries)
    expect(result).toMatchObject({ toolCallId: 'w1', isError: true })
    expect(text(result!)).toBe(PLANNING_WRITE_REFUSED)
    expect(h.entries.some((e) => e.kind === 'approval_request')).toBe(false)
    await expect(realpath(ws.path('new.txt'))).rejects.toThrow(/ENOENT/)
  })

  it.each(['default', 'accept-edits', 'full-access'] as const)('%s 模式下命令以 read-only 沙箱运行，可写根为空', async (mode) => {
    const exec = recordingExec()
    const h = harness({ mode, planning: true, rules: [allowBash], exec: exec.port })
    h.faux.setResponses([fauxAssistantMessage(bash('b1', {}), { stopReason: 'toolUse' }), fauxAssistantMessage('done')])
    await h.runtime.run('go')
    expect(exec.requests.map((r) => r.sandbox)).toEqual([{ mode: 'read-only', writableRoots: [], escalation: false }])
  })

  it('被只读沙箱拒绝的命令：拒绝标记之后是 T5，不给提权提示', async () => {
    const exec = recordingExec(() => ({ kind: 'exited', exitCode: 1, sandboxDenied: true }))
    const h = harness({ planning: true, rules: [allowBash], exec: exec.port })
    h.faux.setResponses([fauxAssistantMessage(bash('b1', {}), { stopReason: 'toolUse' }), fauxAssistantMessage('done')])
    await h.runtime.run('go')
    const output = text(toolResults(h.entries)[0]!)
    expect(output).toContain(
      '[sandbox: file access denied under read-only mode]\n[sandbox: escalation is not available in plan mode]\nCommand exited with code 1',
    )
    expect(output).not.toContain('escalation available')
  })

  it('带提权参数的命令直接出错（T4），不询问也不执行，即使本 Run 被沙箱拒绝过；参数错误仍按原文本', async () => {
    const exec = recordingExec(() => ({ kind: 'exited', exitCode: 1, sandboxDenied: true }))
    const h = harness({ mode: 'full-access', planning: true, exec: exec.port })
    h.faux.setResponses([
      fauxAssistantMessage(bash('p0', {}), { stopReason: 'toolUse' }),
      fauxAssistantMessage([bash('b1', { sandbox_permissions: 'workspace-write', justification: 'build' }), bash('b2', { justification: 'only a reason' })], {
        stopReason: 'toolUse',
      }),
      fauxAssistantMessage('done'),
    ])
    expect((await h.runtime.run('go')).status).toBe('completed')
    const results = toolResults(h.entries)
    expect(text(results.find((r) => r.toolCallId === 'b1')!)).toBe(PLANNING_ESCALATION_REFUSED)
    expect(text(results.find((r) => r.toolCallId === 'b2')!)).toContain('justification is only valid together with sandbox_permissions')
    expect(h.entries.some((e) => e.kind === 'approval_request')).toBe(false)
    expect(exec.requests.map((r) => r.sandbox?.mode)).toEqual(['read-only'])
  })

  it('不在规划中时提权照常询问（行为不变）', async () => {
    const exec = deniedUnderWorkspaceWrite()
    const h = harness({ rules: [allowBash], exec: exec.port })
    h.faux.setResponses([
      fauxAssistantMessage(bash('p0', {}), { stopReason: 'toolUse' }),
      fauxAssistantMessage(bash('b1', { sandbox_permissions: 'danger-full-access', justification: 'x' }), { stopReason: 'toolUse' }),
      fauxAssistantMessage('done'),
    ])
    const run = h.runtime.run('go')
    expect((await h.request()).payload.kind).toBe('escalation')
    await h.runtime.answerApproval((await h.request()).payload.requestId, { decision: 'allow' })
    await run
  })

  it('等待审批的写入在进入规划后重新判定：以 superseded 结束，模型收到 T3，文件不存在', async () => {
    const h = harness()
    h.faux.setResponses([
      fauxAssistantMessage([fauxToolCall('write', { path: 'pending.txt', content: 'x' }, { id: 'w1' })], { stopReason: 'toolUse' }),
      fauxAssistantMessage('done'),
    ])
    const run = h.runtime.run('go')
    const request = await h.request()
    h.state.planning = true
    await h.runtime.answerApproval(request.payload.requestId, { decision: 'reevaluate' })
    expect((await run).status).toBe('completed')
    expect(text(toolResults(h.entries)[0]!)).toBe(PLANNING_WRITE_REFUSED)
    expect(h.entries.filter((e) => e.kind === 'approval_decision').map((e) => (e.payload as { outcome: string }).outcome)).toEqual(['superseded'])
    await expect(realpath(ws.path('pending.txt'))).rejects.toThrow(/ENOENT/)
  })

  it('Run 中途进入规划：下一次调用即按规划判定与执行', async () => {
    let enter = () => {}
    const exec = recordingExec(() => (enter(), { kind: 'exited', exitCode: 0 }))
    const h = harness({ rules: [allowBash], exec: exec.port })
    // 第一条命令执行时进入规划（与 Run 进行中经接口进入相同：判定与沙箱每次调用现取）。
    enter = () => void (h.state.planning = true)
    h.faux.setResponses([
      fauxAssistantMessage(bash('b0', {}), { stopReason: 'toolUse' }),
      fauxAssistantMessage(bash('b1', {}), { stopReason: 'toolUse' }),
      fauxAssistantMessage('done'),
    ])
    await h.runtime.run('go')
    expect(exec.requests.map((r) => r.sandbox?.mode)).toEqual(['workspace-write', 'read-only'])
  })
})

describe('Secrets 注入', () => {
  const tool = (name: string, seen: unknown[], secrets?: string[]): CokoTool => ({
    name,
    label: name,
    description: name,
    parameters: Type.Object({}),
    effect: 'read',
    ...(secrets ? { secrets } : {}),
    async execute(_id, _params, _signal, _onUpdate, context) {
      seen.push(context?.secrets)
      return { content: [{ type: 'text', text: 'ok' }], details: undefined }
    },
  })
  const provider: SecretProvider = { get: (name) => ({ A_SECRET: 'a-value', OTHER: 'other-value' })[name] }

  it('只把工具声明的密钥交给该次调用；未声明的工具拿不到；缺失的密钥使调用失败且不执行', async () => {
    const seen: unknown[] = []
    const plain: unknown[] = []
    const missing: unknown[] = []
    const h = harness({ tools: [tool('probe', seen, ['A_SECRET']), tool('plain', plain), tool('needy', missing, ['NOPE'])], secrets: provider })
    h.faux.setResponses([
      fauxAssistantMessage([fauxToolCall('probe', {}, { id: 'p1' }), fauxToolCall('plain', {}, { id: 'p2' }), fauxToolCall('needy', {}, { id: 'p3' })], {
        stopReason: 'toolUse',
      }),
      fauxAssistantMessage('done'),
    ])
    await h.runtime.run('go')
    expect(seen).toEqual([{ A_SECRET: 'a-value' }])
    expect(plain).toEqual([undefined])
    expect(missing).toEqual([])
    const needy = toolResults(h.entries).find((r) => r.toolCallId === 'p3')!
    expect(needy.isError).toBe(true)
    expect(text(needy)).toContain('Missing secret NOPE declared by tool needy')
    // 密钥值不进入任何条目。
    expect(JSON.stringify(h.entries)).not.toContain('a-value')
  })
})
