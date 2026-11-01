// Agent Teams（ADR 0018）的工具：send_message（成员、lead、"*" 或已结束子代理的 agentId）、task_create、task_update、task_list（权限类 team，
// 所有模式放行）。名册、送达、Hook 与提交由宿主经 TeamPort 提供；这里只有参数、结果文本与错误文本。
import { Type } from 'typebox'
import { TEAM_MESSAGE_SUMMARY_MAX, type TeamTaskPayload, type TeamTaskStatus } from '../../session-entries/teams.ts'
import type { CokoTool } from '../../tools/types.ts'
import { TeamTaskError, type TeamTaskView, type TeamWarning } from './board.ts'
import { TEAM_MESSAGE_BODY_MAX } from './names.ts'

/** send_message 被拒绝时的错误码（工具结果为错误，文本以 code 开头）。 */
export type TeamMessageErrorCode = 'agent-not-reachable' | 'invalid-argument'

export class TeamMessageError extends Error {
  readonly code: TeamMessageErrorCode
  constructor(code: TeamMessageErrorCode, message: string) {
    super(message)
    this.name = 'TeamMessageError'
    this.code = code
  }
}

export interface TeamSendRequest {
  to: string
  message: string
  summary?: string
}

export interface TeamSent {
  messageId: string
  /** 实际送达的目标（广播时为各成员名）。 */
  recipients: string[]
}

export interface TeamTaskCreateRequest {
  subject: string
  description?: string
  blockedBy?: string[]
  writeScopes?: string[]
}

export interface TeamTaskUpdateRequest {
  taskId: string
  expectedRevision: number
  status?: TeamTaskStatus
  owner?: string | null
  subject?: string
  description?: string
  blockedBy?: string[]
  writeScopes?: string[]
}

/** 本 Session（lead 或 teammate）的团队能力（宿主实现）。被规则拒绝时抛出 TeamTaskError / TeamMessageError，Hook 阻止时抛出 Error。 */
export interface TeamPort {
  send(request: TeamSendRequest): Promise<TeamSent>
  createTask(request: TeamTaskCreateRequest): Promise<TeamTaskPayload>
  updateTask(request: TeamTaskUpdateRequest): Promise<TeamTaskPayload>
  listTasks(): Promise<{ tasks: TeamTaskView[]; warnings: TeamWarning[] }>
}

const text = (value: string) => ({ content: [{ type: 'text' as const, text: value }], details: { isError: false } })

/** 规则错误的结果文本：code 开头；stale-revision 带当前快照（JSON）。 */
export function teamErrorText(error: TeamTaskError | TeamMessageError): string {
  const head = `${error.code}: ${error.message}`
  return error instanceof TeamTaskError && error.code === 'stale-revision' && error.task ? `${head}\nCurrent: ${JSON.stringify(error.task)}` : head
}

const rethrow = (error: unknown): never => {
  if (error instanceof TeamTaskError || error instanceof TeamMessageError) throw new Error(teamErrorText(error))
  throw error
}

const taskLine = (task: TeamTaskPayload) =>
  `${task.taskId} (revision ${task.revision}, ${task.status}${task.owner ? `, owner ${task.owner}` : ''}): ${task.subject}`

export const sendMessageParameters = Type.Object({
  to: Type.String({ minLength: 1, description: 'A teammate name, "lead", "*" for every other member, or the agentId of a finished subagent' }),
  message: Type.String({ minLength: 1, maxLength: TEAM_MESSAGE_BODY_MAX, description: 'The message; the recipient sees it as a <team-message> block' }),
  summary: Type.Optional(Type.String({ maxLength: TEAM_MESSAGE_SUMMARY_MAX, description: 'A few words shown in the team timeline' })),
})

export function createSendMessageTool(port: TeamPort): CokoTool<typeof sendMessageParameters, { isError: boolean }> {
  return {
    name: 'send_message',
    label: 'send_message',
    description:
      'Send a message to a teammate, the lead, everyone ("*"), or a finished subagent (by agentId) to continue its conversation. ' +
      'An idle recipient starts a new turn with it; a busy one reads it after its current step.',
    parameters: sendMessageParameters,
    // 送达会开始对方的 Run：side-effect（同一批中独占）。判定按权限类 team。
    effect: 'side-effect',
    permissionSubject: (args) => args.to,
    async execute(_toolCallId, args) {
      const sent = await port.send({ to: args.to, message: args.message, ...(args.summary ? { summary: args.summary } : {}) }).catch(rethrow)
      const to = args.to === '*' ? (sent.recipients.length > 0 ? sent.recipients.join(', ') : 'nobody (no other members)') : args.to
      return { ...text(`Sent to ${to} (message ${sent.messageId}).`), details: { isError: false, messageId: sent.messageId } }
    },
  }
}

