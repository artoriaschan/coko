// Goal 的状态机（ADR 0011，docs/subsystems/goal.md）：快照与 revision、九阶段的转换表、创建与编辑的校验、完成证据与 Run 的授权。
// 全部是纯函数：输入当前快照与条目（EntryLike），输出下一份快照或抛出 GoalError；宿主（apps/server application/goals.ts）负责加锁与提交。
import type { EntryLike } from '../entries/types.ts'
import type { GoalBudget, GoalCriterion, GoalEvidence, GoalPayload, GoalPhase } from '../session-entries/goals.ts'

export type GoalSource = GoalPayload['source']

/** 缺省轮次上限；其余维度缺省不设。 */
export const GOAL_DEFAULT_MAX_ROUNDS = 50
/** Goal Round 中模型报告 blocked 前，自上次恢复或编辑起至少经过的 Goal Round 数。 */
export const GOAL_BLOCKED_MIN_ROUNDS = 3
export const GOAL_OBJECTIVE_MAX = 4_000
export const GOAL_CRITERION_MAX = 500
export const GOAL_CRITERIA_MAX = 10
export const GOAL_TEXT_MAX = 2_000

export type GoalErrorCode =
  /** 参数不合规则（缺条件、证据不完整、引用的调用不存在或出错等）。 */
  | 'invalid-argument'
  /** 给出的 revision 不是当前 revision。 */
  | 'revision-conflict'
  /** 当前阶段不允许该动作。 */
  | 'invalid-transition'
  /** 本 Run 没有该动作需要的授权（例如 Goal Round 中的 create / edit / pause / resume）。 */
  | 'not-authorized'
  /** 没有 Goal，或 goal_id 不是当前 Goal。 */
  | 'not-found'
  /** 已有未终结的 Goal。 */
  | 'already-exists'

export class GoalError extends Error {
  override readonly name = 'GoalError'
  readonly code: GoalErrorCode
  readonly details: Record<string, unknown> | undefined
  constructor(code: GoalErrorCode, message: string, details?: Record<string, unknown>) {
    super(message)
    this.code = code
    this.details = details
  }
}

export const isTerminalPhase = (phase: GoalPhase) => phase === 'complete' || phase === 'cancelled'
/** 推进中的阶段：running 与两个 waiting（重启时暂停的就是它们）。 */
export const isActivePhase = (phase: GoalPhase) => phase === 'running' || phase === 'waiting-input' || phase === 'waiting-external'

/** 一次变化（不含 revision 与 source，由 applyGoalChange 统一处理）。 */
export type GoalChange =
  | { type: 'pause'; reason: { code: string; message: string } }
  | { type: 'resume' }
  | { type: 'edit'; objective?: string; constraints?: string; criteria?: readonly string[]; budget?: GoalBudget }
  | { type: 'complete'; by: 'model' | 'user'; evidence?: GoalEvidence[] }
  | { type: 'cancel'; cleanup: { runsAborted: number; jobsKilled: number; failures: string[] } }
  | { type: 'block'; reason: { code: string; message: string } }
  | { type: 'wait-input'; reason: { code: string; message: string } }
  | { type: 'wait-jobs'; jobIds: string[]; reason: { code: string; message: string } }
  /** waiting-input / waiting-external → running（用户回答之后的 Run 结束、等待的 Job 全部结束）。 */
  | { type: 'wake' }
  | { type: 'fail'; reason: { code: string; message: string } }
  | { type: 'exhaust'; reason: { code: string; message: string } }

/** 每种变化允许的出发阶段（规格的转换表；未列出的组合是 invalid-transition）。 */
export const GOAL_TRANSITIONS: Record<GoalChange['type'], readonly GoalPhase[]> = {
  pause: ['running', 'waiting-input', 'waiting-external'],
  resume: ['paused', 'blocked', 'failed', 'budget-exhausted'],
  edit: ['running', 'waiting-input', 'waiting-external', 'paused', 'blocked', 'failed', 'budget-exhausted'],
  complete: ['running', 'waiting-input', 'waiting-external', 'paused', 'blocked', 'failed', 'budget-exhausted'],
  cancel: ['running', 'waiting-input', 'waiting-external', 'paused', 'blocked', 'failed', 'budget-exhausted'],
  block: ['running'],
  'wait-input': ['running'],
  'wait-jobs': ['running'],
  wake: ['waiting-input', 'waiting-external'],
  fail: ['running'],
  exhaust: ['running'],
}

/**
 * 已用量（ADR 0011：从条目派生，见 budget.ts 的 goalUsage）。rounds 总是派生；其余维度省略时不参与判定（只有轮次的调用方）。
 */
