import { describe, expect, it } from 'vitest'
import { QuitCoordinator } from './quit-coordinator.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

describe('QuitCoordinator', () => {
  it('sidecar 未就绪或没有活动 Run 时直接退出，不询问', async () => {
    const asked: unknown[] = []
    const none = new QuitCoordinator({ inspect: undefined, confirm: async (r) => (asked.push(r), false) })
    await expect(none.decide()).resolves.toBe(true)
    const idle = new QuitCoordinator({ inspect: async () => 0, confirm: async (r) => (asked.push(r), false) })
    await expect(idle.decide()).resolves.toBe(true)
    expect(asked).toEqual([])
  })

  it('有活动 Run 时按用户选择；询问失败或超时按"可能有活动 Run"询问', async () => {
    const asked: unknown[] = []
    const busy = new QuitCoordinator({ inspect: async () => 2, confirm: async (r) => (asked.push(r), false) })
    await expect(busy.decide()).resolves.toBe(false)
    const unknown = new QuitCoordinator({ inspect: async () => Promise.reject(new Error('timed out')), confirm: async (r) => (asked.push(r), true) })
    await expect(unknown.decide()).resolves.toBe(true)
    expect(asked).toEqual([{ activeRuns: 2 }, { activeRuns: 'unknown' }])
  })

  it('确认框打开期间重复的退出请求合并为同一次决定', async () => {
    const answer = deferred<boolean>()
    let confirms = 0
    const coordinator = new QuitCoordinator({
      inspect: async () => 1,
      confirm: () => {
        confirms++
        return answer.promise
      },
    })
    const first = coordinator.decide()
    const second = coordinator.decide()
    answer.resolve(true)
    await expect(Promise.all([first, second])).resolves.toEqual([true, true])
    expect(confirms).toBe(1)
    // 决定结束后再次请求重新询问。
    const third = coordinator.decide()
    await expect(third).resolves.toBe(true)
    expect(confirms).toBe(2)
  })
})
