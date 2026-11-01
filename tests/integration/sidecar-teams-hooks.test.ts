// 团队的 Hook 事件（ADR 0013、0018；docs/subsystems/hooks.md）：TaskCreated exit 2 → task_create 为错误结果、没有 team_task 条目；TaskCompleted exit 2 →
// 任务保持 in_progress、stderr 在结果中；TeammateIdle exit 2 → stderr 作为 user message 送达 teammate、多一次请求，第 4 次被忽略（与 SubagentStop 共用
// 每 Run 3 次的继续上限）；三个事件的 stdin 字段；未批准的项目 Hook 不运行。Hook 配置在已有的全局设置与项目设置文件中，不新增读取根。
import { existsSync } from 'node:fs'
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { apiPaths, hookPaths } from '@coko/protocol'
import { tempDir } from './sidecar-harness.ts'
import { bootAgents, byUser, call, of, runEnds, texts } from './sidecar-subagents-harness.ts'

type Entry = { kind: string; payload: Record<string, unknown> }
const q = (path: string) => "'" + path.replaceAll("'", "'\\''") + "'"
const group = (command: string) => ({ hooks: [{ type: 'command' as const, command }] })
const records = async (path: string) =>
  existsSync(path)
    ? (await readFile(path, 'utf8'))
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>)
    : []

