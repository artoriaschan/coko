// Goal Round 的发起（goal-driver.ts）：Run 没能开始时按错误码处理。模型不可用与结果确认待回答不会自然再判定，Goal 不能停在 running；
// 用户的 Run 进行中与回退、分叉进行中会在之后的 Run 结束时再判定，Goal 保持 running。
import type { GoalPayload } from '@coko/agent'
import type { SessionEntry } from '@coko/session'
import { describe, expect, it } from 'vitest'
import type { ErrorCode } from '@coko/protocol'
import { AppError } from './errors.ts'
import { GoalDriver } from './goal-driver.ts'

const goal: GoalPayload = {
  id: 'goal-1',
  revision: 1,
  objective: 'o',
  criteria: [{ id: 'c1', text: 'done' }],
  budget: { maxRounds: 5 },
  phase: 'running',
  resumedAtRound: 0,
  source: 'model',
}

function driver(error: AppError) {
  const committed: GoalPayload[] = []
  const entries: SessionEntry[] = [{ seq: 1, sessionId: 's', kind: 'goal', runId: null, payload: goal, createdAt: 0 } as unknown as SessionEntry]
  const d = new GoalDriver({
    entries: async () => entries,
    commit: async (_sessionId, next) => {
      committed.push(next)
      return next
    },
    isRunning: () => false,
    isCancelling: () => false,
    startRun: async () => {
      throw error
    },
    priced: async () => true,
  })
  return { d, committed }
}

describe('Goal Round 没能开始', () => {
  it.each([
    ['model-not-configured', 'blocked'],
    ['model-required', 'blocked'],
    ['confirmation-pending', 'waiting-input'],
  ] as const)('%s：Goal 进入 %s，reason.code 为该错误码', async (code, phase) => {
    const { d, committed } = driver(new AppError(code as ErrorCode, 'no ' + code))
    expect(await d.advance('s')).toBeUndefined()
    expect(committed).toHaveLength(1)
    expect(committed[0]).toMatchObject({ phase, reason: { code, message: 'no ' + code }, source: 'system', revision: 2 })
  })

  it.each(['run-in-progress', 'session-busy'] as const)('%s：Goal 保持 running，不提交快照', async (code) => {
    const { d, committed } = driver(new AppError(code, code))
    expect(await d.advance('s')).toBeUndefined()
    expect(committed).toEqual([])
  })
})
