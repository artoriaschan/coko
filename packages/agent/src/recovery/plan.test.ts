// planRecovery：从已提交的条目判定被中断的 Run（grilling E3）。真实内置工具 + 临时 Workspace，断言要提交的条目。
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Type } from 'typebox'
import { createLocalExecPort } from '../ports/local-exec.ts'
import { createTempWorkspace, type TempWorkspace } from '../testing/workspace.ts'
import { createBuiltinToolRegistry } from '../tools/builtin/index.ts'
import type { ToolRegistry } from '../tools/registry.ts'
import type { CokoTool } from '../tools/types.ts'
import { confirmationResult, planRecovery, unansweredConfirmations, type RecoveryEntry } from './index.ts'

let ws: TempWorkspace
let registry: ToolRegistry
beforeEach(async () => {
  ws = await createTempWorkspace('coko-recovery-')
  registry = createBuiltinToolRegistry({ cwd: ws.dir, exec: createLocalExecPort() })
})
afterEach(async () => {
  await ws.dispose()
})

const RUN = 'run-1'
type Call = { id: string; name: string; arguments: Record<string, unknown> }

/** 一个被中断的 Run：run_start、用户消息、带调用的 assistant 消息，之后是 extra 条目。 */
function run(calls: Call[], extra: Omit<RecoveryEntry, 'seq'>[] = [], runId = RUN): RecoveryEntry[] {
  const rows: Omit<RecoveryEntry, 'seq'>[] = [
    { kind: 'permission_mode', runId: null, payload: { mode: 'default' } },
    { kind: 'run_start', runId, payload: { trigger: 'submit' } },
    { kind: 'message', runId, payload: { role: 'user', content: [{ type: 'text', text: 'go' }] } },
    {
      kind: 'message',
      runId,
      payload: { role: 'assistant', content: calls.map((c) => ({ type: 'toolCall', ...c })), stopReason: 'toolUse' },
    },
    ...extra,
  ]
  return rows.map((row, i) => ({ ...row, seq: i + 1 }))
}
const exec = (id: string, name: string, runId = RUN): Omit<RecoveryEntry, 'seq'> => ({
  kind: 'tool_exec',
  runId,
  payload: { toolCallId: id, toolName: name, idempotencyKey: 's:' + id },
})
const result = (id: string, name: string): Omit<RecoveryEntry, 'seq'> => ({
  kind: 'message',
  runId: RUN,
  payload: { role: 'toolResult', toolCallId: id, toolName: name, content: [{ type: 'text', text: 'ok' }], isError: false },
})

const plan = (entries: RecoveryEntry[], tools: ToolRegistry = registry) => planRecovery(entries, { runId: RUN, tool: (name) => tools.get(name), cwd: ws.dir })
/** 计划的条目，toolResult 只保留判定相关的字段。 */
const shape = (entries: Awaited<ReturnType<typeof plan>>) =>
  entries.map((e) => {
    if (e.kind !== 'message') return { kind: e.kind, payload: e.payload }
    const p = e.payload as { role: string; toolCallId: string; toolName: string; isError: boolean; content: { text: string }[] }
    return { kind: 'toolResult', toolCallId: p.toolCallId, toolName: p.toolName, isError: p.isError, text: p.content[0]!.text }
  })