export interface GoalUsageSnapshot {
  rounds: number
  toolCalls?: number
  tokens?: number
  /** usage.cost.total 之和（显示货币由设置 usage.currency 决定，不换算）。 */
  cost?: number
  durationMs?: number
}

/** 模型可见文本中的费用（<goal> section 与预算消息）：最多 6 位小数，去掉末尾的 0，不带货币。界面的费用格式在 renderer。 */
export const costText = (cost: number) => String(Number(cost.toFixed(6)))

/** 一个预算维度：预算字段、用量字段、模型可见的名称与数值格式。 */
export interface GoalBudgetDimensionSpec {
  limit: keyof GoalBudget
  used: keyof GoalUsageSnapshot
  /** 模型可见文本中的名称（预算消息与 <goal> section）。 */
  name: string
  /** 模型可见文本中的数值。 */
  format: (value: number) => string
}

/**
 * 预算维度的描述表（维度映射的唯一来源；键为 reason.code 的取值，顺序即判定顺序）。新增维度只改这里与预算 / 用量的 schema；
 * 协议的 GOAL_BUDGET_DIMENSION_KEYS 与本表的键相同（server goals.ts 中有编译期断言）。
 */
export const GOAL_BUDGET_DIMENSIONS = {
  rounds: { limit: 'maxRounds', used: 'rounds', name: 'rounds', format: String },
  'tool-calls': { limit: 'maxToolCalls', used: 'toolCalls', name: 'tool calls', format: String },
  tokens: { limit: 'maxTokens', used: 'tokens', name: 'tokens', format: String },
  cost: { limit: 'maxCost', used: 'cost', name: 'cost', format: costText },
  time: { limit: 'maxDurationMs', used: 'durationMs', name: 'time', format: (ms) => ms + ' ms' },
} as const satisfies Record<string, GoalBudgetDimensionSpec>
export type GoalBudgetDimension = keyof typeof GOAL_BUDGET_DIMENSIONS
/** 判定顺序的维度键。 */
export const GOAL_BUDGET_DIMENSION_KEYS = Object.keys(GOAL_BUDGET_DIMENSIONS) as GoalBudgetDimension[]

const isDimension = (value: string): value is GoalBudgetDimension => Object.hasOwn(GOAL_BUDGET_DIMENSIONS, value)

/** 该维度的上限；未设时 undefined。 */
export const budgetLimit = (budget: GoalBudget, dimension: GoalBudgetDimension): number | undefined => budget[GOAL_BUDGET_DIMENSIONS[dimension].limit]
/** 该维度的已用量；用量中省略时 undefined。 */
export const budgetUsed = (usage: GoalUsageSnapshot, dimension: GoalBudgetDimension): number | undefined => usage[GOAL_BUDGET_DIMENSIONS[dimension].used]

/** 预算停止的消息前缀（run_end.error.message、工具调用上限拦下的调用结果）。 */
export const GOAL_BUDGET_EXHAUSTED_PREFIX = 'Goal budget exhausted: '

/** 该 Goal 已开始的 Goal Round 数（run_start 中 goal.goalId 为它的条目的最大 round）。 */
export function goalRounds(entries: readonly EntryLike[], goalId: string): number {
  let max = 0
  for (const entry of entries) {
    if (entry.kind !== 'run_start') continue
    const goal = (entry.payload as { goal?: { goalId: string; round: number } }).goal
    if (goal?.goalId === goalId && goal.round > max) max = goal.round
  }
  return max
}

/** 当前 Goal：该 Session 最新的 goal 条目（不随回退改变）；没有时 undefined。 */
export function currentGoal(entries: readonly EntryLike[]): GoalPayload | undefined {
  for (let i = entries.length - 1; i >= 0; i--) if (entries[i]!.kind === 'goal') return entries[i]!.payload as GoalPayload
  return undefined
}

/** 新 Goal 的 id：本 Session 的第 n 个 Goal 为 goal-n（只需在 Session 内唯一；可预测便于模型与脚本引用）。 */
export function nextGoalId(entries: readonly EntryLike[]): string {
  const ids = new Set<string>()
  for (const entry of entries) if (entry.kind === 'goal') ids.add((entry.payload as GoalPayload).id)
  let n = ids.size + 1
  while (ids.has('goal-' + n)) n++
  return 'goal-' + n
}

