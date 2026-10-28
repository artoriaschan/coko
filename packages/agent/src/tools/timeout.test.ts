import { Type } from 'typebox'
import { describe, expect, it, vi } from 'vitest'
import { withTimeout } from './timeout.ts'
import type { CokoTool } from './types.ts'

function tool(execute: CokoTool['execute'], timeoutMs?: number): CokoTool {
  return { name: 't', label: 't', description: 'test tool', parameters: Type.Object({}), execute, ...(timeoutMs === undefined ? {} : { timeoutMs }) }
}

const waitForAbort = (signal?: AbortSignal) =>
  new Promise<never>((_, reject) => signal?.addEventListener('abort', () => reject(new Error('stopped by signal')), { once: true }))

describe('统一超时与取消', () => {
  it('超时后中止工具并以超时错误结束', async () => {
    let sawAbort = false
    const wrapped = withTimeout(
      tool(async (_id, _params, signal) => {
        await waitForAbort(signal).catch((error) => {
          sawAbort = true
          throw error
        })
        throw new Error('unreachable')
      }),
      { defaultTimeoutMs: 20, graceMs: 200 },
    )
    await expect(wrapped.execute('c', {})).rejects.toThrow('Tool t timed out after 20ms')
    expect(sawAbort).toBe(true)
  })

  it('不响应 signal 的工具在宽限期后被放弃', async () => {
    const wrapped = withTimeout(
      tool(() => new Promise(() => {})),
      { defaultTimeoutMs: 10, graceMs: 20 },
    )
    await expect(wrapped.execute('c', {})).rejects.toThrow(/timed out/)
  })

  it('外部取消传入工具 signal', async () => {
    const controller = new AbortController()
    const wrapped = withTimeout(
      tool((_id, _params, signal) => waitForAbort(signal)),
      { defaultTimeoutMs: 10_000, graceMs: 200 },
    )
    const pending = wrapped.execute('c', {}, controller.signal)
    controller.abort()
    await expect(pending).rejects.toThrow('stopped by signal')
  })

  it('工具声明 timeoutMs: 0 时不施加统一超时，契约字段保持', async () => {
    let finish!: () => void
    const done = new Promise<void>((resolve) => (finish = resolve))
    const original = tool(async () => {
      await done
      return { content: [{ type: 'text', text: 'done' }], details: undefined }
    }, 0)
    const wrapped = withTimeout(original, { defaultTimeoutMs: 5, graceMs: 5 })
    expect(wrapped.name).toBe(original.name)
    expect(wrapped.parameters).toBe(original.parameters)
    vi.useFakeTimers()
    try {
      let settled = false
      const pending = wrapped.execute('c', {}).finally(() => (settled = true))
      // 远超统一超时与宽限期：工具仍在运行，没有被超时结束。
      await vi.advanceTimersByTimeAsync(10_000)
      expect(settled).toBe(false)
      finish()
      await expect(pending).resolves.toMatchObject({ content: [{ text: 'done' }] })
    } finally {
      vi.useRealTimers()
    }
  })
})
