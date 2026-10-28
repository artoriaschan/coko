import type { ConnectionState } from '../client/connection.ts'

/** Sidecar 连接状态的 vanilla store（无 React 依赖）：client/connection.ts 写入，App 经 useSyncExternalStore 订阅。 */
export function createConnectionStore(initial: ConnectionState = { phase: 'connecting' }) {
  let state = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    set(next: ConnectionState) {
      state = next
      for (const listener of listeners) listener()
    },
  }
}

export type ConnectionStore = ReturnType<typeof createConnectionStore>