/**
 * 已设维度中第一个达到上限（已用 ≥ 上限）的维度（reason.code）；都有余量时 undefined。dimensions 限定检查的维度（检查点各查各的：
 * 模型请求前查 Token、费用、时间，工具调用前查调用数，Goal Round 开始前查五维）；用量中省略的维度不判定。
 */
export function exhaustedDimension(
  budget: GoalBudget,
  usage: GoalUsageSnapshot,
  dimensions: readonly GoalBudgetDimension[] = GOAL_BUDGET_DIMENSION_KEYS,
): GoalBudgetDimension | undefined {
  for (const dimension of GOAL_BUDGET_DIMENSION_KEYS) {
    if (!dimensions.includes(dimension)) continue
    const limit = budgetLimit(budget, dimension)
    const used = budgetUsed(usage, dimension)
    if (limit !== undefined && used !== undefined && used >= limit) return dimension
  }
  return undefined
}

/** 形如 "Goal budget exhausted: tool calls (n / max)"；名称与数值格式取自描述表（时间带 ms）。 */
export function exhaustedMessage(dimension: string, budget: GoalBudget, usage: GoalUsageSnapshot): string {
  if (!isDimension(dimension)) return GOAL_BUDGET_EXHAUSTED_PREFIX + dimension
  const { name, format } = GOAL_BUDGET_DIMENSIONS[dimension]
  return `${GOAL_BUDGET_EXHAUSTED_PREFIX}${name} (${format(budgetUsed(usage, dimension) ?? 0)} / ${format(budgetLimit(budget, dimension) ?? 0)})`
}

/** 设了费用上限而当前模型未定价：不发请求，Goal 进入 blocked（cost-unpriced）。 */
export const COST_UNPRICED_MESSAGE = 'The goal has a cost limit, but the current model has no price; set a price in Settings → Models or remove the cost limit'

const trimmed = (value: string, what: string, max: number) => {
  const text = value.trim()
  if (text === '') throw new GoalError('invalid-argument', what + ' is empty')
  if (text.length > max) throw new GoalError('invalid-argument', `${what} exceeds ${max} characters`)
  return text
}

/** 成功条件：1–10 条、去掉首尾空白、非空、不重复；id 按位置为 c1…。 */
export function normalizeCriteria(texts: readonly string[]): GoalCriterion[] {
  if (texts.length < 1 || texts.length > GOAL_CRITERIA_MAX)
    throw new GoalError('invalid-argument', `A goal needs 1 to ${GOAL_CRITERIA_MAX} success criteria (got ${texts.length})`)
  const seen = new Set<string>()
  return texts.map((raw, index) => {
    const text = trimmed(raw, 'Criterion ' + (index + 1), GOAL_CRITERION_MAX)
    if (seen.has(text)) throw new GoalError('invalid-argument', 'Duplicate criterion: ' + JSON.stringify(text))
    seen.add(text)
    return { id: 'c' + (index + 1), text }
  })
}

/** 预算：每维为正（轮次、工具调用、Token、时间为整数）；maxRounds 省略时为缺省 50。 */
export function normalizeBudget(budget: GoalBudget | undefined): GoalBudget {
  const out: GoalBudget = {}
  const integer = (key: 'maxRounds' | 'maxToolCalls' | 'maxTokens' | 'maxDurationMs') => {
    const value = budget?.[key]
    if (value === undefined) return
    if (!Number.isSafeInteger(value) || value < 1) throw new GoalError('invalid-argument', key + ' must be a positive integer')
    out[key] = value
  }
  integer('maxRounds')
  integer('maxToolCalls')
  integer('maxTokens')
  if (budget?.maxCost !== undefined) {
    if (!Number.isFinite(budget.maxCost) || budget.maxCost <= 0) throw new GoalError('invalid-argument', 'maxCost must be a positive number')
    out.maxCost = budget.maxCost
  }
  integer('maxDurationMs')
  out.maxRounds ??= GOAL_DEFAULT_MAX_ROUNDS
  return out
}

export interface GoalCreateInput {
  objective: string
  criteria: readonly string[]
  constraints?: string
  budget?: GoalBudget
}

/** 新 Goal 的第一份快照（running，revision 1）；已有未终结的 Goal 时 already-exists。 */
export function createGoalSnapshot(entries: readonly EntryLike[], input: GoalCreateInput, source: GoalSource): GoalPayload {
  const current = currentGoal(entries)
  if (current && !isTerminalPhase(current.phase))
    throw new GoalError('already-exists', `Goal ${current.id} is ${current.phase}; complete or cancel it before creating a new one`, { goal: current.id })
  const constraints = input.constraints?.trim()
  return {
    id: nextGoalId(entries),
    revision: 1,
    objective: trimmed(input.objective, 'objective', GOAL_OBJECTIVE_MAX),
    ...(constraints ? { constraints: trimmed(constraints, 'constraints', GOAL_TEXT_MAX) } : {}),
    criteria: normalizeCriteria(input.criteria),
    budget: normalizeBudget(input.budget),
    phase: 'running',
    resumedAtRound: 0,
    source,
  }
}