describe('planRecovery', () => {
  it('等待审批的调用 → approval_decision expired + "未执行"结果；没有 confirmation_request；最后 run_end interrupted', async () => {
    const entries = run(
      [{ id: 'c1', name: 'bash', arguments: { command: 'touch done' } }],
      [
        {
          kind: 'approval_request',
          runId: RUN,
          payload: { requestId: 'q1', toolCallId: 'c1', toolName: 'bash', kind: 'tool', subject: 'touch done', suggestions: [] },
        },
      ],
    )
    const planned = await plan(entries)
    expect(planned.every((e) => e.runId === RUN)).toBe(true)
    expect(shape(planned)).toEqual([
      { kind: 'approval_decision', payload: { requestId: 'q1', outcome: 'expired' } },
      { kind: 'toolResult', toolCallId: 'c1', toolName: 'bash', isError: true, text: expect.stringMatching(/^Not run: .*approval/) },
      { kind: 'run_end', payload: { status: 'interrupted' } },
    ])
  })

  it('已批准但没有 tool_exec 的副作用调用 → "未执行"；只读调用 → "已中断，可重试"；已有结果的调用不再补', async () => {
    const entries = run(
      [
        { id: 'c1', name: 'read', arguments: { path: 'a.txt' } },
        { id: 'c2', name: 'write', arguments: { path: 'b.txt', content: 'x' } },
        { id: 'c3', name: 'ls', arguments: {} },
      ],
      [
        {
          kind: 'approval_request',
          runId: RUN,
          payload: { requestId: 'q2', toolCallId: 'c2', toolName: 'write', kind: 'tool', subject: 'b.txt', suggestions: [] },
        },
        { kind: 'approval_decision', runId: RUN, payload: { requestId: 'q2', outcome: 'allowed', scope: 'once' } },
        result('c3', 'ls'),
      ],
    )
    expect(shape(await plan(entries))).toEqual([
      { kind: 'toolResult', toolCallId: 'c1', toolName: 'read', isError: true, text: expect.stringMatching(/^Interrupted: .*no side effects.*retry/) },
      { kind: 'toolResult', toolCallId: 'c2', toolName: 'write', isError: true, text: expect.stringMatching(/^Not run: /) },
      { kind: 'run_end', payload: { status: 'interrupted' } },
    ])
  })

  it('bash 有 tool_exec、没有结果（结果不明）→ confirmation_request，不补结果', async () => {
    const entries = run([{ id: 'c1', name: 'bash', arguments: { command: 'sleep 30; touch done' } }], [exec('c1', 'bash')])
    expect(shape(await plan(entries))).toEqual([
      { kind: 'confirmation_request', payload: { toolCallId: 'c1' } },
      { kind: 'run_end', payload: { status: 'interrupted' } },
    ])
  })

  it('write 有 tool_exec：内容已一致 → 直接补"已生效"结果；文件不存在 → "未生效"；内容不同（可能写了一半）→ 待确认', async () => {
    await ws.write('same.txt', 'hello')
    await ws.write('other.txt', 'hel')
    const entries = run(
      [
        { id: 'c1', name: 'write', arguments: { path: 'same.txt', content: 'hello' } },
        { id: 'c2', name: 'write', arguments: { path: 'missing.txt', content: 'x' } },
        { id: 'c3', name: 'write', arguments: { path: 'other.txt', content: 'hello' } },
      ],
      [exec('c1', 'write'), exec('c2', 'write'), exec('c3', 'write')],
    )
    expect(shape(await plan(entries))).toEqual([
      { kind: 'toolResult', toolCallId: 'c1', toolName: 'write', isError: false, text: expect.stringMatching(/^Applied: /) },
      { kind: 'toolResult', toolCallId: 'c2', toolName: 'write', isError: true, text: expect.stringMatching(/^Not applied: /) },
      { kind: 'confirmation_request', payload: { toolCallId: 'c3' } },
      { kind: 'run_end', payload: { status: 'interrupted' } },
    ])
  })

  it('edit 有 tool_exec：文件已是新文本 → 已生效；仍是旧文本 → 未生效；两者都不像或文件不存在 → 待确认', async () => {
    await ws.write('done.ts', 'const a = 2\n')
    await ws.write('todo.ts', 'const a = 1\n')
    await ws.write('neither.ts', 'something else\n')
    const edit = (path: string) => ({ path, edits: [{ oldText: 'const a = 1', newText: 'const a = 2' }] })
    const entries = run(
      [
        { id: 'c1', name: 'edit', arguments: edit('done.ts') },
        { id: 'c2', name: 'edit', arguments: edit('todo.ts') },
        { id: 'c3', name: 'edit', arguments: edit('neither.ts') },
        { id: 'c4', name: 'edit', arguments: edit('gone.ts') },
      ],
      [exec('c1', 'edit'), exec('c2', 'edit'), exec('c3', 'edit'), exec('c4', 'edit')],
    )
    expect(shape(await plan(entries))).toEqual([
      { kind: 'toolResult', toolCallId: 'c1', toolName: 'edit', isError: false, text: expect.stringMatching(/^Applied: /) },
      { kind: 'toolResult', toolCallId: 'c2', toolName: 'edit', isError: true, text: expect.stringMatching(/^Not applied: /) },
      { kind: 'confirmation_request', payload: { toolCallId: 'c3' } },
      { kind: 'confirmation_request', payload: { toolCallId: 'c4' } },
      { kind: 'run_end', payload: { status: 'interrupted' } },
    ])
  })

  it('edit 新文本包含旧文本（追加）时只按唯一可判定的方向下结论', async () => {
    await ws.write('appended.ts', 'a\nb\n')
    await ws.write('original.ts', 'a\n')
    const edit = (path: string) => ({ path, edits: [{ oldText: 'a\n', newText: 'a\nb\n' }] })
    const entries = run(
      [
        { id: 'c1', name: 'edit', arguments: edit('appended.ts') },
        { id: 'c2', name: 'edit', arguments: edit('original.ts') },
      ],
      [exec('c1', 'edit'), exec('c2', 'edit')],
    )
    // appended.ts 同时含旧文本与新文本：两个方向都能匹配，不能判定。original.ts 只有旧文本，反向不成立：未生效。
    expect(
      shape(await plan(entries)).map((e) =>
        'toolCallId' in e ? [e.kind, e.toolCallId, e.text?.split(':')[0]] : [e.kind, (e.payload as { toolCallId?: string }).toolCallId],
      ),
    ).toEqual([
      ['confirmation_request', 'c1'],
      ['toolResult', 'c2', 'Not applied'],
      ['run_end', undefined],
    ])
  })

  it('按 toolCallId 关联：tool_exec 与 file_backup 可以不相邻、乱序；其他 Run 的条目与工具结果不参与判定', async () => {
    await ws.write('a.txt', 'A')
    const entries = run(
      [
        { id: 'c1', name: 'write', arguments: { path: 'a.txt', content: 'A' } },
        { id: 'c2', name: 'bash', arguments: { command: 'true' } },
      ],
      [
        { kind: 'file_backup', runId: RUN, payload: { anchorSeq: 3, path: ws.path('a.txt'), absent: true } },
        exec('c2', 'bash', 'another-run'),
        exec('c1', 'write'),
      ],
    )
    expect(shape(await plan(entries)).map((e) => e.kind + ':' + ('toolCallId' in e ? e.toolCallId : ''))).toEqual([
      'toolResult:c1',
      'toolResult:c2',
      'run_end:',
    ])
  })

  it('未注册的工具按副作用处理；probeOutcome 抛错或参数不合 schema 时待确认', async () => {
    const probing: CokoTool = {
      name: 'probing',
      label: 'probing',
      description: 'test',
      parameters: Type.Object({ n: Type.Number() }),
      effect: 'side-effect',
      probeOutcome: async () => {
        throw new Error('cannot tell')
      },
      execute: async () => ({ content: [], details: undefined }),
    }
    registry.register(probing, { source: 'host' })
    const entries = run(
      [
        { id: 'c1', name: 'gone_tool', arguments: {} },
        { id: 'c2', name: 'probing', arguments: { n: 1 } },
        { id: 'c3', name: 'write', arguments: { path: 42 } },
      ],
      [exec('c1', 'gone_tool'), exec('c2', 'probing'), exec('c3', 'write')],
    )
    expect(shape(await plan(entries)).map((e) => e.kind)).toEqual(['confirmation_request', 'confirmation_request', 'confirmation_request', 'run_end'])
  })

  it('Run 中没有 assistant 消息（模型请求进行中被杀）→ 只有 run_end interrupted', async () => {
    const entries = run([]).slice(0, 3)
    expect(shape(await plan(entries))).toEqual([{ kind: 'run_end', payload: { status: 'interrupted' } }])
  })
})

