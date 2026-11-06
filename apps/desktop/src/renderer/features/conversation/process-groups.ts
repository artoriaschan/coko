import type { RunStatus } from '@coko/protocol'
import type { Translator } from '@coko/i18n'
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

export type ProcessStep = { kind: 'tools'; id: string; members: Extract<TimelineItem, { kind: 'tool' }>[] } | { kind: 'item'; item: TimelineItem }

/** A display group follows one assistant message's calls; it is not a runtime parent call. */
export function processSteps(members: TimelineItem[]): ProcessStep[] {
  const steps: ProcessStep[] = []
  for (const item of members) {
    const last = steps.at(-1)
    if (item.kind !== 'tool') {
      steps.push({ kind: 'item', item })
      continue
    }
    const previous = last?.kind === 'tools' ? last.members.at(-1) : undefined
    if (last?.kind === 'tools' && previous && previous.origin?.seq === item.origin?.seq) last.members.push(item)
    else steps.push({ kind: 'tools', id: item.call.id, members: [item] })
  }
  return steps
}
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
    if (item.kind === 'steering' || (item.kind === 'job' && item.job.kind !== 'notification')) continue // Queue-only and Job lifecycle facts have no independent row.
    // Plan proposals are real review boundaries, even after their card is superseded. Keeping this boundary preserves mounted process members on settlement.
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
    const base = prior?.id ?? `process:${seat.runId}:${seat.identities[0]}`
    seat.id = base
    for (let suffix = 1; used.has(seat.id); suffix++) seat.id = `${base}:split:${suffix}`
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
  if (name === 'grep' || name === 'glob' || name === 'find' || name === 'ls' || name.endsWith('_inspect')) return 'search'
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

/** Harness's closed-group composition: rank categories, retain three, share only a common translated prefix. */
export function processTitle(members: TimelineItem[], t: Translator): string {
  const activities = processActivities(members)
  const labels = activities.slice(0, 3).map((kind) => t(`process.${kind}`))
  const first = labels[0]
  if (first === undefined) return t('process.thinking')
  const continuation = (label: string) => label.charAt(0).toLowerCase() + label.slice(1)
  const second = labels[1]
  if (second === undefined) return first
  if (labels.length === 2) {
    const prefix = t('process.sharedPrefix')
    const shared = first.startsWith(prefix) && second.startsWith(prefix)
    return first + t('process.joinTwo') + continuation(shared ? second.slice(prefix.length) : second)
  }
  return [first, ...labels.slice(1).map(continuation)].join(t('process.joinMany')) + (activities.length > 3 ? t('process.more') : '')
}

const argumentFields: Partial<Record<ProcessActivity, string[]>> = {
  commands: ['description', 'command', 'cmd'],
  code: ['description', 'code'],
  read: ['path', 'file_path', 'url'],
  readImage: ['path', 'file_path'],
  search: ['description', 'query', 'pattern', 'path'],
  write: ['path', 'file_path'],
  edit: ['path', 'file_path'],
  webSearch: ['description', 'query', 'queries'],
  webFetch: ['description', 'url'],
}
const firstLine = (value: unknown) => (typeof value === 'string' && value.trim() !== '' ? value.split(/\r?\n/, 1)[0] : undefined)

/** Preserve recorded descriptions; missing descriptions fall back to the actual operation arguments. */
export function toolArgumentSummary(name: string, value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const args = value as Record<string, unknown>
  for (const field of argumentFields[toolActivity(name)] ?? ['description', 'title', 'name']) {
    const summary = firstLine(args[field])
    if (summary) return summary
    if (Array.isArray(args[field]) && args[field].every((part) => typeof part === 'string')) return args[field].join(', ')
  }
  return undefined
}

/** A request's display title names its operations, rather than repeating a generic call count. */
export function toolStepPresentation(members: Extract<TimelineItem, { kind: 'tool' }>[]): { activity: ProcessActivity; summary: string } {
  const activities = processActivities(members)
  const codeActivities = new Set<ProcessActivity>(['commands', 'code', 'read', 'readImage', 'search', 'write', 'edit'])
  const activity =
    activities.includes('code') || (activities.length > 1 && activities.every((kind) => codeActivities.has(kind))) ? 'code' : (activities[0] ?? 'tools')
  for (const member of members) {
    const args = member.call.arguments
    if (args && typeof args === 'object' && !Array.isArray(args)) {
      const description = firstLine(Reflect.get(args, 'description'))
      if (description) return { activity, summary: description }
    }
  }
  const first = members[0]!
  return { activity, summary: toolArgumentSummary(first.call.name, first.call.arguments) ?? first.call.name }
}
