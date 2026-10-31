import type { SessionEntry } from '@coko/protocol'
import * as React from 'react'
import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'
import { useOptionalChatStoreApi } from '../../app/chat.tsx'
import type { ChatState } from '../../stores/chat-store.ts'

// 会话视图的"条目计数变化即重新读取"（子代理列表、定时任务列表）：打开会话时读取，之后该会话中给定 kind 的条目数变化时（包括重连后
// 补发）再读取；两次读取之间由各自的 progress 事件更新。

type EntryKind = SessionEntry['kind']

const EMPTY: readonly SessionEntry[] = []
/** 不在对话 store 之内（组件测试）时使用的空 store。 */
const noChat = createStore<Pick<ChatState, 'conversations'>>()(() => ({ conversations: {} }))
/** 同一条目数组按 kind 组合只计数一次。 */
const counted = new WeakMap<readonly SessionEntry[], Map<string, number>>()

function countKinds(entries: readonly SessionEntry[], key: string): number {
  let byKey = counted.get(entries)
  if (!byKey) counted.set(entries, (byKey = new Map()))
  let count = byKey.get(key)
  if (count === undefined) {
    const kinds = new Set(key.split(','))
    count = entries.reduce((n, e) => (kinds.has(e.kind) ? n + 1 : n), 0)
    byKey.set(key, count)
  }
  return count
}

/**
 * sessionId 不为 null 时调用 load(sessionId)：首次、sessionId 变化与该会话中 kind 条目数变化时。load 应在 store 生命周期内不变
 * （例如 store.getState().load）。
 */
export function useReloadOnEntryCount(sessionId: string | null, kind: EntryKind | readonly EntryKind[], load: (sessionId: string) => unknown): void {
  const chat = useOptionalChatStoreApi() ?? noChat
  const key = typeof kind === 'string' ? kind : [...kind].sort().join(',')
  const marker = useStore(chat, (s) => (sessionId === null ? 0 : countKinds(s.conversations[sessionId]?.entries ?? EMPTY, key)))
  React.useEffect(() => {
    if (sessionId !== null) void load(sessionId)
  }, [load, sessionId, marker])
}
