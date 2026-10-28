// 执行前的检查（ADR 0005）：取得执行槽之后、执行记录之前，按执行时的事实复核。faux 模型 + 临时 Workspace，经运行时公开接口观察
// 条目、文件与工具结果。覆盖读取拒绝过滤、写入目标复核、Secrets 预检、提权须先被沙箱拒绝、暂停与规则拒绝、重新判定后的新建议。
import { access, readFile, realpath, symlink } from 'node:fs/promises'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { Type } from 'typebox'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createAgentRuntime } from '../engine/runtime.ts'
import type { RunEntry } from '../engine/types.ts'
import type { ExecOutcome, ExecPort, ExecRequest } from '../ports/exec.ts'
import type { PermissionMode, PermissionRule } from '../session-entries/index.ts'
import { createFauxModels, fauxAssistantMessage, fauxToolCall } from '../testing/faux.ts'
import { createTempWorkspace, type TempWorkspace } from '../testing/workspace.ts'
import { createBuiltinToolRegistry } from '../tools/builtin/index.ts'
import type { CokoTool } from '../tools/types.ts'

let ws: TempWorkspace
let outside: TempWorkspace
beforeEach(async () => {
  ws = await createTempWorkspace('coko-checks-')
  outside = await createTempWorkspace('coko-checks-out-')
})
afterEach(async () => {
  await ws.dispose()
  await outside.dispose()
})

/** 执行端口替身：按 respond 决定结果，记录请求；默认什么都不做并以 0 退出。 */
function fakeExec(respond: (request: ExecRequest) => ExecOutcome | Promise<ExecOutcome> = () => ({ kind: 'exited', exitCode: 0 })) {
  const requests: ExecRequest[] = []
  const port: ExecPort = {
    async exec(request) {
      requests.push(request)
      return respond(request)
    },
  }
  return { requests, port }
}

