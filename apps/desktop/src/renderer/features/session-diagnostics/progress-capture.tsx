import * as React from 'react'
import type { ChatStore } from '../../stores/chat-store.ts'
import { getRightPanelLayout, rightPanelLayoutStore } from '../right-panel/layout-store.ts'
import { createProgressState, receiveDiagnosticProgress, settleDiagnosticProgress, type DiagnosticProgressState } from './progress-model.ts'

interface CaptureSnapshot {
  readonly sessionId: string
  readonly progress: DiagnosticProgressState
}
function createCapture(chat: ChatStore) {
  let snapshot: CaptureSnapshot | null = null
  const listeners = new Set<() => void>()
  const publish = (next: CaptureSnapshot | null) => {
    if (snapshot === next) return
    snapshot = next
    for (const listener of listeners) listener()
  }
  const sync = () => {
    const { activeSessionId, conversations } = chat.getState()
    if (activeSessionId === null || !getRightPanelLayout(activeSessionId).tabs.includes('diagnostics')) return publish(null)
    const entries = conversations[activeSessionId]?.entries ?? []
    if (snapshot?.sessionId !== activeSessionId) return publish({ sessionId: activeSessionId, progress: createProgressState(entries) })
    const progress = settleDiagnosticProgress(snapshot.progress, entries)
    if (progress !== snapshot.progress) publish({ sessionId: activeSessionId, progress })
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    connect() {
      sync()
      const offChat = chat.subscribe(sync)
      const offLayout = rightPanelLayoutStore.subscribe(sync)
      const offProgress = chat.getState().onProgress(({ sessionId, runId, event }) => {
        sync()
        if (snapshot?.sessionId !== sessionId) return
        const progress = receiveDiagnosticProgress(snapshot.progress, runId, event)
        if (progress !== snapshot.progress) publish({ sessionId, progress })
      })
      return () => {
        offProgress()
        offLayout()
        offChat()
        publish(null)
      }
    },
  }
}
const CaptureContext = React.createContext<ReturnType<typeof createCapture> | null>(null)
/** Lives above the right-panel viewport: a hidden tab still captures, a closed tab never does. */
export function DiagnosticProgressProvider({ chat, children }: { chat: ChatStore; children: React.ReactNode }) {
  const capture = React.useMemo(() => createCapture(chat), [chat])
  React.useLayoutEffect(() => capture.connect(), [capture])
  return <CaptureContext.Provider value={capture}>{children}</CaptureContext.Provider>
}
const empty = () => null
const noopSubscribe = () => () => {}
export function useDiagnosticProgress(sessionId: string | null): DiagnosticProgressState | null {
  const capture = React.useContext(CaptureContext)
  const snapshot = React.useSyncExternalStore(capture?.subscribe ?? noopSubscribe, capture?.getSnapshot ?? empty)
  return snapshot?.sessionId === sessionId ? snapshot.progress : null
}
