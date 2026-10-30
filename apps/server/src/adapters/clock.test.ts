import { describe, expect, it } from 'vitest'
import { createTestClock, systemClock } from './clock.ts'

describe('测试时钟', () => {
  it('拨快时按到期顺序触发，取消的不触发；不能倒退', () => {
    const clock = createTestClock(1_000)
    const fired: string[] = []
    clock.setTimer(3_000, () => fired.push('c'))
    clock.setTimer(2_000, () => fired.push('b'))
    const cancel = clock.setTimer(2_500, () => fired.push('x'))
    cancel()
    expect(clock.advance(500)).toBe(1_500)
    expect(fired).toEqual([])
    expect(clock.set(3_000)).toBe(3_000)
    expect(fired).toEqual(['b', 'c'])
    expect(clock.pending).toBe(0)
    expect(() => clock.set(2_000)).toThrow('The test clock cannot move backwards')
    expect(clock.now()).toBe(3_000)
  })

  it('触发时登记的已到期计时器在同一次拨快中触发', () => {
    const clock = createTestClock(0)
    const fired: number[] = []
    clock.setTimer(10, () => {
      fired.push(clock.now())
      clock.setTimer(5, () => fired.push(-1))
    })
    clock.advance(20)
    expect(fired).toEqual([20, -1])
  })

  it('已过期的计时器不在 setTimer 中同步触发', async () => {
    const clock = createTestClock(100)
    let fired = false
    clock.setTimer(50, () => (fired = true))
    expect(fired).toBe(false)
    await Promise.resolve()
    expect(fired).toBe(true)
  })
})

describe('系统时钟', () => {
  it('到期触发，取消后不触发', async () => {
    const clock = systemClock()
    const fired = await new Promise<boolean>((resolve) => clock.setTimer(clock.now() + 5, () => resolve(true)))
    expect(fired).toBe(true)
    let late = false
    const cancel = clock.setTimer(clock.now() + 5, () => (late = true))
    cancel()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(late).toBe(false)
  })
})
