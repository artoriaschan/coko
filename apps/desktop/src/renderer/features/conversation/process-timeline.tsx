import * as React from 'react'
import type { Translator } from '@coko/i18n'
import { useI18n } from '../../app/i18n.tsx'
import type { TimelineItem } from './timeline.ts'
import { processActivities, processSeats, wholeFoldEligible, type DisplayRun, type ProcessGroup } from './process-groups.ts'
import { ProcessDisclosureReset, ProcessFocusLock, useProcessDisclosure } from './process-disclosure.tsx'
import { ProcessActivityIcon } from './process-icon.tsx'
import { useNow } from './jobs-button.tsx'
import './process-timeline.css'
import { ProcessToolStates } from './tool-states.tsx'

function summary(group: ProcessGroup, t: Translator, locale: string): string {
  const activities = processActivities(group.members)
  if (activities.length === 0) return t('process.thinking')
  const titles = activities.slice(0, 3).map((kind) => t(`process.${kind}`))
  if (locale === 'en') for (let i = 1; i < titles.length; i++) titles[i] = titles[i]![0]!.toLowerCase() + titles[i]!.slice(1)
  if (locale === 'zh' && titles.length === 2 && titles.every((title) => title.startsWith('已'))) titles[1] = titles[1]!.slice(1)
  return titles.join(t(titles.length === 2 ? 'process.joinTwo' : 'process.joinMany')) + (activities.length > 3 ? t('process.more') : '')
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg aria-hidden viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1">
      <path
        d={
          open
            ? 'M12 10L8.70711 6.70711C8.31658 6.31658 7.68342 6.31658 7.29289 6.70711L4 10'
            : 'M4 6L7.29289 9.29289C7.68342 9.68342 8.31658 9.68342 8.70711 9.29289L12 6'
        }
      />
    </svg>
  )
}

function Group({
  group,
  running,
  hidden,
  focused,
  renderItem,
}: {
  group: ProcessGroup
  running: boolean
  hidden: boolean
  focused: boolean
  renderItem: (item: TimelineItem) => React.ReactNode
}) {
  const { t, locale } = useI18n()
  const [opened, setOpened] = useProcessDisclosure()
  const [keepFocused, setKeepFocused] = useProcessDisclosure()
  const [wasRunning, setWasRunning] = React.useState(running)
  if (wasRunning !== running) {
    setWasRunning(running)
    if (!running && focused) setKeepFocused(true)
  }
  const open = running || opened || keepFocused
  const bodyId = React.useId()
  const body = React.useRef<HTMLDivElement>(null)
  const content = React.useRef<HTMLDivElement>(null)
  const following = React.useRef(true)
  const wasCapped = React.useRef(!running)
  const [edges, setEdges] = React.useState({ up: false, down: false })
  const measure = React.useCallback(() => {
    const el = body.current
    if (el)
      setEdges((old) => {
        const up = el.scrollTop > 1
        const down = el.scrollTop + el.clientHeight < el.scrollHeight - 1
        return old.up === up && old.down === down ? old : { up, down }
      })
  }, [])
  React.useLayoutEffect(() => {
    const el = body.current
    if (el && open && following.current && !running && wasCapped.current) el.scrollTop = el.scrollHeight
    // Restoring a cap is a lifecycle change, not a request to jump to the end.
    wasCapped.current = !running
    measure()
  }, [group.members, open, running, measure])
  React.useLayoutEffect(() => {
    const observer = new ResizeObserver(measure)
    if (content.current) observer.observe(content.current)
    if (body.current) observer.observe(body.current)
    return () => observer.disconnect()
  }, [measure])
  const activity = processActivities(group.members)[0]
  return (
    <section hidden={hidden} data-slot="process-group" data-run-id={group.runId} className="conversation-process-group">
      <button
        type="button"
        hidden={running}
        data-slot="process-group-header"
        aria-expanded={open}
        aria-controls={bodyId}
        className="conversation-process-group-header focus-ring rounded-sm"
        onClick={(event) => {
          event.currentTarget.focus({ preventScroll: true })
          if (!open) {
            following.current = false
            if (body.current) body.current.scrollTop = 0
          }
          setKeepFocused(false)
          setOpened(!open)
        }}
      >
        <span aria-hidden className="conversation-process-leading">
          <span className="conversation-process-icon">{<ProcessActivityIcon activity={activity ?? 'thinking'} />}</span>
          <span className="conversation-process-chevron">
            <Chevron open={open} />
          </span>
        </span>
        <span className="conversation-process-label">{summary(group, t, locale)}</span>
      </button>
      {!running && <ProcessToolStates members={group.members} />}
      <div
        ref={body}
        id={bodyId}
        hidden={!open}
        data-slot="process-group-body"
        data-running={running || undefined}
        data-scroll-up={(!running && edges.up) || undefined}
        data-scroll-down={(!running && edges.down) || undefined}
        className="conversation-process-body"
        onScroll={(event) => {
          const el = event.currentTarget
          following.current = el.scrollHeight - el.scrollTop - el.clientHeight < 1
          measure()
        }}
      >
        <div ref={content} className="conversation-process-content">
          {group.members.map(renderItem)}
        </div>
      </div>
    </section>
  )
}

