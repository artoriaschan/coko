import type { SessionEntry } from '@coko/protocol'
import * as React from 'react'

/** Facts belong to the rendered Session, including right-panel and rewound timelines. */
export interface TimelineSessionFacts {
  sessionId: string | null
  entries: readonly SessionEntry[]
  actionsDisabled: boolean
  /** Historical snapshots may be inspected but must not route to the current Plan revision. */
  historical?: boolean
  /** Caller-owned Session restriction, independent of Run activity. */
  readOnly?: boolean
}
const EMPTY: TimelineSessionFacts = { sessionId: null, entries: [], actionsDisabled: true }
export const TimelineSessionContext = React.createContext<TimelineSessionFacts>(EMPTY)
export const useTimelineSession = (): TimelineSessionFacts => React.useContext(TimelineSessionContext)
