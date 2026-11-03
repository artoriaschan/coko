import type { RunStatus } from '@coko/protocol'
import { unansweredConfirmations } from '@coko/agent/entries'
import { pendingApprovals, type Conversation } from '../../stores/chat-store.ts'
import type { TimelineItem } from './timeline.ts'

export interface DisplayRun {
  id: string
  status: RunStatus | 'running' | 'unknown'
  startedAt?: number
  endedAt?: number
  endedSeq?: number
  restricted: boolean
  retry?: { attempt: number; maxRetries: number }
}

/** Session facts remain separate from the flat, business-consumed timeline. */
export function displayRuns(conversation: Conversation): ReadonlyMap<string, DisplayRun> {
  const runs = new Map<string, DisplayRun>()
  const get = (id: string) => {
    let run = runs.get(id)
    if (!run) {
      run = { id, status: 'unknown', restricted: false }
      runs.set(id, run)
    }
    return run
  }
  for (const entry of conversation.entries) {
    if (entry.runId === null) continue
    const run = get(entry.runId)
    if (entry.kind === 'run_start') run.startedAt = entry.createdAt
    if (entry.kind === 'run_end') {
      run.status = entry.payload.status
      run.endedAt = entry.createdAt
      run.endedSeq = entry.seq
    }
  }
  const activeRunId =
    conversation.live?.runId ??
    conversation.entries.findLast((entry) => entry.kind === 'run_start' && entry.runId && runs.get(entry.runId)?.endedSeq === undefined)?.runId
  if (activeRunId && conversation.running) {
    const run = get(activeRunId)
    run.status = 'running'
    run.retry = conversation.live?.retry
    run.restricted = conversation.pausing === true
  }
  if (conversation.unrecordedEnd) {
    const run = get(conversation.unrecordedEnd.runId)
    run.status = conversation.unrecordedEnd.status
    // Progress has no timestamp. It is not evidence for a duration.
  }
  for (const entry of pendingApprovals(conversation.entries)) if (entry.runId) get(entry.runId).restricted = true
  for (const request of unansweredConfirmations(conversation.entries)) if (request.runId) get(request.runId).restricted = true
  return runs
}

export interface ProcessGroup {
  kind: 'process'
  id: string
  runId: string
  members: TimelineItem[]
  identities: string[]
}
export type ProcessSeat = ProcessGroup | { kind: 'row'; item: TimelineItem }
export const processMember = (item: TimelineItem) => item.kind === 'tool' || (item.kind === 'thinking' && item.text.trim() !== '')
const visibleInput = (item: TimelineItem) =>
  item.kind === 'user' ||
  item.kind === 'schedule-fire' ||
  item.kind === 'team-message' ||
  item.kind === 'agent-notification' ||
  (item.kind === 'job' && item.job.kind === 'notification')

/** Only adjacent process members with proven non-null Run ownership may share a seat. */
export function processSeats(items: TimelineItem[], identities: ReadonlyMap<string, string>, previous: ProcessGroup[] = []): ProcessSeat[] {
  const seats: ProcessSeat[] = []
  const used = new Set<string>()
  for (const item of items) {
    if (item.kind === 'steering') continue // Queue-only, not a visible timeline boundary.
    const runId = item.origin?.runId
    const last = seats.at(-1)
    if (processMember(item) && runId) {
      const identity = identities.get(item.key) ?? item.key
      if (last?.kind === 'process' && last.runId === runId) {
        last.members.push(item)
        last.identities.push(identity)
      } else seats.push({ kind: 'process', id: '', runId, members: [item], identities: [identity] })
    } else seats.push({ kind: 'row', item })
  }
  for (const seat of seats) {
    if (seat.kind !== 'process') continue
    // Reconcile overlap, so revealing earlier members does not replace an existing seat.
    const prior = previous.find((group) => group.runId === seat.runId && !used.has(group.id) && group.identities.some((id) => seat.identities.includes(id)))
    seat.id = prior?.id ?? `process:${seat.runId}:${seat.identities[0]}`
    used.add(seat.id)
  }
  return seats
}

export function wholeFoldEligible(items: TimelineItem[], run: DisplayRun): boolean {
  if (run.status !== 'completed' || run.restricted) return false
  let process = false
  for (const item of items) {
    if (run.endedSeq !== undefined && item.origin?.seq !== undefined && item.origin.seq > run.endedSeq) break
    if (process && item.origin?.runId && item.origin.runId !== run.id) break
    if (item.origin?.runId === run.id && processMember(item)) process = true
    else if (process && visibleInput(item)) return false
  }
  return process
}

export type ProcessActivity =
  | 'thinking'
  | 'read'
  | 'readImage'
  | 'search'
  | 'write'
  | 'edit'
  | 'commands'
  | 'code'
  | 'webSearch'
  | 'webFetch'
  | 'subagents'
  | 'plan'
  | 'questions'
  | 'tools'
export function toolActivity(name: string): ProcessActivity {
  if (name === 'read') return 'read'
  if (name === 'read_image') return 'readImage'
  if (name === 'grep' || name === 'glob' || name.endsWith('_inspect')) return 'search'
  if (name === 'write') return 'write'
  if (name === 'edit' || name === 'apply_patch') return 'edit'
  if (['bash', 'pwsh', 'exec_command', 'write_stdin'].includes(name) || name.startsWith('terminal_')) return 'commands'
  if (name === 'run_code') return 'code'
  if (name === 'web_search') return 'webSearch'
  if (name === 'web_fetch') return 'webFetch'
  if (name === 'agent' || name === 'subagent' || name.startsWith('subagent_')) return 'subagents'
  if (['todo_write', 'create_goal', 'update_goal', 'get_goal'].includes(name)) return 'plan'
  if (name === 'ask_user_question' || name === 'request_user_input') return 'questions'
  return 'tools'
}

/** Count recorded calls, including failures, once per identity; ties keep first appearance. */
export function processActivities(members: TimelineItem[]): ProcessActivity[] {
  const seen = new Set<string>()
  const counts = new Map<ProcessActivity, number>()
  for (const member of members) {
    if (member.kind !== 'tool' || seen.has(member.call.id)) continue
    seen.add(member.call.id)
    const category = toolActivity(member.call.name)
    counts.set(category, (counts.get(category) ?? 0) + 1)
  }
  return [...counts].sort((a, b) => b[1] - a[1]).map(([category]) => category)
}
