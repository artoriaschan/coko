// Agent Teams（ADR 0018）的任务板：当前板由根 Session 的 team_task 条目派生（每个任务取最后一条快照），变更规划为纯函数——宿主在
// KeyedMutex(rootSessionId) 内读取条目、规划、提交。并发控制是 compare-and-set：task_update 必须带 expected_revision，不一致为 stale-revision
// （带当前快照）；"锁"就是 CAS 加"认领即独占"。writeScopes 只在两个 in_progress 任务重叠时给警告，不阻止写入、不改变权限判定。
import { TEAM_TASK_DESCRIPTION_MAX, TEAM_TASK_SUBJECT_MAX, type TeamTaskPayload, type TeamTaskStatus } from '../../session-entries/teams.ts'
import { TEAM_LEAD_NAME } from './names.ts'

/** 每个根 Session 非删除任务的上限。 */
export const MAX_TEAM_TASKS = 100
/** 一个任务的 writeScopes 至多几项。 */
export const MAX_TASK_WRITE_SCOPES = 20

export type TeamTaskErrorCode = 'stale-revision' | 'task-not-claimable' | 'not-owner' | 'task-not-found' | 'cycle' | 'team-task-limit' | 'invalid-argument'

/** task-not-claimable 的原因。 */
export type NotClaimableReason = 'owned' | 'blocked' | 'not-pending'

/** 任务板规则拒绝的变更：工具结果为错误，文本以 code 开头；stale-revision 带当前快照，task-not-claimable 带原因。 */
export class TeamTaskError extends Error {
  readonly code: TeamTaskErrorCode
  readonly task: TeamTaskPayload | undefined
  readonly reason: NotClaimableReason | undefined

  constructor(code: TeamTaskErrorCode, message: string, extra: { task?: TeamTaskPayload; reason?: NotClaimableReason } = {}) {
    super(message)
    this.name = 'TeamTaskError'
    this.code = code
    this.task = extra.task
    this.reason = extra.reason
  }
}

/** 任务板中的一项：快照加 ready（pending 且前置全部完成或已删除）。 */
export type TeamTaskView = TeamTaskPayload & { ready: boolean }

/** 两个 in_progress 任务的 writeScopes 重叠。 */
export interface TeamWarning {
  code: 'write-scope-overlap'
  taskIds: string[]
  message: string
}

/** 变更的发起者：成员名（teammate）或 lead（根 Session）。 */
export interface TeamActor {
  name: string
}

const isLead = (actor: TeamActor) => actor.name === TEAM_LEAD_NAME

/** 根 Session 的当前任务（每个 taskId 最后一条快照，按首次出现的顺序；含已删除）。 */
export function teamTasks(entries: readonly { kind: string; payload: unknown }[]): Map<string, TeamTaskPayload> {
  const tasks = new Map<string, TeamTaskPayload>()
  for (const entry of entries) if (entry.kind === 'team_task') tasks.set((entry.payload as TeamTaskPayload).taskId, entry.payload as TeamTaskPayload)
  return tasks
}

/** 前置任务是否已解除（completed 或已删除）。 */
const resolved = (tasks: ReadonlyMap<string, TeamTaskPayload>, id: string) => {
  const status = tasks.get(id)?.status
  return status === 'completed' || status === 'deleted'
}

const isReady = (tasks: ReadonlyMap<string, TeamTaskPayload>, task: TeamTaskPayload) =>
  task.status === 'pending' && task.blockedBy.every((id) => resolved(tasks, id))

/** 任务板（不含已删除），每项加 ready。 */
export function taskViews(tasks: ReadonlyMap<string, TeamTaskPayload>): TeamTaskView[] {
  return [...tasks.values()].filter((t) => t.status !== 'deleted').map((t) => ({ ...t, ready: isReady(tasks, t) }))
}

/** 两个前缀是否重叠：相同、一个是另一个的上级目录，或其一为 Workspace 根（.）。 */
const overlaps = (a: string, b: string) => a === '.' || b === '.' || a === b || a.startsWith(b + '/') || b.startsWith(a + '/')

/** in_progress 任务两两之间的 writeScopes 重叠警告。 */
export function writeScopeWarnings(tasks: ReadonlyMap<string, TeamTaskPayload>): TeamWarning[] {
  const active = [...tasks.values()].filter((t) => t.status === 'in_progress' && t.writeScopes.length > 0)
  const warnings: TeamWarning[] = []
  for (let i = 0; i < active.length; i++)
    for (let j = i + 1; j < active.length; j++) {
      const [a, b] = [active[i]!, active[j]!]
      const pairs = a.writeScopes.flatMap((x) => b.writeScopes.filter((y) => overlaps(x, y)).map((y) => `${x} ~ ${y}`))
      if (pairs.length > 0)
        warnings.push({
          code: 'write-scope-overlap',
          taskIds: [a.taskId, b.taskId],
          message: `Tasks ${a.taskId} and ${b.taskId} are both in progress with overlapping write scopes (${pairs.join(', ')})`,
        })
    }
  return warnings
}

