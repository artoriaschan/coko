import { describe, expect, it } from 'vitest'
import type { TeamTaskPayload } from '../../session-entries/teams.ts'
import {
  MAX_TEAM_TASKS,
  normalizeWriteScopes,
  planTaskCreate,
  planTaskUpdate,
  taskViews,
  TeamTaskError,
  teamTasks,
  writeScopeWarnings,
  type TaskUpdateInput,
} from './board.ts'
import { teammateNameProblem } from './names.ts'
import { memberStatus, subagentReachable, teamRoster } from './roster.ts'
import { teamSectionText } from './section.ts'
import { createTaskUpdateTool, teamErrorText, type TeamPort } from './tools.ts'

const task = (over: Partial<TeamTaskPayload> & { taskId: string }): TeamTaskPayload => ({
  revision: 1,
  subject: over.taskId,
  description: '',
  status: 'pending',
  blockedBy: [],
  writeScopes: [],
  by: 'lead',
  ...over,
})
const board = (...tasks: TeamTaskPayload[]) => new Map(tasks.map((t) => [t.taskId, t]))
const members = { members: new Set(['lead', 'alice', 'bob']) }
const caught = (fn: () => unknown): TeamTaskError => {
  try {
    fn()
  } catch (error) {
    if (error instanceof TeamTaskError) return error
    throw error
  }
  throw new Error('expected a TeamTaskError')
}

describe('任务板：认领与 CAS', () => {
  const claim = (by: string, extra: Partial<TaskUpdateInput> = {}): TaskUpdateInput => ({
    taskId: 't1',
    expectedRevision: 1,
    status: 'in_progress',
    ...extra,
    ...(by ? {} : {}),
  })
  it.each([
    ['owned', board(task({ taskId: 't1', owner: 'bob' })), 'alice'],
    ['blocked', board(task({ taskId: 't0' }), task({ taskId: 't1', blockedBy: ['t0'] })), 'alice'],
    ['not-pending', board(task({ taskId: 't1', status: 'completed', owner: 'bob' })), 'alice'],
    ['not-pending', board(task({ taskId: 't1', status: 'deleted' })), 'alice'],
  ] as const)('不可认领：%s', (reason, tasks, actor) => {
    const error = caught(() => planTaskUpdate(tasks, claim(actor), { name: actor }, members))
    expect(error).toMatchObject({ code: 'task-not-claimable', reason })
    expect(teamErrorText(error)).toMatch(new RegExp(`^task-not-claimable: .*\\(${reason}\\)`))
  })

  it('pending、无 owner、前置完成（或已删除）：认领者为调用者，revision + 1，by 为调用者', () => {
    const tasks = board(task({ taskId: 't0', status: 'completed' }), task({ taskId: 't2', status: 'deleted' }), task({ taskId: 't1', blockedBy: ['t0', 't2'] }))
    expect(planTaskUpdate(tasks, claim('alice'), { name: 'alice' }, members)).toMatchObject({ status: 'in_progress', owner: 'alice', revision: 2, by: 'alice' })
  })

  it('CAS：expected_revision 不等于当前为 stale-revision，带当前快照', () => {
    const current = task({ taskId: 't1', revision: 3 })
    const error = caught(() => planTaskUpdate(board(current), claim('alice'), { name: 'alice' }, members))
    expect(error).toMatchObject({ code: 'stale-revision', task: current })
    expect(teamErrorText(error)).toContain(JSON.stringify(current))
  })

  it('同一 revision 的两次认领：第一次提交后第二次为 stale-revision', () => {
    const tasks = board(task({ taskId: 't1' }))
    const first = planTaskUpdate(tasks, claim('alice'), { name: 'alice' }, members)
    tasks.set('t1', first)
    expect(caught(() => planTaskUpdate(tasks, claim('bob'), { name: 'bob' }, members)).code).toBe('stale-revision')
  })

  it('teammate 指派他人为 not-owner；lead 可以指派任何成员；非成员为 invalid-argument', () => {
    const tasks = board(task({ taskId: 't1' }))
    expect(caught(() => planTaskUpdate(tasks, claim('alice', { owner: 'bob' }), { name: 'alice' }, members)).code).toBe('not-owner')
    expect(caught(() => planTaskUpdate(tasks, { taskId: 't1', expectedRevision: 1, owner: 'bob' }, { name: 'alice' }, members)).code).toBe('not-owner')
    expect(planTaskUpdate(tasks, claim('lead', { owner: 'bob' }), { name: 'lead' }, members)).toMatchObject({ owner: 'bob', status: 'in_progress' })
    expect(caught(() => planTaskUpdate(tasks, claim('lead', { owner: 'zed' }), { name: 'lead' }, members)).code).toBe('invalid-argument')
  })

  it('完成只能由 owner 或 lead', () => {
    const tasks = board(task({ taskId: 't1', status: 'in_progress', owner: 'alice' }))
    const done = { taskId: 't1', expectedRevision: 1, status: 'completed' as const }
    expect(caught(() => planTaskUpdate(tasks, done, { name: 'bob' }, members)).code).toBe('not-owner')
    expect(planTaskUpdate(tasks, done, { name: 'alice' }, members).status).toBe('completed')
    expect(planTaskUpdate(tasks, done, { name: 'lead' }, members).status).toBe('completed')
  })

  it('释放：owner 清空自己的（或 status pending）回到 pending 无 owner；他人不能释放', () => {
    const tasks = board(task({ taskId: 't1', status: 'in_progress', owner: 'alice' }))
    const dropped = planTaskUpdate(tasks, { taskId: 't1', expectedRevision: 1, owner: null }, { name: 'alice' }, members)
    expect(dropped.status).toBe('pending')
    expect(dropped).not.toHaveProperty('owner')
    const released = planTaskUpdate(tasks, { taskId: 't1', expectedRevision: 1, status: 'pending' }, { name: 'alice' }, members)
    expect(released.status).toBe('pending')
    expect(released).not.toHaveProperty('owner')
    expect(caught(() => planTaskUpdate(tasks, { taskId: 't1', expectedRevision: 1, owner: null }, { name: 'bob' }, members)).code).toBe('not-owner')
  })

  it('删除后不可认领（not-pending），其他变更为 task-not-found；不存在为 task-not-found', () => {
    const tasks = board(task({ taskId: 't1' }))
    const deleted = planTaskUpdate(tasks, { taskId: 't1', expectedRevision: 1, status: 'deleted' }, { name: 'alice' }, members)
    tasks.set('t1', deleted)
    expect(caught(() => planTaskUpdate(tasks, claim('alice', { expectedRevision: 2 }), { name: 'alice' }, members))).toMatchObject({
      code: 'task-not-claimable',
      reason: 'not-pending',
    })
    expect(caught(() => planTaskUpdate(tasks, { taskId: 't1', expectedRevision: 2, subject: 'x' }, { name: 'lead' }, members)).code).toBe('task-not-found')
    expect(caught(() => planTaskUpdate(tasks, { taskId: 't9', expectedRevision: 1 }, { name: 'lead' }, members)).code).toBe('task-not-found')
    expect(taskViews(tasks)).toEqual([])
  })
})

