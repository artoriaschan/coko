// Goal 工具（get_goal、create_goal、update_goal；参考 deepseek-harness tool-goal）。授权、转换与证据的判定在 planGoalCreate / planGoalUpdate
// （纯函数），读取条目、加锁与提交由宿主的 GoalToolPort 完成；权限类由宿主注册时给出（get_goal 为 context-read，其余为 session-state）。
// 结果为紧凑 JSON { goal: … | null }；被拒绝的调用抛出 GoalError，作为错误结果回给模型。
import { Type, type Static } from 'typebox'
import type { EntryLike } from '../entries/types.ts'
import type { GoalBudget, GoalEvidence, GoalPayload } from '../session-entries/goals.ts'
import type { CokoTool } from '../tools/types.ts'
import {
  applyGoalChange,
  createGoalSnapshot,
  expectRevision,
  GOAL_BLOCKED_MIN_ROUNDS,
  GoalError,
  validateEvidence,
  type GoalChange,
  type GoalUsageSnapshot,
  type RunAuthority,
} from './state.ts'

/** 模型看到的 Goal（工具结果）。 */
export interface GoalView {
  id: string
  revision: number
  objective: string
  constraints?: string
  criteria: { id: string; text: string }[]
  phase: GoalPayload['phase']
  reason?: { code: string; message: string }
  round: number
  maxRounds?: number
  budget: GoalBudget
  waitingFor?: { jobIds: string[] }
  evidence?: GoalEvidence[]
}

export function goalView(goal: GoalPayload | undefined, rounds: number): { goal: GoalView | null } {
  if (!goal) return { goal: null }
  return {
    goal: {
      id: goal.id,
      revision: goal.revision,
      objective: goal.objective,
      ...(goal.constraints ? { constraints: goal.constraints } : {}),
      criteria: goal.criteria,
      phase: goal.phase,
      ...(goal.reason ? { reason: goal.reason } : {}),
      round: rounds,
      ...(goal.budget.maxRounds === undefined ? {} : { maxRounds: goal.budget.maxRounds }),
      budget: goal.budget,
      ...(goal.waitingFor ? { waitingFor: goal.waitingFor } : {}),
      ...(goal.evidence ? { evidence: goal.evidence } : {}),
    },
  }
}

const budgetParameters = Type.Object(
  {
    max_rounds: Type.Optional(Type.Integer({ minimum: 1, description: 'Most automatic goal rounds (default 50)' })),
    max_tool_calls: Type.Optional(Type.Integer({ minimum: 1 })),
    max_tokens: Type.Optional(Type.Integer({ minimum: 1 })),
    max_cost: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
    max_duration_ms: Type.Optional(Type.Integer({ minimum: 1 })),
  },
  { description: 'Limits for the goal; omitted limits are not set' },
)
type BudgetArgs = Static<typeof budgetParameters>

export function budgetFromArgs(args: BudgetArgs | undefined): GoalBudget | undefined {
  if (!args) return undefined
  return {
    ...(args.max_rounds === undefined ? {} : { maxRounds: args.max_rounds }),
    ...(args.max_tool_calls === undefined ? {} : { maxToolCalls: args.max_tool_calls }),
    ...(args.max_tokens === undefined ? {} : { maxTokens: args.max_tokens }),
    ...(args.max_cost === undefined ? {} : { maxCost: args.max_cost }),
    ...(args.max_duration_ms === undefined ? {} : { maxDurationMs: args.max_duration_ms }),
  }
}

export const createGoalParameters = Type.Object({
  objective: Type.String({ description: 'The concrete objective inferred from the user request' }),
  criteria: Type.Array(Type.String(), { description: '1 to 10 checkable success criteria; the goal is complete only when each one is met' }),
  constraints: Type.Optional(Type.String({ description: 'Constraints the work must respect' })),
  budget: Type.Optional(budgetParameters),
})
export type CreateGoalArgs = Static<typeof createGoalParameters>

export const UPDATE_GOAL_ACTIONS = ['edit', 'pause', 'resume', 'complete', 'blocked', 'wait_input', 'wait_jobs'] as const
export type UpdateGoalAction = (typeof UPDATE_GOAL_ACTIONS)[number]