/** writeScopes 规范化：Workspace 相对路径前缀（去掉 ./ 与末尾 /，去重）；绝对路径与含 .. 的为 invalid-argument。 */
export function normalizeWriteScopes(scopes: readonly string[]): string[] {
  if (scopes.length > MAX_TASK_WRITE_SCOPES) throw new TeamTaskError('invalid-argument', `At most ${MAX_TASK_WRITE_SCOPES} write scopes per task`)
  const out: string[] = []
  for (const raw of scopes) {
    let scope = raw.trim().replaceAll('\\', '/')
    if (scope === '' || scope.startsWith('/') || /^[a-zA-Z]:/.test(scope))
      throw new TeamTaskError('invalid-argument', `Write scope ${JSON.stringify(raw)} must be a workspace-relative path`)
    while (scope.startsWith('./')) scope = scope.slice(2)
    scope = scope.replace(/\/+$/, '').replace(/\/{2,}/g, '/') || '.'
    if (scope.split('/').includes('..')) throw new TeamTaskError('invalid-argument', `Write scope ${JSON.stringify(raw)} must stay inside the workspace`)
    if (!out.includes(scope)) out.push(scope)
  }
  return out
}

const subjectOf = (raw: string) => {
  const subject = raw.trim()
  if (subject === '' || subject.length > TEAM_TASK_SUBJECT_MAX)
    throw new TeamTaskError('invalid-argument', `The subject must be 1-${TEAM_TASK_SUBJECT_MAX} characters`)
  return subject
}

const descriptionOf = (raw: string) => {
  if (raw.length > TEAM_TASK_DESCRIPTION_MAX)
    throw new TeamTaskError('invalid-argument', `The description must be at most ${TEAM_TASK_DESCRIPTION_MAX} characters`)
  return raw
}

/** blockedBy：引用须存在且未删除、不能指向自己、不能成环（taskId 为正在规划的任务）。 */
function blockersOf(tasks: ReadonlyMap<string, TeamTaskPayload>, taskId: string, raw: readonly string[]): string[] {
  const ids = [...new Set(raw)]
  for (const id of ids) {
    if (id === taskId) throw new TeamTaskError('cycle', `Task ${taskId} cannot be blocked by itself`)
    const blocker = tasks.get(id)
    if (!blocker || blocker.status === 'deleted') throw new TeamTaskError('task-not-found', `Task ${id} does not exist`)
  }
  // 从每个前置沿 blockedBy 向上走，回到 taskId 即成环。
  const seen = new Set<string>()
  const stack = [...ids]
  while (stack.length > 0) {
    const id = stack.pop()!
    if (id === taskId) throw new TeamTaskError('cycle', `blockedBy would create a cycle through ${taskId}`)
    if (seen.has(id)) continue
    seen.add(id)
    stack.push(...(tasks.get(id)?.blockedBy ?? []))
  }
  return ids
}

export interface TaskCreateInput {
  subject: string
  description?: string
  blockedBy?: readonly string[]
  writeScopes?: readonly string[]
}

/** task_create：新任务为 pending、revision 1、没有 owner；非删除任务至多 MAX_TEAM_TASKS 个。 */
export function planTaskCreate(tasks: ReadonlyMap<string, TeamTaskPayload>, input: TaskCreateInput, actor: TeamActor): TeamTaskPayload {
  const live = [...tasks.values()].filter((t) => t.status !== 'deleted').length
  if (live >= MAX_TEAM_TASKS) throw new TeamTaskError('team-task-limit', `The task board already has ${MAX_TEAM_TASKS} tasks; delete or complete some first`)
  const next = Math.max(0, ...[...tasks.keys()].map((id) => Number(id.slice(1)))) + 1
  const taskId = `t${next}`
  return {
    taskId,
    revision: 1,
    subject: subjectOf(input.subject),
    description: descriptionOf(input.description ?? ''),
    status: 'pending',
    blockedBy: blockersOf(tasks, taskId, input.blockedBy ?? []),
    writeScopes: normalizeWriteScopes(input.writeScopes ?? []),
    by: actor.name,
  }
}

export interface TaskUpdateInput {
  taskId: string
  expectedRevision: number
  status?: TeamTaskStatus
  /** 成员名或 lead；null 清空。 */
  owner?: string | null
  subject?: string
  description?: string
  blockedBy?: readonly string[]
  writeScopes?: readonly string[]
}

export interface TaskUpdateContext {
  /** 可以作为 owner 的名字：未解散的成员与 lead。 */
  members: ReadonlySet<string>
}

const notOwner = (task: TeamTaskPayload, actor: TeamActor, what: string) =>
  new TeamTaskError('not-owner', `${actor.name} cannot ${what} task ${task.taskId}${task.owner ? ` owned by ${task.owner}` : ''}`)

