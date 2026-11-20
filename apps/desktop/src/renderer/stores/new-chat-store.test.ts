// 新对话草稿的持久化配置：升级前残留的 permissionMode 'plan'（Permission Mode 只剩四档，ADR 0028）按未设置读取，草稿的其余配置保留。
import { describe, expect, it } from 'vitest'
import { createNewChatStore, NEW_CHAT_CONFIG_KEY } from './new-chat-store.ts'

const storageWith = (saved: unknown) => {
  const items = new Map([[NEW_CHAT_CONFIG_KEY, JSON.stringify(saved)]])
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
    key: (index: number) => [...items.keys()][index] ?? null,
    get length() {
      return items.size
    },
  }
}
const saved = { draftId: 'd1', model: null, thinkingLevel: 'high', projectId: 'p1' }

describe('新对话草稿的 permissionMode', () => {
  it('残留的 plan 读为未设置，草稿的其余配置保留', () => {
    const state = createNewChatStore(storageWith({ ...saved, permissionMode: 'plan' })).getState()
    expect([state.permissionMode, state.draftId, state.thinkingLevel, state.projectId]).toEqual([null, 'd1', 'high', 'p1'])
  })

  it('四档之一原样读回', () => {
    expect(createNewChatStore(storageWith({ ...saved, permissionMode: 'accept-edits' })).getState().permissionMode).toBe('accept-edits')
  })
})
