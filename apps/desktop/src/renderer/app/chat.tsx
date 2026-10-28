import * as React from 'react'
import { useStore } from 'zustand'
import type { ChatActions, ChatState, ChatStore } from '../stores/chat-store.ts'

const ChatStoreContext = React.createContext<ChatStore | null>(null)

export function ChatStoreProvider({ store, children }: { store: ChatStore; children: React.ReactNode }) {
  return <ChatStoreContext.Provider value={store}>{children}</ChatStoreContext.Provider>
}

function useChatStoreApi(): ChatStore {
  const store = React.useContext(ChatStoreContext)
  if (!store) throw new Error('useChat must be used inside <ChatStoreProvider>')
  return store
}

/** 订阅对话 store 的一个切片；selector 返回的引用应来自 store 自身，避免每次渲染新建对象。 */
export function useChat<T>(selector: (state: ChatState & ChatActions) => T): T {
  return useStore(useChatStoreApi(), selector)
}

/** 操作函数在 store 生命周期内不变。 */
export function useChatActions(): ChatActions {
  return useChatStoreApi().getState()
}