describe('任务板：创建、blockedBy、上限与警告', () => {
  it('新任务 t<max+1>、pending、无 owner；blockedBy 引用不存在或已删除为 task-not-found', () => {
    const tasks = board(task({ taskId: 't1' }), task({ taskId: 't3', status: 'deleted' }))
    expect(planTaskCreate(tasks, { subject: ' s ', blockedBy: ['t1', 't1'] }, { name: 'alice' })).toMatchObject({
      taskId: 't4',
      revision: 1,
      subject: 's',
      status: 'pending',
      blockedBy: ['t1'],
      by: 'alice',
    })
    expect(caught(() => planTaskCreate(tasks, { subject: 's', blockedBy: ['t2'] }, { name: 'lead' })).code).toBe('task-not-found')
    expect(caught(() => planTaskCreate(tasks, { subject: 's', blockedBy: ['t3'] }, { name: 'lead' })).code).toBe('task-not-found')
  })

  it('blockedBy 环：指向自己与经他人回到自己都为 cycle', () => {
    const tasks = board(task({ taskId: 't1' }), task({ taskId: 't2', blockedBy: ['t1'] }), task({ taskId: 't3', blockedBy: ['t2'] }))
    expect(caught(() => planTaskUpdate(tasks, { taskId: 't1', expectedRevision: 1, blockedBy: ['t1'] }, { name: 'lead' }, members)).code).toBe('cycle')
    expect(caught(() => planTaskUpdate(tasks, { taskId: 't1', expectedRevision: 1, blockedBy: ['t3'] }, { name: 'lead' }, members)).code).toBe('cycle')
  })

  it('非删除任务至多 100 个（已删除的不计）', () => {
    const tasks = board(...Array.from({ length: MAX_TEAM_TASKS }, (_, i) => task({ taskId: `t${i + 1}` })))
    expect(caught(() => planTaskCreate(tasks, { subject: 'x' }, { name: 'lead' })).code).toBe('team-task-limit')
    tasks.set('t1', task({ taskId: 't1', status: 'deleted' }))
    expect(planTaskCreate(tasks, { subject: 'x' }, { name: 'lead' }).taskId).toBe('t101')
  })

  it('writeScopes：两个 in_progress 任务重叠时警告（前缀与根），pending 不警告；规范化拒绝绝对路径与 ..', () => {
    const tasks = board(
      task({ taskId: 't1', status: 'in_progress', owner: 'alice', writeScopes: ['src/a'] }),
      task({ taskId: 't2', status: 'in_progress', owner: 'bob', writeScopes: ['src/a/b.ts', 'docs'] }),
      task({ taskId: 't3', status: 'in_progress', owner: 'lead', writeScopes: ['src/ab'] }),
      task({ taskId: 't4', writeScopes: ['src'] }),
    )
    expect(writeScopeWarnings(tasks)).toEqual([expect.objectContaining({ code: 'write-scope-overlap', taskIds: ['t1', 't2'] })])
    tasks.set('t4', task({ taskId: 't4', status: 'in_progress', owner: 'x', writeScopes: ['.'] }))
    expect(writeScopeWarnings(tasks).map((w) => w.taskIds)).toEqual([
      ['t1', 't2'],
      ['t1', 't4'],
      ['t2', 't4'],
      ['t3', 't4'],
    ])
    expect(normalizeWriteScopes(['./src/', 'src', 'a//b'])).toEqual(['src', 'a/b'])
    expect(() => normalizeWriteScopes(['/etc'])).toThrow(TeamTaskError)
    expect(() => normalizeWriteScopes(['src/../..'])).toThrow(TeamTaskError)
  })

  it('ready：pending 且前置完成或删除；条目取每个任务最后一条快照', () => {
    const entries = [
      { kind: 'team_task', payload: task({ taskId: 't1' }) },
      { kind: 'team_task', payload: task({ taskId: 't2', blockedBy: ['t1'] }) },
      { kind: 'team_task', payload: task({ taskId: 't1', revision: 2, status: 'completed' }) },
    ]
    expect(taskViews(teamTasks(entries)).map((t) => [t.taskId, t.ready])).toEqual([
      ['t1', false],
      ['t2', true],
    ])
  })
})

