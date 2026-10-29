import * as React from 'react'
import { useStore } from 'zustand'
import type { ChatActions, ChatState, ChatStore } from '../stores/chat-store.ts'

const ChatStoreContext = React.createContext<ChatStore | null>(null)

export function ChatStoreProvider({ store, children }: { store: ChatStore; children: React.ReactNode }) {
  return <ChatStoreContext.Provider value={store}>{children}</ChatStoreContext.Provider>
}

/** store 本身：需要在 effect 中订阅外部变化（例如交给命令式编辑器）时使用。 */
export function useChatStoreApi(): ChatStore {
  const store = React.useContext(ChatStoreContext)
  if (!store) throw new Error('useChat must be used inside <ChatStoreProvider>')
  return store
}

/** store 本身；不在 <ChatStoreProvider> 之内（组件测试）时为 null。 */
export function useOptionalChatStoreApi(): ChatStore | null {
  return React.useContext(ChatStoreContext)
}

/** 订阅对话 store 的一个切片；selector 返回的引用应来自 store 自身，避免每次渲染新建对象。 */
export function useChat<T>(selector: (state: ChatState & ChatActions) => T): T {
  return useStore(useChatStoreApi(), selector)
}

/** 操作函数在 store 生命周期内不变。 */
export function useChatActions(): ChatActions {
  return useChatStoreApi().getState()
}
