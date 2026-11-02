import type { ChatStore } from '../stores/chat-store.ts'

/** 右侧内容的位置；设置页由 SettingsPageStore 管理，不进入此历史。 */
export type WorkbenchLocation = { kind: 'session'; sessionId: string } | { kind: 'new-chat' } | { kind: 'plugins' } | { kind: 'schedules' }

const sameLocation = (a: WorkbenchLocation, b: WorkbenchLocation) =>
  a.kind === b.kind && (a.kind !== 'session' || (b.kind === 'session' && a.sessionId === b.sessionId))

/** 窗口内存中的前进后退；会话是否可达每次都从当前列表判断。 */
export function createWorkbenchNavigation(chat: ChatStore) {
  const observed = (): WorkbenchLocation => {
    const id = chat.getState().activeSessionId
    return id === null ? { kind: 'new-chat' } : { kind: 'session', sessionId: id }
  }
  let history: WorkbenchLocation[] = [observed()]
  let cursor = 0
  const ready = () =>
    chat.lists.getState().listStatus === 'ready' &&
    (chat.getState().activeSessionId !== null || chat.getState().draftWorkspaceId !== null || chat.lists.getState().sessions.length === 0)
  let initialized = ready()
  let applying = false
  const listeners = new Set<() => void>()
  const available = (location: WorkbenchLocation) =>
    location.kind !== 'session' || chat.lists.getState().sessions.some((session) => session.id === location.sessionId)
  const find = (direction: -1 | 1) => {
    for (let i = cursor + direction; i >= 0 && i < history.length; i += direction) if (available(history[i]!)) return i
    return null
  }
  const snapshot = () => ({ location: history[cursor]!, canBack: find(-1) !== null, canForward: find(1) !== null })
  let state = snapshot()
  const notify = () => {
    state = snapshot()
    for (const listener of listeners) listener()
  }
  const record = (location: WorkbenchLocation) => {
    if (sameLocation(history[cursor]!, location)) return
    history = [...history.slice(0, cursor + 1), location]
    cursor = history.length - 1
    notify()
  }
  const apply = (location: WorkbenchLocation, workspaceId?: string) => {
    applying = true
    try {
      if (location.kind === 'session') chat.getState().openSession(location.sessionId)
      else if (location.kind === 'new-chat') chat.getState().startDraft(workspaceId)
    } finally {
      applying = false
    }
  }
  const visit = (location: WorkbenchLocation, workspaceId?: string) => {
    if (!available(location)) return
    initialized = true
    record(location)
    apply(location, workspaceId)
  }
  const move = (direction: -1 | 1) => {
    const next = find(direction)
    if (next === null) return
    cursor = next
    notify()
    apply(history[cursor]!)
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    visit,
    openSession: (sessionId: string) => visit({ kind: 'session', sessionId }),
    newChat: (workspaceId?: string) => visit({ kind: 'new-chat' }, workspaceId),
    back: () => move(-1),
    forward: () => move(1),
    /** App 拥有订阅；卸载时停止观察，不把历史保存到本地。 */
    connect() {
      let previous = observed()
      let previousSessions = chat.lists.getState().sessions
      const observe = () => {
        const current = observed()
        const sessions = chat.lists.getState().sessions
        if (!initialized) {
          if (ready()) {
            initialized = true
            history = [current]
            cursor = 0
            notify()
          }
        } else if (!applying && !sameLocation(previous, current)) record(current)
        if (sessions !== previousSessions) notify()
        previous = current
        previousSessions = sessions
      }
      const releaseChat = chat.subscribe(observe)
      const releaseLists = chat.lists.subscribe(observe)
      observe()
      return () => {
        releaseChat()
        releaseLists()
      }
    },
  }
}

export type WorkbenchNavigation = ReturnType<typeof createWorkbenchNavigation>