export const updateGoalParameters = Type.Object({
  goal_id: Type.String({ description: 'Id returned by get_goal' }),
  revision: Type.Integer({ minimum: 1, description: 'Current revision returned by get_goal' }),
  action: Type.Union(
    [
      Type.Literal('edit'),
      Type.Literal('pause'),
      Type.Literal('resume'),
      Type.Literal('complete'),
      Type.Literal('blocked'),
      Type.Literal('wait_input'),
      Type.Literal('wait_jobs'),
    ],
    {
      description:
        'edit, pause and resume need a user request in this run. complete needs evidence for every criterion. blocked needs a reason and, ' +
        `in an automatic goal round, at least ${GOAL_BLOCKED_MIN_ROUNDS} rounds since the goal was last resumed or edited. wait_input ` +
        'waits for the user; wait_jobs waits until the given running background jobs end.',
    },
  ),
  objective: Type.Optional(Type.String({ description: 'edit: replacement objective' })),
  criteria: Type.Optional(Type.Array(Type.String(), { description: 'edit: replacement success criteria (1 to 10)' })),
  constraints: Type.Optional(Type.String({ description: 'edit: replacement constraints' })),
  budget: Type.Optional(budgetParameters),
  evidence: Type.Optional(
    Type.Array(
      Type.Object({
        criterion_id: Type.String({ description: 'Criterion id (c1, c2, …)' }),
        text: Type.String({ description: 'How the criterion is met' }),
        tool_call_ids: Type.Optional(Type.Array(Type.String(), { description: 'Ids of successful tool calls that show it' })),
      }),
      { description: 'complete: one item per success criterion' },
    ),
  ),
  reason: Type.Optional(Type.String({ description: 'blocked, wait_input, wait_jobs: why' })),
  job_ids: Type.Optional(Type.Array(Type.String(), { description: 'wait_jobs: running background job ids to wait for' })),
})
export type UpdateGoalArgs = Static<typeof updateGoalParameters>

/** planGoalUpdate 需要的事实（宿主在锁内读取）。 */
export interface GoalUpdateContext {
  entries: readonly EntryLike[]
  authority: RunAuthority
  /** 当前 Goal 已开始的 Goal Round 数。 */
  rounds: number
  /** 当前 Goal 的完整用量（budget-exhausted 恢复须使耗尽的维度有余量）；省略时只按轮次判定。 */
  usage?: GoalUsageSnapshot
  /** 本 Session 中 running 的 Job。 */
  jobRunning(jobId: string): boolean
}

const reasonOf = (code: string, text: string | undefined, fallback: string) => ({ code, message: text?.trim() || fallback })

/** create_goal 的判定：只在用户提交的 Run（或送达过用户追加指令的 Run）中接受。 */
export function planGoalCreate(args: CreateGoalArgs, context: Pick<GoalUpdateContext, 'entries' | 'authority'>): GoalPayload {
  if (context.authority.kind !== 'user')
    throw new GoalError('not-authorized', 'create_goal needs a user request in this run; it is not available in automatic goal rounds')
  const budget = budgetFromArgs(args.budget)
  return createGoalSnapshot(
    context.entries,
    { objective: args.objective, criteria: args.criteria, ...(args.constraints ? { constraints: args.constraints } : {}), ...(budget ? { budget } : {}) },
    'model',
  )
}

/**
 * update_goal 的判定（规格的授权规则）：edit、pause、resume 需要 user；complete、blocked、wait_input、wait_jobs 需要 user 或本 Goal 的
 * Goal Round；Goal Round 中的 blocked 须自 resumedAtRound 起至少 3 轮；revision 过期为 revision-conflict。返回下一份快照。
 */
