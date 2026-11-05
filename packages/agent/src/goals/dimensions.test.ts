// 预算维度的描述表：每个维度都有预算字段、用量字段、名称与格式；耗尽判定、预算消息与 <goal> section 都取自它（新增维度只改描述表）。
import { describe, expect, it } from 'vitest'
import { goalBudgetSchema, type GoalPayload } from '../session-entries/goals.ts'
import {
  budgetLimit,
  createCreateGoalTool,
  budgetUsed,
  exhaustedDimension,
  exhaustedMessage,
  GOAL_BUDGET_DIMENSION_KEYS,
  GOAL_BUDGET_DIMENSIONS,
  GOAL_BUDGET_EXHAUSTED_PREFIX,
  goalSection,
  goalStateValue,
  type GoalUsageSnapshot,
} from './index.ts'

const USAGE_FIELDS: readonly (keyof GoalUsageSnapshot)[] = ['rounds', 'toolCalls', 'tokens', 'cost', 'durationMs']

const goal = (budget: GoalPayload['budget']): GoalPayload => ({
  id: 'goal-1',
  revision: 1,
  objective: 'o',
  criteria: [{ id: 'c1', text: 'c' }],
  budget,
  phase: 'running',
  resumedAtRound: 0,
  source: 'model',
})

describe('GOAL_BUDGET_DIMENSIONS', () => {
  it('键即判定顺序', () => {
    expect(GOAL_BUDGET_DIMENSION_KEYS).toEqual(['rounds', 'tool-calls', 'tokens', 'cost', 'time'])
  })

  it('每个预算字段恰好对应一个维度', () => {
    const limits = GOAL_BUDGET_DIMENSION_KEYS.map((d) => GOAL_BUDGET_DIMENSIONS[d].limit)
    expect([...limits].sort()).toEqual(Object.keys(goalBudgetSchema.properties).sort())
    expect(new Set(GOAL_BUDGET_DIMENSION_KEYS.map((d) => GOAL_BUDGET_DIMENSIONS[d].used)).size).toBe(GOAL_BUDGET_DIMENSION_KEYS.length)
  })

  it.each(GOAL_BUDGET_DIMENSION_KEYS)('%s：limit / used / 名称 / 格式齐全，判定、消息与 section 都用它', (dimension) => {
    const spec = GOAL_BUDGET_DIMENSIONS[dimension]
    expect(Object.keys(goalBudgetSchema.properties)).toContain(spec.limit)
    expect(USAGE_FIELDS).toContain(spec.used)
    expect(spec.name).toMatch(/\S/)
    expect(spec.format(3)).toMatch(/3/)

    const budget = { [spec.limit]: 3 }
    const usage: GoalUsageSnapshot = { rounds: 0, [spec.used]: 3 }
    expect(budgetLimit(budget, dimension)).toBe(3)
    expect(budgetUsed(usage, dimension)).toBe(3)
    expect(exhaustedDimension(budget, usage, [dimension])).toBe(dimension)
    expect(exhaustedDimension(budget, { rounds: 0, [spec.used]: 2 }, [dimension])).toBeUndefined()
    expect(exhaustedMessage(dimension, budget, usage)).toBe(`${GOAL_BUDGET_EXHAUSTED_PREFIX}${spec.name} (${spec.format(3)} / ${spec.format(3)})`)
    expect(goalSection(goal(budget))!.text).toContain(`- ${spec.name}: limit ${spec.format(3)}`)
    expect(goalStateValue(goal(budget), usage)).toMatchObject({ usage: { [spec.used]: 3 }, budget: { [spec.limit]: 3 } })
  })

  it('create_goal 的描述建议长任务设 max_cost（缺省只有轮次上限）', () => {
    const port = { get: async () => ({ goal: null }), create: async () => ({ goal: null }), update: async () => ({ goal: null }) }
    expect(createCreateGoalTool(port).description).toMatch(/max_cost/)
  })

  it('未知维度：消息只带前缀与原文', () => {
    expect(exhaustedMessage('budget', {}, { rounds: 0 })).toBe(GOAL_BUDGET_EXHAUSTED_PREFIX + 'budget')
    expect(exhaustedMessage('toString', {}, { rounds: 0 })).toBe(GOAL_BUDGET_EXHAUSTED_PREFIX + 'toString')
  })
})
