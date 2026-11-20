// 新对话草稿的持久化配置：升级前残留的 permissionMode 'plan'（规划不是 Permission Mode，ADR 0028）按未设置读取，草稿的其余配置保留。
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

  it('五档之一原样读回（含 auto-review）', () => {
    for (const mode of ['read-only', 'default', 'accept-edits', 'auto-review', 'full-access'])
      expect(createNewChatStore(storageWith({ ...saved, permissionMode: mode })).getState().permissionMode).toBe(mode)
  })
})