function harness(options: { mode?: PermissionMode; rules?: PermissionRule[]; exec?: ExecPort; tools?: CokoTool[] } = {}) {
  const { faux, models, model } = createFauxModels()
  const state = { mode: options.mode ?? 'default', rules: options.rules ?? [] }
  const entries: RunEntry[] = []
  const waiters = new Set<() => void>()
  const registry = createBuiltinToolRegistry({ cwd: ws.dir, exec: options.exec ?? fakeExec().port })
  for (const tool of options.tools ?? []) registry.register(tool)
  const runtime = createAgentRuntime({
    models,
    model,
    cwd: ws.dir,
    sessionId: 's1',
    tools: registry,
    commit: async () => {},
    permissions: { mode: () => state.mode, rules: () => state.rules },
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

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  )
const toolResults = (entries: RunEntry[]) =>
  entries.flatMap((e) => (e.kind === 'message' && e.payload.role === 'toolResult' ? [e.payload as Extract<AgentMessage, { role: 'toolResult' }>] : []))
const text = (message: { content: readonly { type: string; text?: string }[] }) => message.content.map((b) => b.text ?? '').join('')
const resultOf = (entries: RunEntry[], id: string) => toolResults(entries).find((r) => r.toolCallId === id)!
const turn = (calls: ReturnType<typeof fauxToolCall>[]) => fauxAssistantMessage(calls, { stopReason: 'toolUse' })

describe('读取拒绝规则作用于目录工具', () => {
  it('grep 的搜索根是 Workspace 时，Read 拒绝规则覆盖的文件不出现在结果中', async () => {
    await ws.write('src/secret.txt', 'needle: the secret\n')
    await ws.write('src/open.txt', 'needle: open\n')
    const h = harness({ rules: [{ behavior: 'deny', tool: 'Read', content: 'src/secret.txt' }] })
    h.faux.setResponses([turn([fauxToolCall('grep', { pattern: 'needle' }, { id: 'g1' })]), fauxAssistantMessage('done')])
    await h.runtime.run('search')
    const result = text(resultOf(h.entries, 'g1'))
    expect(result).toContain('src/open.txt:1: needle: open')
    expect(result).not.toContain('the secret')
    expect(result).toContain('1 path omitted: denied by permission rules')
  })
})

describe('写入目标在判定之后被替换', () => {
  it('同一批中先建指向受保护文件的链接、再 write：执行前重新判定并询问；拒绝后外部文件不变', async () => {
    const target = await realpath(outside.dir).then((dir) => `${dir}/.zshrc`)
    // 替身执行端口代替 bash 建链接（与真实命令的效果相同）。
    const exec = fakeExec(async () => {
      await symlink(target, ws.path('notes.txt'))
      return { kind: 'exited', exitCode: 0 }
    })
    const h = harness({ mode: 'full-access', exec: exec.port })
    h.faux.setResponses([
      turn([
        fauxToolCall('bash', { command: 'ln -s ~/.zshrc notes.txt' }, { id: 'b1' }),
        fauxToolCall('write', { path: 'notes.txt', content: 'pwned' }, { id: 'w1' }),
      ]),
      fauxAssistantMessage('should not be used'),
    ])
    const run = h.runtime.run('go')
    const request = await h.request()
    expect(request.payload).toMatchObject({ toolCallId: 'w1', toolName: 'write', kind: 'tool', subject: 'notes.txt', suggestions: [] })
    expect(await exists(target)).toBe(false)
    await h.runtime.answerApproval(request.payload.requestId, { decision: 'deny' })
    expect((await run).status).toBe('aborted')
    expect(resultOf(h.entries, 'w1').isError).toBe(true)
    expect(await exists(target)).toBe(false)
    // 执行记录只在复核通过之后提交：被拒绝的 write 没有 tool_exec。
    expect(h.entries.filter((e) => e.kind === 'tool_exec').map((e) => e.payload.toolCallId)).toEqual(['b1'])
  })

  it('目标没有变化时不再询问', async () => {
    const h = harness({ mode: 'accept-edits' })
    h.faux.setResponses([turn([fauxToolCall('write', { path: 'a.txt', content: 'a' }, { id: 'w1' })]), fauxAssistantMessage('done')])
    expect((await h.runtime.run('go')).status).toBe('completed')
    expect(await readFile(ws.path('a.txt'), 'utf8')).toBe('a')
    expect(h.entries.some((e) => e.kind === 'approval_request')).toBe(false)
  })
})

describe('Secrets 预检', () => {
  it('声明了缺失密钥的 side-effect 工具：不提交 tool_exec，调用以缺失密钥失败', async () => {
    let ran = false
    const needy: CokoTool = {
      name: 'needy',
      label: 'needy',
      description: 'needy',
      parameters: Type.Object({}),
      effect: 'side-effect',
      secrets: ['NOPE'],
      async execute() {
        ran = true
        return { content: [{ type: 'text', text: 'ran' }], details: undefined }
      },
    }
    const h = harness({ mode: 'full-access', tools: [needy] })
    h.faux.setResponses([turn([fauxToolCall('needy', {}, { id: 'n1' })]), fauxAssistantMessage('done')])
    await h.runtime.run('go')
    expect(ran).toBe(false)
    expect(text(resultOf(h.entries, 'n1'))).toContain('Missing secret NOPE declared by tool needy')
    expect(h.entries.some((e) => e.kind === 'tool_exec')).toBe(false)
  })
})

describe('提权须先被沙箱拒绝', () => {
  const escalated = { sandbox_permissions: 'danger-full-access', justification: 'needs it' }
  it('同一命令没有被沙箱拒绝过：参数错误，不询问也不执行；被拒绝之后同一命令带提权参数才弹提权卡', async () => {
    const exec = fakeExec((request) =>
      request.sandbox?.mode === 'workspace-write' ? { kind: 'exited', exitCode: 1, sandboxDenied: true } : { kind: 'exited', exitCode: 0 },
    )
    const h = harness({ rules: [{ behavior: 'allow', tool: 'Bash' }], exec: exec.port })
    h.faux.setResponses([
      turn([fauxToolCall('bash', { command: 'touch /elsewhere/f', ...escalated }, { id: 'e0' })]),
      turn([fauxToolCall('bash', { command: 'touch /elsewhere/f' }, { id: 'p1' })]),
      turn([fauxToolCall('bash', { command: 'touch  /elsewhere/f', ...escalated }, { id: 'e1' })]),
      fauxAssistantMessage('done'),
    ])
    const run = h.runtime.run('go')
    const request = await h.request()
    expect(request.payload).toMatchObject({ toolCallId: 'e1', kind: 'escalation', targetMode: 'danger-full-access' })
    await h.runtime.answerApproval(request.payload.requestId, { decision: 'allow' })
    expect((await run).status).toBe('completed')
    expect(text(resultOf(h.entries, 'e0'))).toContain('invalid escalation: sandbox_permissions only retries a command the sandbox denied in this run')
    expect(exec.requests.map((r) => r.sandbox?.mode)).toEqual(['workspace-write', 'danger-full-access'])
    expect(h.entries.filter((e) => e.kind === 'approval_request')).toHaveLength(1)
  })
})

describe('暂停与规则拒绝', () => {
  it('暂停取消等待中的审批：该调用为"暂停前未批准"；同批被拒绝规则拦下的调用保留规则拒绝的文本', async () => {
    const h = harness({ rules: [{ behavior: 'deny', tool: 'Bash', content: 'rm *' }] })
    h.faux.setResponses([
      turn([fauxToolCall('write', { path: 'a.txt', content: 'a' }, { id: 'w1' }), fauxToolCall('bash', { command: 'rm -rf x' }, { id: 'b1' })]),
      fauxAssistantMessage('should not be used'),
    ])
    const run = h.runtime.run('go')
    await h.request()
    h.runtime.pause()
    expect((await run).status).toBe('paused')
    expect(text(resultOf(h.entries, 'w1'))).toBe('Not run: the user paused the run before this call was approved.')
    expect(text(resultOf(h.entries, 'b1'))).toBe('Permission denied by rule Bash(rm *).')
  })
})

describe('重新判定后的建议', () => {
  it('切到 read-only 后仍需询问但原因变了：旧请求 superseded，新请求不再提供"总是允许"', async () => {
    const h = harness()
    h.faux.setResponses([turn([fauxToolCall('write', { path: 'a.txt', content: 'a' }, { id: 'w1' })]), fauxAssistantMessage('done')])
    const run = h.runtime.run('go')
    const first = await h.request()
    expect(first.payload.suggestions).toHaveLength(1)
    h.state.mode = 'read-only'
    await h.runtime.answerApproval(first.payload.requestId, { decision: 'reevaluate' })
    const second = await h.request(2)
    expect(second.payload).toMatchObject({ toolCallId: 'w1', subject: 'a.txt', suggestions: [] })
    expect(h.runtime.pendingApprovals.map((p) => p.requestId)).toEqual([second.payload.requestId])
    expect(h.entries.filter((e) => e.kind === 'approval_decision').map((e) => e.payload)).toEqual([
      { requestId: first.payload.requestId, outcome: 'superseded' },
    ])
    await h.runtime.answerApproval(second.payload.requestId, { decision: 'allow' })
    expect((await run).status).toBe('completed')
    expect(await readFile(ws.path('a.txt'), 'utf8')).toBe('a')
  })

  it('原因与建议都没变时请求保持等待', async () => {
    const h = harness()
    h.faux.setResponses([turn([fauxToolCall('write', { path: 'a.txt', content: 'a' }, { id: 'w1' })]), fauxAssistantMessage('done')])
    const run = h.runtime.run('go')
    const first = await h.request()
    await h.runtime.answerApproval(first.payload.requestId, { decision: 'reevaluate' })
    expect(h.runtime.pendingApprovals.map((p) => p.requestId)).toEqual([first.payload.requestId])
    await h.runtime.answerApproval(first.payload.requestId, { decision: 'allow' })
    await run
  })
})
