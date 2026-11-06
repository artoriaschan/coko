import { createStore } from 'zustand/vanilla'
import { selectConversationView } from '../conversation/view-store.ts'

/** Pending navigation survives opening a closed tab and is scoped to the owning Session. */
export const trajectoryInspectStore = createStore<{ requests: Record<string, { toolCallId: string; revision: number }> }>(() => ({ requests: {} }))
export function inspectTrajectory(sessionId: string, toolCallId: string) {
  selectConversationView(sessionId, 'trajectory')
  const requests = trajectoryInspectStore.getState().requests
  trajectoryInspectStore.setState({ requests: { ...requests, [sessionId]: { toolCallId, revision: (requests[sessionId]?.revision ?? 0) + 1 } } })
}
export function completeTrajectoryInspect(sessionId: string, revision: number) {
  const requests = trajectoryInspectStore.getState().requests
  if (requests[sessionId]?.revision !== revision) return
  const { [sessionId]: _completed, ...remaining } = requests
  trajectoryInspectStore.setState({ requests: remaining })
}