export interface ProcessTimelineProps {
  items: TimelineItem[]
  identities: ReadonlyMap<string, string>
  runs?: ReadonlyMap<string, DisplayRun>
  connected?: boolean
  renderItem: (item: TimelineItem) => React.ReactNode
}

/** Stable seats exist from the first live render; view changes never move their children. */
function Duration({ seconds }: { seconds: number }) {
  const { t } = useI18n()
  const number = (value: number) => <span className="conversation-process-duration-number">{value}</span>
  return (
    <span aria-hidden className="conversation-process-duration">
      {seconds >= 3600 && (
        <>
          {number(Math.floor(seconds / 3600))}
          {t('process.hourUnit')}
        </>
      )}
      {seconds >= 60 && (
        <>
          {number(Math.floor(seconds / 60) % 60)}
          {t('process.minuteUnit')}
        </>
      )}
      {number(seconds % 60)}
      {t('process.secondUnit')}
    </span>
  )
}

function RunControl({
  run,
  eligible,
  open,
  connected,
  onToggle,
  members,
}: {
  run: DisplayRun
  eligible: boolean
  open: boolean
  connected: boolean
  onToggle: () => void
  members: TimelineItem[]
}) {
  const { t } = useI18n()
  const now = useNow(run.status === 'running' && connected && run.startedAt !== undefined)
  const label = run.retry
    ? t('conversation.retrying', { attempt: run.retry.attempt, max: run.retry.maxRetries })
    : run.status === 'running'
      ? t('process.running')
      : run.status === 'completed'
        ? t('process.completed')
        : run.status === 'error'
          ? t('conversation.runError')
          : run.status === 'aborted'
            ? t('conversation.stopped')
            : run.status === 'paused'
              ? t('conversation.paused')
              : run.status === 'interrupted'
                ? t('conversation.interrupted')
                : t('process.label')
  const end = run.endedAt ?? (run.status === 'running' ? now : undefined)
  const elapsed =
    (run.status === 'running' || run.status === 'completed') && run.startedAt !== undefined && end !== undefined
      ? Math.max(0, Math.floor((end - run.startedAt) / 1000))
      : undefined
  return (
    <React.Fragment>
      <span role="status" aria-live="polite" className="sr-only">
        {label}
      </span>
      <button
        type="button"
        data-slot="run-process-control"
        data-run-id={run.id}
        data-open={open || undefined}
        className="conversation-run-process focus-ring rounded-sm"
        aria-label={t('process.label')}
        aria-expanded={eligible ? open : undefined}
        disabled={!eligible}
        onClick={(event) => {
          event.currentTarget.focus({ preventScroll: true })
          onToggle()
        }}
      >
        <span className="conversation-process-label">
          {run.status === 'completed' && elapsed !== undefined ? t('process.took') : label}
          {elapsed !== undefined && (
            <>
              {run.status === 'running' ? ' · ' : ''}
              <Duration seconds={elapsed} />
            </>
          )}
        </span>
        {eligible && <Chevron open={open} />}
      </button>
      {!open && <ProcessToolStates members={members} />}
    </React.Fragment>
  )
}