/** 给出的 revision 必须是当前 revision。 */
export function expectRevision(goal: GoalPayload, revision: number): void {
  if (revision !== goal.revision)
    throw new GoalError('revision-conflict', `Goal ${goal.id} is at revision ${goal.revision}, not ${revision}; read it again with get_goal`, {
      expected: revision,
      actual: goal.revision,
    })
}

/**
 * 按转换表应用一次变化，返回下一份快照（revision 加一）。used 为该 Goal 已开始的 Goal Round 数或完整用量：resume 与 edit 把 resumedAtRound
 * 设为其轮次；budget-exhausted 恢复前须使耗尽的维度有余量（只给轮次时只检查轮次）。进入 running 时清除 reason、waitingFor；离开 waiting-external 时清除 waitingFor。
 */
export function applyGoalChange(goal: GoalPayload, change: GoalChange, source: GoalSource, used: number | GoalUsageSnapshot): GoalPayload {
  const usage: GoalUsageSnapshot = typeof used === 'number' ? { rounds: used } : used
  const rounds = usage.rounds
  if (isTerminalPhase(goal.phase)) throw new GoalError('invalid-transition', `Goal ${goal.id} is already ${goal.phase}`, { phase: goal.phase })
  if (!GOAL_TRANSITIONS[change.type].includes(goal.phase))
    throw new GoalError('invalid-transition', `Cannot ${change.type} a goal that is ${goal.phase}`, { phase: goal.phase, action: change.type })
  const { reason: _reason, waitingFor: _waitingFor, ...base } = goal
  const next = { ...base, revision: goal.revision + 1, source } as GoalPayload
  const enter = (phase: GoalPhase, reason?: { code: string; message: string }): GoalPayload => ({ ...next, phase, ...(reason ? { reason } : {}) })
  switch (change.type) {
    case 'pause':
      return enter('paused', change.reason)
    case 'resume': {
      if (goal.phase === 'budget-exhausted') {
        const dimension = exhaustedDimension(goal.budget, usage)
        if (dimension)
          throw new GoalError('invalid-transition', `Raise the ${dimension} budget before resuming: ${exhaustedMessage(dimension, goal.budget, usage)}`, {
            phase: goal.phase,
            dimension,
          })
      }
      return { ...enter('running'), resumedAtRound: rounds }
    }
    case 'edit': {
      const objective = change.objective === undefined ? goal.objective : trimmed(change.objective, 'objective', GOAL_OBJECTIVE_MAX)
      const constraints = change.constraints === undefined ? goal.constraints : change.constraints.trim() || undefined
      const { constraints: _c, ...rest } = next
      return {
        ...rest,
        objective,
        ...(constraints ? { constraints: trimmed(constraints, 'constraints', GOAL_TEXT_MAX) } : {}),
        criteria: change.criteria === undefined ? goal.criteria : normalizeCriteria(change.criteria),
        budget: change.budget === undefined ? goal.budget : normalizeBudget(change.budget),
        phase: goal.phase,
        ...(goal.reason ? { reason: goal.reason } : {}),
        ...(goal.waitingFor ? { waitingFor: goal.waitingFor } : {}),
        resumedAtRound: rounds,
      }
    }
    case 'complete':
      return { ...enter('complete'), completedBy: change.by, ...(change.evidence ? { evidence: change.evidence } : {}) }
    case 'cancel':
      return { ...enter('cancelled', { code: 'user-cancelled', message: 'Cancelled by the user' }), cleanup: change.cleanup }
    case 'block':
      return enter('blocked', change.reason)
    case 'wait-input':
      return enter('waiting-input', change.reason)
    case 'wait-jobs':
      return { ...enter('waiting-external', change.reason), waitingFor: { jobIds: change.jobIds } }
    case 'wake':
      return enter('running')
    case 'fail':
      return enter('failed', change.reason)
    case 'exhaust':
      return enter('budget-exhausted', change.reason)
  }
}

/** 本 Session 已提交、未出错的工具结果的 toolCallId。 */
function successfulToolCalls(entries: readonly EntryLike[]): Set<string> {
  const ids = new Set<string>()
  for (const entry of entries) {
    if (entry.kind !== 'message') continue
    const m = entry.payload as { role?: string; toolCallId?: string; isError?: boolean }
    if (m.role === 'toolResult' && m.toolCallId && m.isError === false) ids.add(m.toolCallId)
  }
  return ids
}

