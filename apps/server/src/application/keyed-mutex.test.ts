// KeyedMutex：同一 key 的任务串行、不同 key 并行；任务抛错后锁释放；全部完成后不留下 key。交叠位置由 deferred promise 确定。
import { describe, expect, it } from 'vitest'
import { KeyedMutex } from './keyed-mutex.ts'

function deferred<T = void>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** 让已排队的 then 回调都执行完。 */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('KeyedMutex', () => {
  it('同一 key：前一个任务结束之前后一个不开始', async () => {
    const mutex = new KeyedMutex()
    const first = deferred()
    const order: string[] = []
    const a = mutex.run('s1', async () => {
      order.push('a:start')
      await first.promise
      order.push('a:end')
      return 'a'
    })
    const b = mutex.run('s1', async () => {
      order.push('b:start')
      return 'b'
    })
    await settle()
    expect(order).toEqual(['a:start'])
    first.resolve()
    expect(await Promise.all([a, b])).toEqual(['a', 'b'])
    expect(order).toEqual(['a:start', 'a:end', 'b:start'])
  })

  it('不同 key：互不等待', async () => {
    const mutex = new KeyedMutex()
    const held = deferred()
    const order: string[] = []
    const a = mutex.run('s1', async () => {
      order.push('s1:start')
      await held.promise
    })
    const b = mutex.run('s2', async () => {
      order.push('s2:start')
    })
    await b
    expect(order).toEqual(['s1:start', 's2:start'])
    held.resolve()
    await a
  })

  it('任务抛错：调用方收到该错误，同一 key 的下一个任务照常执行', async () => {
    const mutex = new KeyedMutex()
    const failing = deferred()
    const a = mutex.run('s1', () => failing.promise)
    const b = mutex.run('s1', async () => 'after')
    failing.reject(new Error('boom'))
    await expect(a).rejects.toThrow('boom')
    expect(await b).toBe('after')
  })

  it('全部完成后不留下 key（包括抛错的任务）', async () => {
    const mutex = new KeyedMutex()
    const held = deferred()
    const a = mutex.run('s1', () => held.promise)
    const b = mutex.run('s2', async () => {
      throw new Error('x')
    })
    await b.catch(() => undefined)
    await settle()
    expect(mutex.size).toBe(1)
    held.resolve()
    await a
    await settle()
    expect(mutex.size).toBe(0)
  })
})