export function ProcessTimeline({ items, identities, runs = new Map(), connected = false, renderItem }: ProcessTimelineProps) {
  const previous = React.useRef<ProcessGroup[]>([])
  const seats = processSeats(items, identities, previous.current)
  previous.current = seats.filter((seat) => seat.kind === 'process')
  const [choices, setChoices] = React.useState<Record<string, { open?: boolean; epoch: number }>>({})
  const focusedRuns = React.useRef(new Set<string>())
  const focusedGroups = React.useRef(new Set<string>())
  const focusHeld = React.useRef(new Set<string>())
  const locks = React.useRef(new Map<string, Set<symbol>>())
  const groupLocks = React.useRef(new Map<string, Set<symbol>>())
  const acquisitions = React.useRef(new Map<string, () => () => void>())
  const first = new Set<string>()
  const eligibility = new Map<string, boolean>()
  const nodes: React.ReactNode[] = []
  for (const seat of seats) {
    if (seat.kind === 'row') {
      nodes.push(renderItem(seat.item))
      continue
    }
    const run = runs.get(seat.runId)
    let eligible = eligibility.get(seat.runId)
    if (eligible === undefined) {
      eligible = run !== undefined && wholeFoldEligible(items, run)
      eligibility.set(seat.runId, eligible)
    }
    const focused = focusedRuns.current.has(seat.runId) || (locks.current.get(seat.runId)?.size ?? 0) > 0
    const groupFocused = focusedGroups.current.has(seat.id) || (groupLocks.current.get(seat.id)?.size ?? 0) > 0
    if (!acquisitions.current.has(seat.id))
      acquisitions.current.set(seat.id, () => {
        const token = Symbol()
        const held = locks.current.get(seat.runId) ?? new Set<symbol>()
        locks.current.set(seat.runId, held)
        held.add(token)
        const groupHeld = groupLocks.current.get(seat.id) ?? new Set<symbol>()
        groupLocks.current.set(seat.id, groupHeld)
        groupHeld.add(token)
        return () => {
          held.delete(token)
          groupHeld.delete(token)
        }
      })
    if (eligible && focused) focusHeld.current.add(seat.runId)
    const choice = choices[seat.runId]
    const open = !eligible || (choice?.open ?? focusHeld.current.has(seat.runId))
    if (!first.has(seat.runId)) {
      first.add(seat.runId)
      if (run && (run.startedAt !== undefined || run.status !== 'unknown'))
        nodes.push(
          <RunControl
            key={`control:${run.id}`}
            run={run}
            members={items.filter((item) => item.origin?.runId === run.id)}
            eligible={eligible}
            open={open}
            connected={connected}
            onToggle={() => {
              focusHeld.current.delete(run.id)
              setChoices((old) => ({ ...old, [run.id]: { open: !open, epoch: (old[run.id]?.epoch ?? 0) + (open ? 1 : 0) } }))
            }}
          />,
        )
    }
    nodes.push(
      <ProcessDisclosureReset.Provider key={seat.id} value={choice?.epoch ?? 0}>
        <ProcessFocusLock.Provider value={acquisitions.current.get(seat.id)!}>
          <div
            data-slot="process-seat"
            hidden={!open}
            onFocusCapture={() => {
              focusedRuns.current.add(seat.runId)
              focusedGroups.current.add(seat.id)
            }}
            onBlurCapture={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) {
                focusedRuns.current.delete(seat.runId)
                focusedGroups.current.delete(seat.id)
              }
            }}
          >
            <Group
              group={seat}
              running={!run || run.status === 'unknown' || run.status === 'running'}
              hidden={!open}
              focused={groupFocused}
              renderItem={renderItem}
            />
          </div>
        </ProcessFocusLock.Provider>
      </ProcessDisclosureReset.Provider>,
    )
  }
  return (
    <div data-slot="process-timeline" className="conversation-process-timeline">
      {nodes}
    </div>
  )
}
