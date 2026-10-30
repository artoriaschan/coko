import { describe, expect, it } from 'vitest'
import { bindOpenSession } from './open-session.ts'

describe('bindOpenSession', () => {
  it('main 要求打开会话时关闭设置页并打开该会话；取消订阅后不再响应', () => {
    let listener: ((sessionId: string) => void) | undefined
    const bridge = {
      onOpenSession: (l: (sessionId: string) => void) => {
        listener = l
        return () => (listener = undefined)
      },
    }
    const calls: string[] = []
    const off = bindOpenSession(bridge, { openSession: (id) => calls.push('open ' + id), closeSettings: () => calls.push('close settings') })
    listener!('s1')
    expect(calls).toEqual(['close settings', 'open s1'])
    off()
    expect(listener).toBeUndefined()
  })

  it('没有 bridge 时不订阅', () => {
    expect(() => bindOpenSession(undefined, { openSession: () => {} })()).not.toThrow()
  })
})
