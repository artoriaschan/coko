import * as React from 'react'
import type { TimelineTarget } from './timeline-projection.ts'

export interface TimelineRevealScope {
  readonly sessionId: string
  readonly listeners: Set<(target: TimelineTarget) => void>
  root?: HTMLElement
}
export const TimelineRevealContext = React.createContext<{ scope: TimelineRevealScope; identity?: string } | undefined>(undefined)
const mounted = new Map<string, TimelineRevealScope>()

/** Only the explicitly opted-in main owner is registered; recursive history inherits it. */
export function useMainTimelineReveal(sessionId: string | undefined, enabled: boolean) {
  const scope = React.useMemo<TimelineRevealScope | undefined>(
    () => (enabled && sessionId ? { sessionId, listeners: new Set() } : undefined),
    [sessionId, enabled],
  )
  React.useLayoutEffect(() => {
    if (!scope) return
    mounted.set(scope.sessionId, scope)
    return () => {
      if (mounted.get(scope.sessionId) === scope) mounted.delete(scope.sessionId)
    }
  }, [scope])
  return scope
}
export function mainTimelineRoot(sessionId: string | null) {
  return sessionId === null ? undefined : mounted.get(sessionId)?.root
}
export function revealTimeline(sessionId: string, target: TimelineTarget) {
  const scope = mounted.get(sessionId)
  if (scope) for (const listener of scope.listeners) listener(target)
}
/** Register existing state setters without adding DOM or changing disclosure reset epochs. */
export function useTimelineReveal(callback: (target: TimelineTarget) => void) {
  const context = React.useContext(TimelineRevealContext)
  const latest = React.useRef(callback)
  latest.current = callback
  React.useLayoutEffect(() => {
    if (!context) return
    const listener = (target: TimelineTarget) => latest.current(target)
    context.scope.listeners.add(listener)
    return () => {
      context.scope.listeners.delete(listener)
    }
  }, [context?.scope])
}
export function useRevealDisclosure(open: () => void) {
  const context = React.useContext(TimelineRevealContext)
  useTimelineReveal((target) => {
    if (context?.identity !== undefined && context.identity === target.identity) open()
  })
}