export function planGoalUpdate(goal: GoalPayload | undefined, args: UpdateGoalArgs, context: GoalUpdateContext): GoalPayload {
  if (!goal || goal.id !== args.goal_id) throw new GoalError('not-found', `No current goal ${args.goal_id}; read it with get_goal`)
  expectRevision(goal, args.revision)
  const { authority, rounds } = context
  const user = authority.kind === 'user'
  const ownRound = authority.kind === 'goal-round' && authority.goalId === goal.id
  const need = (ok: boolean, what: string) => {
    if (!ok) throw new GoalError('not-authorized', what)
  }
  let change: GoalChange
  switch (args.action) {
    case 'edit': {
      need(user, 'edit needs a user request in this run')
      const budget = budgetFromArgs(args.budget)
      if (args.objective === undefined && args.criteria === undefined && args.constraints === undefined && budget === undefined)
        throw new GoalError('invalid-argument', 'edit needs objective, criteria, constraints or budget')
      change = {
        type: 'edit',
        ...(args.objective === undefined ? {} : { objective: args.objective }),
        ...(args.criteria === undefined ? {} : { criteria: args.criteria }),
        ...(args.constraints === undefined ? {} : { constraints: args.constraints }),
        ...(budget ? { budget } : {}),
      }
      break
    }
    case 'pause':
      need(user, 'pause needs a user request in this run')
      change = { type: 'pause', reason: reasonOf('model-paused', args.reason, 'Paused at the user request') }
      break
    case 'resume':
      need(user, 'resume needs a user request in this run')
      change = { type: 'resume' }
      break
    case 'complete': {
      need(user || ownRound, 'complete needs a user request or an automatic round of this goal')
      change = { type: 'complete', by: 'model', evidence: validateEvidence(goal, args.evidence?.map(toEvidence), context.entries) }
      break
    }
    case 'blocked': {
      need(user || ownRound, 'blocked needs a user request or an automatic round of this goal')
      if (!args.reason?.trim()) throw new GoalError('invalid-argument', 'blocked needs a reason')
      if (!user && authority.kind === 'goal-round' && authority.round - goal.resumedAtRound < GOAL_BLOCKED_MIN_ROUNDS)
        throw new GoalError(
          'not-authorized',
          `blocked needs at least ${GOAL_BLOCKED_MIN_ROUNDS} goal rounds since the goal was last resumed or edited (round ${authority.round}, since round ${goal.resumedAtRound})`,
        )
      change = { type: 'block', reason: reasonOf('model-blocked', args.reason, '') }
      break
    }
    case 'wait_input':
      need(user || ownRound, 'wait_input needs a user request or an automatic round of this goal')
      change = { type: 'wait-input', reason: reasonOf('needs-input', args.reason, 'Waiting for the user') }
      break
    case 'wait_jobs': {
      need(user || ownRound, 'wait_jobs needs a user request or an automatic round of this goal')
      const jobIds = [...new Set(args.job_ids ?? [])]
      if (jobIds.length === 0) throw new GoalError('invalid-argument', 'wait_jobs needs job_ids')
      for (const id of jobIds) if (!context.jobRunning(id)) throw new GoalError('invalid-argument', `Background job ${id} is not running in this session`)
      change = { type: 'wait-jobs', jobIds, reason: reasonOf('waiting-jobs', args.reason, 'Waiting for background jobs ' + jobIds.join(', ')) }
      break
    }
  }
  return applyGoalChange(goal, change, 'model', context.usage ?? rounds)
}

const toEvidence = (item: NonNullable<UpdateGoalArgs['evidence']>[number]): GoalEvidence => ({
  criterionId: item.criterion_id,
  text: item.text,
  ...(item.tool_call_ids ? { toolCallIds: item.tool_call_ids } : {}),
})

/** 宿主的 Goal 存取：在锁内读取、判定（planGoalCreate / planGoalUpdate）并提交，返回提交后的视图。 */
export interface GoalToolPort {
  get(): Promise<{ goal: GoalView | null }>
  create(args: CreateGoalArgs): Promise<{ goal: GoalView | null }>
  update(args: UpdateGoalArgs): Promise<{ goal: GoalView | null }>
}

const json = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }], details: undefined })

export function createGetGoalTool(port: GoalToolPort): CokoTool<ReturnType<typeof Type.Object>, undefined> {
  return {
    name: 'get_goal',
    label: 'get_goal',
    description: 'Read the current goal of this session, including the id and revision that update_goal needs.',
    parameters: Type.Object({}),
    effect: 'read',
    execute: async () => json(await port.get()),
  }
}

export function createCreateGoalTool(port: GoalToolPort): CokoTool<typeof createGoalParameters, undefined> {
  return {
    name: 'create_goal',
    label: 'create_goal',
    description:
      'Create a goal that Coko keeps working on across automatic goal rounds, with checkable success criteria. Use it when the user asks ' +
      'for a long-running objective (or uses /goal); not for single-step work. Only one unfinished goal per session. Automatic rounds ' +
      'are capped only by max_rounds unless you set other limits: for long or open-ended work, set budget.max_cost (and max_tokens or ' +
      'max_duration_ms when the user gives one).',
    parameters: createGoalParameters,
    effect: 'side-effect',
    execute: async (_id, args) => json(await port.create(args)),
  }
}

export function createUpdateGoalTool(port: GoalToolPort): CokoTool<typeof updateGoalParameters, undefined> {
  return {
    name: 'update_goal',
    label: 'update_goal',
    description: 'Update the current goal: edit, pause, resume, complete (with evidence), blocked, wait_input or wait_jobs.',
    parameters: updateGoalParameters,
    effect: 'side-effect',
    execute: async (_id, args) => json(await port.update(args)),
  }
}
