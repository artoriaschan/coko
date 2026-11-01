import { describe, expect, it } from 'vitest'
import type { UpdateStatus } from '../../shared/bridge.ts'
import { createUpdateStore, type UpdateBridge } from './update-store.ts'

function fakeBridge(initial: UpdateStatus) {
  const listeners = new Set<(status: UpdateStatus) => void>()
  const calls: string[] = []
  let release: (() => void) | undefined
  const gate = new Promise<void>((resolve) => (release = resolve))
  const bridge: UpdateBridge = {
    onUpdateStatus(listener) {
      listeners.add(listener)
      listener(initial)
      return () => void listeners.delete(listener)
    },
    checkForUpdates: async () => {
      calls.push('check')
      await gate
    },
    installUpdate: async () => void calls.push('install'),
  }
  return { bridge, calls, push: (s: UpdateStatus) => listeners.forEach((l) => l(s)), listeners, release: () => release?.() }
}

describe('update-store', () => {
  it('没有 bridge 时为 disabled { reason: not-packaged }，操作不做任何事', async () => {
    const store = createUpdateStore(undefined)
    expect(store.getState().status).toEqual({ state: 'disabled', reason: 'not-packaged' })
    store.getState().connect()()
    await store.getState().check()
    expect(store.getState().pending).toBeUndefined()
  })

  it('connect 先收到当前状态，之后每次推送；按引用计数退订', () => {
    const fake = fakeBridge({ state: 'idle' })
    const store = createUpdateStore(fake.bridge)
    expect(store.getState().status).toBeUndefined()
    const a = store.getState().connect()
    const b = store.getState().connect()
    expect(fake.listeners.size).toBe(1)
    expect(store.getState().status).toEqual({ state: 'idle' })
    fake.push({ state: 'checking' })
    expect(store.getState().status).toEqual({ state: 'checking' })
    a()
    a()
    expect(fake.listeners.size).toBe(1)
    b()
    expect(fake.listeners.size).toBe(0)
  })

  it('check 进行中为 pending，重复点击不重复调用', async () => {
    const fake = fakeBridge({ state: 'idle' })
    const store = createUpdateStore(fake.bridge)
    const first = store.getState().check()
    expect(store.getState().pending).toBe('check')
    await store.getState().check()
    fake.release()
    await first
    expect(fake.calls).toEqual(['check'])
    expect(store.getState().pending).toBeUndefined()
    await store.getState().install()
    expect(fake.calls).toEqual(['check', 'install'])
  })
})