/**
 * 完成证据：每条成功条件恰好一条、text 非空、没有未知的 criterionId；toolCallIds 中的每个 id 都是本 Session 已提交且 isError 为 false 的
 * toolResult。返回规范化后的证据（按条件顺序，text 去掉首尾空白，空的 toolCallIds 省略）。
 */
export function validateEvidence(goal: GoalPayload, evidence: readonly GoalEvidence[] | undefined, entries: readonly EntryLike[]): GoalEvidence[] {
  if (!evidence || evidence.length === 0) throw new GoalError('invalid-argument', 'complete needs evidence for every success criterion')
  const byId = new Map<string, GoalEvidence>()
  for (const item of evidence) {
    if (!goal.criteria.some((c) => c.id === item.criterionId))
      throw new GoalError('invalid-argument', 'Evidence references unknown criterion ' + item.criterionId)
    if (byId.has(item.criterionId)) throw new GoalError('invalid-argument', 'Duplicate evidence for criterion ' + item.criterionId)
    byId.set(item.criterionId, item)
  }
  const tools = successfulToolCalls(entries)
  return goal.criteria.map((criterion) => {
    const item = byId.get(criterion.id)
    if (!item) throw new GoalError('invalid-argument', `Missing evidence for criterion ${criterion.id}: ${criterion.text}`)
    const text = item.text.trim()
    if (text === '') throw new GoalError('invalid-argument', 'Evidence for criterion ' + criterion.id + ' is empty')
    if (text.length > GOAL_TEXT_MAX) throw new GoalError('invalid-argument', `Evidence for criterion ${criterion.id} exceeds ${GOAL_TEXT_MAX} characters`)
    const ids = [...new Set(item.toolCallIds ?? [])]
    for (const id of ids)
      if (!tools.has(id))
        throw new GoalError('invalid-argument', `Evidence for criterion ${criterion.id} cites tool call ${id}, which has no successful result in this session`)
    return { criterionId: criterion.id, text, ...(ids.length > 0 ? { toolCallIds: ids } : {}) }
  })
}

/**
 * 进行中的 Run 给 Goal 工具的授权：user（用户提交的 Run，或本 Run 送达过用户的追加指令）、goal-round（某 Goal 的第 n 轮）或 none
 * （continue、retry 且没有用户的追加指令；schedule、subagent、handoff 的 Run 总是 none）。
 */
export type RunAuthority = { kind: 'user' } | { kind: 'goal-round'; goalId: string; round: number } | { kind: 'none' }

/**
 * 从条目判定最后一个未结束的 Run 的授权：trigger submit 为 user；之后送达的 user message 中有一条不是宿主的通知（前一条不是
 * job_notification）时同样为 user。没有进行中的 Run 时 none。
 */
const UNATTENDED_TRIGGERS: ReadonlySet<string> = new Set(['schedule', 'subagent', 'handoff'])

export function runAuthority(entries: readonly EntryLike[]): RunAuthority {
  let start = -1
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]!
    if (entry.kind === 'run_end') return { kind: 'none' }
    if (entry.kind === 'run_start') {
      start = i
      break
    }
  }
  if (start < 0) return { kind: 'none' }
  const payload = entries[start]!.payload as { trigger: string; goal?: { goalId: string; round: number } }
  if (payload.trigger === 'submit') return { kind: 'user' }
  // 无人值守（定时任务）与宿主派生（子 Session、交接）的 Run：之后送达的消息也不授予用户的权限（输入可能由命令输出或模型构造）。
  if (UNATTENDED_TRIGGERS.has(payload.trigger)) return { kind: 'none' }
  // submit 与 goal 的第一条 user message 是该 Run 的输入（goal 为宿主生成的 <goal_round>）；其余的是送达的追加指令。
  let skipFirst = payload.trigger === 'goal'
  for (let i = start + 1; i < entries.length; i++) {
    const entry = entries[i]!
    if (entry.kind !== 'message' || (entry.payload as { role?: string }).role !== 'user') continue
    if (skipFirst) {
      skipFirst = false
      continue
    }
    if (entries[i - 1]?.kind !== 'job_notification') return { kind: 'user' }
  }
  if (payload.trigger === 'goal' && payload.goal) return { kind: 'goal-round', goalId: payload.goal.goalId, round: payload.goal.round }
  return { kind: 'none' }
}