const Ids = Type.Array(Type.String({ pattern: '^t[0-9]+$' }))
const Scopes = Type.Array(Type.String({ minLength: 1 }), { description: 'Workspace-relative path prefixes this task writes (only used to warn about overlap)' })

export const taskCreateParameters = Type.Object({
  subject: Type.String({ minLength: 1, maxLength: 200, description: 'A short title' }),
  description: Type.Optional(Type.String({ maxLength: 4000 })),
  blocked_by: Type.Optional(Type.Array(Type.String({ pattern: '^t[0-9]+$' }), { description: 'Tasks that must be completed first' })),
  write_scopes: Type.Optional(Scopes),
})

export function createTaskCreateTool(port: TeamPort): CokoTool<typeof taskCreateParameters, { isError: boolean }> {
  return {
    name: 'task_create',
    label: 'task_create',
    description: 'Add a task to the shared team task board. New tasks are pending and unowned; teammates claim them with task_update.',
    parameters: taskCreateParameters,
    effect: 'side-effect',
    async execute(_toolCallId, args) {
      const task = await port
        .createTask({
          subject: args.subject,
          ...(args.description !== undefined ? { description: args.description } : {}),
          ...(args.blocked_by ? { blockedBy: args.blocked_by } : {}),
          ...(args.write_scopes ? { writeScopes: args.write_scopes } : {}),
        })
        .catch(rethrow)
      return text(`Created ${taskLine(task)}`)
    },
  }
}

export const taskUpdateParameters = Type.Object({
  id: Type.String({ pattern: '^t[0-9]+$', description: 'The task id (t<n>)' }),
  expected_revision: Type.Integer({ minimum: 1, description: 'The revision you last saw; a different current revision fails with stale-revision' }),
  status: Type.Optional(
    Type.Union([Type.Literal('pending'), Type.Literal('in_progress'), Type.Literal('completed'), Type.Literal('deleted')], {
      description: 'in_progress claims the task (you become the owner); completed only by the owner or the lead',
    }),
  ),
  owner: Type.Optional(Type.Union([Type.String({ minLength: 1 }), Type.Null()], { description: 'A member name or "lead"; null clears it' })),
  subject: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  description: Type.Optional(Type.String({ maxLength: 4000 })),
  blocked_by: Type.Optional(Ids),
  write_scopes: Type.Optional(Scopes),
})

export function createTaskUpdateTool(port: TeamPort): CokoTool<typeof taskUpdateParameters, { isError: boolean }> {
  return {
    name: 'task_update',
    label: 'task_update',
    description:
      'Change a task with compare-and-set on its revision: claim it (status in_progress), complete, release (pending), delete, or edit it. ' +
      'Teammates can only claim for themselves; the lead can assign anyone.',
    parameters: taskUpdateParameters,
    effect: 'side-effect',
    async execute(_toolCallId, args) {
      const task = await port
        .updateTask({
          taskId: args.id,
          expectedRevision: args.expected_revision,
          ...(args.status !== undefined ? { status: args.status } : {}),
          ...(args.owner !== undefined ? { owner: args.owner } : {}),
          ...(args.subject !== undefined ? { subject: args.subject } : {}),
          ...(args.description !== undefined ? { description: args.description } : {}),
          ...(args.blocked_by ? { blockedBy: args.blocked_by } : {}),
          ...(args.write_scopes ? { writeScopes: args.write_scopes } : {}),
        })
        .catch(rethrow)
      return text(`Updated ${taskLine(task)}`)
    },
  }
}

export const taskListParameters = Type.Object({})

export function createTaskListTool(port: TeamPort): CokoTool<typeof taskListParameters, { isError: boolean }> {
  return {
    name: 'task_list',
    label: 'task_list',
    description: 'List the team task board: every task with its revision, owner, blockers and whether it is ready, plus write-scope overlap warnings.',
    parameters: taskListParameters,
    effect: 'read',
    async execute() {
      const board = await port.listTasks().catch(rethrow)
      return text(JSON.stringify(board))
    },
  }
}
