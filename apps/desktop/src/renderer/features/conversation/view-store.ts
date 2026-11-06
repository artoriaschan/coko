import { createStore } from 'zustand/vanilla'

export type ConversationView = 'conversation' | 'trajectory'
export const INITIAL_CONVERSATION_VIEW = { active: 'conversation' as ConversationView, trajectoryOpened: false }

/** Main content selection belongs to each Session, independently of the right sidebar. */
export const conversationViewStore = createStore<{ sessions: Record<string, typeof INITIAL_CONVERSATION_VIEW> }>(() => ({ sessions: {} }))

export function selectConversationView(sessionId: string, active: ConversationView) {
  const sessions = conversationViewStore.getState().sessions
  const current = sessions[sessionId] ?? INITIAL_CONVERSATION_VIEW
  conversationViewStore.setState({ sessions: { ...sessions, [sessionId]: { active, trajectoryOpened: current.trajectoryOpened || active === 'trajectory' } } })
}

export function forgetConversationViews(sessionIds: readonly string[]) {
  const removed = new Set(sessionIds)
  conversationViewStore.setState({ sessions: Object.fromEntries(Object.entries(conversationViewStore.getState().sessions).filter(([id]) => !removed.has(id))) })
}