describe('Agent Teams：TaskCreated / TaskCompleted / TeammateIdle', { timeout: 180_000 }, () => {
  it('exit 2 的语义、继续上限、stdin 字段；未批准的项目 Hook 不运行', async () => {
    const root = await realpath(await tempDir())
    const workspace = join(root, 'ws')
    const record = join(root, 'team-hooks.jsonl')
    const projectRecord = join(root, 'project-hooks.jsonl')
    const gate = join(root, 'worker-gate')
    await mkdir(join(workspace, '.coko'), { recursive: true })
    await writeFile(
      join(workspace, '.coko', 'settings.json'),
      JSON.stringify({ hooks: { TaskCreated: [group('cat >> ' + q(projectRecord) + "; echo 'project blocks' >&2; exit 2")] } }),
    )
    const recording = (body: string) => 'in=$(cat); printf ' + "'%s\\n'" + ' "$in" >> ' + q(record) + '; ' + body
    const env = await bootAgents(
      [
        { match: 'LEAD-H', content: [call('agent', 'a1', { description: 'worker', prompt: 'MATE-WORKER start', subagent_type: 'general', name: 'worker' })] },
        {
          content: [
            call('task_create', 'c1', { subject: 'BLOCK-ME task', description: 'should not exist' }),
            call('task_create', 'c2', { subject: 'Allowed task', description: 'DESC-ALLOWED' }),
          ],
        },
        { content: [call('task_update', 'u1', { id: 't1', expected_revision: 1, status: 'in_progress' })] },
        { content: [call('task_update', 'u2', { id: 't1', expected_revision: 2, status: 'completed' })] },
        { content: 'lead done' },
        { match: 'MATE-WORKER', content: [call('bash', 'wg', { command: 'until [ -f ' + q(gate) + ' ]; do sleep 0.02; done' })] },
        { match: 'MATE-WORKER', content: [call('task_create', 'wc', { subject: 'Worker task' })] },
        { match: 'MATE-WORKER', content: 'WORKER-IDLE-0' },
        ...[1, 2, 3].map((n) => ({ match: 'KEEP-WORKING', content: 'WORKER-IDLE-' + n })),
        { match: 'KEEP-WORKING', content: 'must not be requested' },
        { content: 'lead spare' },
        { content: 'lead spare' },
      ],
      { workspace },
    )
    const hooks = {
      TaskCreated: [group(recording('case "$in" in *BLOCK-ME*) echo ' + "'TASK-BLOCKED by policy'" + ' >&2; exit 2;; esac'))],
      TaskCompleted: [group(recording("echo 'COMPLETE-BLOCKED tests failing' >&2; exit 2"))],
      TeammateIdle: [group(recording("echo 'KEEP-WORKING on the report' >&2; exit 2"))],
    }
    const saved = await env.api.put(hookPaths.hooks, { hooks, expectedRevision: 0 })
    expect(saved.status).toBe(200)
    const { api, stream, submit, requests } = env
    const lead = await env.open('full-access')
    await submit(lead, 'LEAD-H go')
    await stream.waitFor(() => runEnds(stream, lead).length >= 1, 90_000)
    // lead 的任务操作完成之后放行 worker（任务 id 与 Hook 记录的顺序确定）。
    await writeFile(gate, 'open')
    await expect
      .poll(async () => ((await api.get(apiPaths.session(lead))).body.entries as Entry[]).filter((e) => e.kind === 'agent_end').length, { timeout: 90_000 })
      .toBe(1)
    const leadEntries = (await api.get(apiPaths.session(lead))).body.entries as Entry[]
    const result = (name: string) =>
      leadEntries
        .filter((e) => e.kind === 'message' && e.payload.role === 'toolResult' && e.payload.toolName === name)
        .map((e) => ({ isError: e.payload.isError, text: texts(e.payload.content).join('') }))

    // TaskCreated exit 2：错误结果带 stderr，没有对应的 team_task 条目；放行的照常提交。
    expect(result('task_create')).toEqual([
      { isError: true, text: expect.stringContaining('TASK-BLOCKED by policy') },
      { isError: false, text: expect.stringMatching(/^Created t1 /) },
    ])
    // TaskCompleted exit 2：任务保持 in_progress，stderr 在结果中。
    expect(result('task_update')).toEqual([
      { isError: false, text: expect.stringMatching(/^Updated t1 \(revision 2, in_progress/) },
      { isError: true, text: expect.stringContaining('COMPLETE-BLOCKED tests failing') },
    ])
    const tasks = leadEntries.filter((e) => e.kind === 'team_task').map((e) => e.payload)
    expect(tasks.map((t) => [t.taskId, t.subject, t.status])).toEqual([
      ['t1', 'Allowed task', 'pending'],
      ['t1', 'Allowed task', 'in_progress'],
      ['t2', 'Worker task', 'pending'],
    ])

    // TeammateIdle exit 2：stderr 作为 user message 送达、Run 继续；3 次之后的第 4 次被忽略，没有第 5 次请求。
    const worker = (of(stream, lead, 'agent_start')[0]!.payload as { agentId: string }).agentId
    const workerEntries = (await api.get(apiPaths.session(worker))).body.entries as Entry[]
    const nudges = workerEntries.filter((e) => e.kind === 'message' && e.payload.role === 'user' && texts(e.payload.content).join('').includes('KEEP-WORKING'))
    expect(nudges).toHaveLength(3)
    expect(workerEntries.filter((e) => e.kind === 'run_start')).toHaveLength(1)
    expect(JSON.stringify(workerEntries)).toContain('WORKER-IDLE-3')
    expect(JSON.stringify(await requests())).not.toContain('must not be requested')
    expect(byUser(await requests(), 'KEEP-WORKING')).toHaveLength(3)
    const idleRuns = workerEntries.filter((e) => e.kind === 'hook_run' && e.payload.event === 'TeammateIdle').map((e) => e.payload.outcome)
    expect(idleRuns.slice(0, 3)).toEqual(['continued', 'continued', 'continued'])
    expect(idleRuns).toHaveLength(4)

    // stdin：公共字段之外 task_id、task_subject、task_description、teammate_name、team_name（根 Session id）。
    const stdin = await records(record)
    const byEvent = (event: string) => stdin.filter((r) => r.hook_event_name === event)
    expect(byEvent('TaskCreated')).toEqual([
      expect.objectContaining({ task_id: 't1', task_subject: 'BLOCK-ME task', task_description: 'should not exist', teammate_name: 'lead', team_name: lead }),
      expect.objectContaining({ task_id: 't1', task_subject: 'Allowed task', task_description: 'DESC-ALLOWED', teammate_name: 'lead', team_name: lead }),
      expect.objectContaining({ task_id: 't2', task_subject: 'Worker task', teammate_name: 'worker', team_name: lead, session_id: worker }),
    ])
    expect(byEvent('TaskCompleted')).toEqual([expect.objectContaining({ task_id: 't1', task_subject: 'Allowed task', teammate_name: 'lead', team_name: lead })])
    expect(byEvent('TeammateIdle')).toHaveLength(4)
    expect(byEvent('TeammateIdle')[0]).toMatchObject({ teammate_name: 'worker', team_name: lead, session_id: worker })
    // 项目 Hook 没有批准：不运行，也不阻止。
    expect(existsSync(projectRecord)).toBe(false)
  })
})