describe('结果确认', () => {
  it('unansweredConfirmations：有请求、没有回答的调用（按请求顺序）', () => {
    const entries = run(
      [],
      [
        { kind: 'confirmation_request', runId: RUN, payload: { toolCallId: 'c1' } },
        { kind: 'confirmation_request', runId: RUN, payload: { toolCallId: 'c2' } },
        { kind: 'confirmation_answer', runId: RUN, payload: { toolCallId: 'c1', answer: 'applied' } },
      ],
    )
    expect(unansweredConfirmations(entries).map((e) => e.toolCallId)).toEqual(['c2'])
  })

  it('confirmationResult：三种回答对应 toolResult；不确定时让 Agent 先核实', () => {
    const of = (answer: 'applied' | 'not-applied' | 'unknown') => {
      const message = confirmationResult({ toolCallId: 'c1', toolName: 'bash', answer })
      return { isError: message.isError, text: (message.content[0] as { text: string }).text, toolCallId: message.toolCallId, role: message.role }
    }
    expect(of('applied')).toMatchObject({
      role: 'toolResult',
      toolCallId: 'c1',
      isError: false,
      text: expect.stringMatching(/^Applied \(confirmed by the user\)/),
    })
    expect(of('not-applied')).toMatchObject({ isError: true, text: expect.stringMatching(/^Not applied \(confirmed by the user\)/) })
    expect(of('unknown')).toMatchObject({ isError: true, text: expect.stringMatching(/^Outcome unknown.*check the current state/) })
  })
})
