// 草稿 store（票 06）：键、300 ms 防抖、立即写入、删除，以及损坏内容的丢弃与 warn。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDraftStore, draftKey, DRAFT_SAVE_DELAY_MS, type DraftStorage } from './draft-store.ts'

function memoryStorage(): DraftStorage & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) }
}

const state = (text: string) => ({ root: { type: 'root', children: [{ type: 'paragraph', children: [{ type: 'text', text }] }] } })

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('draft store', () => {
  it('键：会话为 coko.draft.<sessionId>，Workspace 草稿为 coko.draft.workspace.<workspaceId>', () => {
    expect(draftKey({ sessionId: 's1' })).toBe('coko.draft.s1')
    expect(draftKey({ workspaceId: 'w1' })).toBe('coko.draft.workspace.w1')
    expect(DRAFT_SAVE_DELAY_MS).toBe(300)
  })

  it('防抖：300 ms 内的连续保存只写一次，写入时才取值；flush 立即写入', () => {
    const storage = memoryStorage()
    const store = createDraftStore({ storage })
    const read = vi.fn<() => unknown>(() => state('b'))
    store.schedule('k', () => state('a'))
    vi.advanceTimersByTime(200)
    store.schedule('k', read)
    vi.advanceTimersByTime(299)
    expect(storage.data.has('k')).toBe(false)
    vi.advanceTimersByTime(1)
    expect(read).toHaveBeenCalledOnce()
    expect(store.load('k')).toEqual(state('b'))

    store.schedule('j', () => state('c'))
    store.flush()
    expect(store.load('j')).toEqual(state('c'))
  })

  it('remove 取消待写并删除', () => {
    const storage = memoryStorage()
    const store = createDraftStore({ storage })
    storage.setItem('k', JSON.stringify(state('old')))
    store.schedule('k', () => state('new'))
    store.remove('k')
    vi.advanceTimersByTime(1000)
    expect(storage.data.has('k')).toBe(false)
  })

  it('损坏的 JSON 与不是 EditorState 的值：load 返回 undefined，删除并记 warn', () => {
    const storage = memoryStorage()
    const warn = vi.fn<(message: string, properties: Record<string, unknown>) => void>()
    const store = createDraftStore({ storage, warn })
    storage.setItem('a', '{not json')
    storage.setItem('b', JSON.stringify({ text: 'x' }))
    expect(store.load('a')).toBeUndefined()
    expect(store.load('b')).toBeUndefined()
    expect(store.load('missing')).toBeUndefined()
    expect(storage.data.size).toBe(0)
    expect(warn.mock.calls).toEqual([
      ['draft discarded', { key: 'a', reason: 'invalid-json' }],
      ['draft discarded', { key: 'b', reason: 'invalid-editor-state' }],
    ])
    store.discard('c', 'rejected-by-editor')
    expect(warn).toHaveBeenLastCalledWith('draft discarded', { key: 'c', reason: 'rejected-by-editor' })
  })

  it('写入失败（配额）只记 warn', () => {
    const warn = vi.fn<(message: string, properties: Record<string, unknown>) => void>()
    const store = createDraftStore({
      storage: {
        getItem: () => null,
        removeItem: () => {},
        setItem: () => {
          throw new Error('QuotaExceededError')
        },
      },
      warn,
    })
    store.schedule('k', () => state('x'))
    store.flush()
    expect(warn).toHaveBeenCalledWith('draft save failed', { key: 'k', error: 'QuotaExceededError' })
  })
})