const notClaimable = (task: TeamTaskPayload, reason: NotClaimableReason, detail: string) =>
  new TeamTaskError('task-not-claimable', `Task ${task.taskId} cannot be claimed (${reason}): ${detail}`, { reason, task })

/**
 * task_update 的规则：
 * - expected_revision 必须等于当前 revision（stale-revision，带当前快照）；已删除的任务不能认领（not-pending），其余变更为 task-not-found。
 * - 认领（status → in_progress）：当前为 pending（not-pending）、没有 owner 或已是认领者（owned）、blockedBy 全部完成（blocked）；认领者缺省为调用者，
 *   teammate 只能认领给自己（not-owner），lead 可以指派任何成员。
 * - 只改 owner：teammate 只能把空的 owner 设为自己、或清空自己的；清空 in_progress 任务的 owner 即释放（回到 pending）。
 * - 完成、释放（in_progress → pending）、重开（completed → pending）、删除与改内容：只能由 owner 或 lead（没有 owner 时任何成员可改内容与删除）。
 */
export function planTaskUpdate(
  tasks: ReadonlyMap<string, TeamTaskPayload>,
  input: TaskUpdateInput,
  actor: TeamActor,
  context: TaskUpdateContext,
): TeamTaskPayload {
  const task = tasks.get(input.taskId)
  if (!task) throw new TeamTaskError('task-not-found', `Task ${input.taskId} does not exist`)
  if (task.status === 'deleted') {
    if (input.status === 'in_progress') throw notClaimable(task, 'not-pending', 'it was deleted')
    throw new TeamTaskError('task-not-found', `Task ${input.taskId} was deleted`)
  }
  if (input.expectedRevision !== task.revision)
    throw new TeamTaskError('stale-revision', `Task ${task.taskId} is at revision ${task.revision}, not ${input.expectedRevision}`, { task })
  const lead = isLead(actor)
  const mine = task.owner === actor.name
  const canManage = lead || mine
  if (input.owner !== undefined && input.owner !== null && !context.members.has(input.owner))
    throw new TeamTaskError('invalid-argument', `${input.owner} is not a member of this team`)
  let status: TeamTaskStatus = task.status
  let owner = task.owner
  const requested = input.status
  if (requested === 'in_progress' && task.status !== 'in_progress') {
    if (input.owner === null) throw new TeamTaskError('invalid-argument', 'A task in progress needs an owner')
    const claimant = input.owner ?? actor.name
    if (!lead && claimant !== actor.name) throw notOwner(task, actor, `assign ${claimant} to`)
    if (task.status !== 'pending') throw notClaimable(task, 'not-pending', `it is ${task.status}`)
    if (task.owner !== undefined && task.owner !== claimant) throw notClaimable(task, 'owned', `it is owned by ${task.owner}`)
    const open = task.blockedBy.filter((id) => !resolved(tasks, id))
    if (open.length > 0) throw notClaimable(task, 'blocked', `waiting for ${open.join(', ')}`)
    status = 'in_progress'
    owner = claimant
  } else if (requested !== undefined && requested !== task.status) {
    if (requested === 'deleted' ? !(canManage || task.owner === undefined) : !canManage)
      throw notOwner(task, actor, requested === 'completed' ? 'complete' : requested === 'deleted' ? 'delete' : 'change the status of')
    status = requested
    // 释放与重开：owner 清空（lead 另给 owner 时为指派）。
    if (requested === 'pending') owner = input.owner === undefined ? undefined : (input.owner ?? undefined)
  }
  if (input.owner !== undefined && !(requested === 'in_progress' && task.status !== 'in_progress') && requested !== 'pending') {
    const target = input.owner ?? undefined
    if (target !== task.owner) {
      if (!lead) {
        const takeFree = target === actor.name && task.owner === undefined
        const dropMine = target === undefined && mine
        if (!takeFree && !dropMine) {
          if (target === actor.name) throw notClaimable(task, 'owned', `it is owned by ${task.owner}`)
          throw notOwner(task, actor, target === undefined ? 'release' : `assign ${target} to`)
        }
      }
      owner = target
      // in_progress 的任务失去 owner 即释放。
      if (owner === undefined && status === 'in_progress') status = 'pending'
    }
  }
  const edits = input.subject !== undefined || input.description !== undefined || input.blockedBy !== undefined || input.writeScopes !== undefined
  if (edits && !(canManage || task.owner === undefined)) throw notOwner(task, actor, 'edit')
  return {
    taskId: task.taskId,
    revision: task.revision + 1,
    subject: input.subject === undefined ? task.subject : subjectOf(input.subject),
    description: input.description === undefined ? task.description : descriptionOf(input.description),
    status,
    ...(owner === undefined ? {} : { owner }),
    blockedBy: input.blockedBy === undefined ? task.blockedBy : blockersOf(tasks, task.taskId, input.blockedBy),
    writeScopes: input.writeScopes === undefined ? task.writeScopes : normalizeWriteScopes(input.writeScopes),
    by: actor.name,
  }
}