describe('名字、名册与 <team>', () => {
  it.each(['reviewer', 'a-1', 'a'.repeat(32)])('合规的名字 %s', (name) => {
    expect(teammateNameProblem(name)).toBeUndefined()
  })

  it.each([
    ['lead', 'reserved'],
    ['Bad', 'lowercase'],
    ['1a', 'lowercase'],
    ['a'.repeat(33), 'lowercase'],
    ['a_b', 'lowercase'],
  ])('不合规的名字 %s', (name, problem) => {
    expect(teammateNameProblem(name)).toContain(problem)
  })

  it('名册由 agent_start（teammate）与最后一条 agent_end 派生；状态与可达性', () => {
    const start = (agentId: string, name?: string) => ({
      seq: 0,
      kind: 'agent_start',
      createdAt: 1,
      payload: { agentId, agentType: 'general', description: '', background: true, toolCallId: 'c', ...(name ? { name, teammate: true } : {}) },
    })
    const end = (agentId: string, status: string) => ({ seq: 0, kind: 'agent_end', createdAt: 2, payload: { agentId, status, usage: {}, resultChars: 0 } })
    const roster = teamRoster([
      start('s1', 'alice'),
      start('s2'),
      end('s1', 'completed'),
      start('s3', 'bob'),
      end('s3', 'interrupted'),
      end('s1', 'dismissed'),
    ] as never)
    expect(roster.map((m) => [m.name, memberStatus(m, false)])).toEqual([
      ['alice', 'dismissed'],
      ['bob', 'idle'],
    ])
    expect(memberStatus({}, true)).toBe('running')
    expect(memberStatus({ lastEnd: { status: 'failed' } as never }, false)).toBe('failed')
    expect(['completed', 'max-turns', 'failed', 'cancelled', 'interrupted', 'dismissed'].map((s) => subagentReachable(s as never))).toEqual([
      true,
      true,
      true,
      false,
      false,
      false,
    ])
  })

  it('<team> 只含自己的名字、lead 与固定规则，当前状态取自 State Update', () => {
    const text = teamSectionText({
      name: 'alice',
    })
    expect(text).toMatch(/^<team name="alice">/)
    expect(text).toContain('led by "lead"')
    expect(text).toContain('task_update')
    expect(text).toContain('latest team State Update')
    expect(text).not.toContain('Other teammates:')
    expect(text).not.toContain('Current tasks:')
  })

  it('task_update 的错误结果文本以错误码开头（工具抛出）', async () => {
    const port = {
      updateTask: async () => planTaskUpdate(board(task({ taskId: 't1', revision: 2 })), { taskId: 't1', expectedRevision: 1 }, { name: 'a' }, members),
    } as unknown as TeamPort
    await expect(createTaskUpdateTool(port).execute('c', { id: 't1', expected_revision: 1 })).rejects.toThrow(/^stale-revision: .*\nCurrent: \{/)
  })
})
