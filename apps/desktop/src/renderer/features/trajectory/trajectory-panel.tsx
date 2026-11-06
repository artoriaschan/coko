import { DetailPanel } from './trajectory-details.tsx'
import { cumulativeUsage } from './detail-metrics.tsx'
// Ledger presentation adapted from DeepSeek Harness (MIT), Copyright (c) 2026 DeepSeek.
import * as React from 'react'
import { useStore } from 'zustand'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { RunTrace, SessionEntry } from '@coko/protocol'
import { Button, cn } from '@coko/ui'
import { DownloadIcon, LoaderCircleIcon } from 'lucide-react'
import { SparklesIcon, SettingsIcon, ContextIcon, CompactedIcon, UserIcon, WrenchIcon } from './trajectory-icons.tsx'
import { useOptionalChatStoreApi } from '../../app/chat.tsx'
import { useI18n } from '../../app/i18n.tsx'
import { useSessionDownload } from '../conversation/session-download.tsx'
import { TrajectoryTimeline } from './TrajectoryTimeline.tsx'
import { TrajectoryToolbar } from './TrajectoryToolbar.tsx'
import { useTrajectoryLocale, type TrajectoryTranslate } from './locales.ts'
import { buildTrajectory, stringify, type TrajectoryCellKind, type TrajectoryCellProps } from './trajectory-record.ts'
import { trajectoryTimelineFocusIndexes, type TrajectoryTimeRange } from './timeline.ts'
import { completeTrajectoryInspect, trajectoryInspectStore } from './inspect-store.ts'
import { projectLedger, ledgerRowHeight, type LedgerRow } from './ledger.ts'
import { trajectoryPreviewText } from './preview.ts'
import css from './trajectory-panel.module.css'

const EMPTY_ENTRIES: readonly SessionEntry[] = []
const ICONS = {
  system: SettingsIcon,
  user: UserIcon,
  context: ContextIcon,
  compacted: CompactedIcon,
  message: SparklesIcon,
  tool: WrenchIcon,
  subtool: WrenchIcon,
}
const kindKey = (kind: TrajectoryCellKind) => `kind.${kind === 'message' ? 'assistant' : kind}` as const
const cellText = (cell: TrajectoryCellProps, t: TrajectoryTranslate) => {
  if (cell.promptMissing) return t('record.initialSystemPromptUnrecorded')
  if (cell.contextRemoved) return t('record.contextRemoved', { name: cell.contextSection ?? '' })
  if (cell.promptChange) return t(`layout.${cell.promptChange}`)
  if (cell.id.startsWith('request:') && cell.request) return t(`request.purpose.${cell.request.purpose}`)
  const text = cell.text || cell.thinking || (cell.kind === 'message' ? t('record.assistantToolCalls') : t('record.noContent'))
  return cell.kind === 'tool' || cell.kind === 'subtool' ? text : trajectoryPreviewText(text)
}
const changeSet = <T,>(current: ReadonlySet<T>, value: T) => {
  const next = new Set(current)
  if (next.has(value)) next.delete(value)
  else next.add(value)
  return next
}

function outputPreview(cell: TrajectoryCellProps, t: TrajectoryTranslate): string {
  const images = Array.isArray(cell.outputBlocks)
    ? cell.outputBlocks.filter((block) => block !== null && typeof block === 'object' && block.type === 'image').length
    : 0
  const text = images > 0 && typeof cell.output !== 'string' ? '' : stringify(cell.output)
  return [text, images > 0 ? t('layout.imageCount', { count: images }) : ''].filter(Boolean).join(' · ')
}

function KindTag({ cell, t }: { cell: TrajectoryCellProps; t: TrajectoryTranslate }) {
  const Icon = ICONS[cell.kind]
  return (
    <span className={css.kindTag} data-kind={cell.kind} title={t(kindKey(cell.kind))}>
      <Icon aria-hidden />
      <span>{t(kindKey(cell.kind))}</span>
    </span>
  )
}

/** Expand JSON lazily so inspecting a large tool result never builds its entire tree. */
export function TrajectoryPanel({ sessionId, runs }: { sessionId: string; runs: readonly RunTrace[] }) {
  const t = useTrajectoryLocale()
  const { t: appT } = useI18n()
  const chat = useOptionalChatStoreApi()
  const conversation = React.useSyncExternalStore(chat?.subscribe ?? (() => () => {}), () => chat?.getState().conversations[sessionId])
  const entries = conversation?.entries ?? EMPTY_ENTRIES
  const { cells, turns } = React.useMemo(() => buildTrajectory(entries, runs, conversation?.live), [entries, runs, conversation?.live])
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [selectedRequestId, setSelectedRequestId] = React.useState<string | null>(null)
  const [selectionRevision, setSelectionRevision] = React.useState(0)
  const [query, setQuery] = React.useState('')
  const [duration, setDuration] = React.useState(false)
  const [actualTime, setActualTime] = React.useState(false)
  const [range, setRange] = React.useState<TrajectoryTimeRange | null>(null)
  const [collapsedTurns, setCollapsedTurns] = React.useState<ReadonlySet<number>>(new Set())
  const [collapsedAssistants, setCollapsedAssistants] = React.useState<ReadonlySet<string>>(new Set())
  const [collapsedTools, setCollapsedTools] = React.useState<ReadonlySet<string>>(new Set())
  const inspect = useStore(trajectoryInspectStore, (state) => state.requests[sessionId])
  const pane = React.useRef<HTMLDivElement>(null)
  const pendingScroll = React.useRef<string | null>(null)
  const followsTail = React.useRef(true)
  const { exporting, download } = useSessionDownload(sessionId)
  const mode = duration ? (actualTime ? 'actual' : 'duration') : actualTime ? 'time' : 'sequence'
  const focusIndexes = React.useMemo(() => (range === null ? null : trajectoryTimelineFocusIndexes(turns, range, mode)), [turns, range, mode])
  const matches = React.useMemo(
    () =>
      query.trim() === ''
        ? null
        : new Set(
            cells
              .filter((cell) =>
                `${cell.text}\n${stringify(cell.input)}\n${stringify(cell.output)}\n${cell.thinking ?? ''}`
                  .toLocaleLowerCase()
                  .includes(query.trim().toLocaleLowerCase()),
              )
              .map((cell) => cell.index),
          ),
    [cells, query],
  )
  const childrenByParent = React.useMemo(() => {
    const children = new Map<string, TrajectoryCellProps[]>()
    for (const cell of cells) {
      if (!cell.parentId) continue
      const group = children.get(cell.parentId) ?? []
      group.push(cell)
      children.set(cell.parentId, group)
    }
    return children
  }, [cells])
  const assistantIds = cells.filter((cell) => cell.kind === 'message' && childrenByParent.has(cell.id)).map((cell) => cell.id)
  const turnIds = turns.flatMap((turn) => (turn.turn === null ? [] : [turn.turn]))
  const subtoolIds = cells.filter((cell) => cell.kind === 'tool' && childrenByParent.has(cell.id)).map((cell) => cell.id)
  const allCollapsed = <T,>(ids: T[], set: ReadonlySet<T>) => ids.length > 0 && ids.every((id) => set.has(id))
  const ledger = React.useMemo(
    () => projectLedger(cells, collapsedTurns, collapsedAssistants, collapsedTools, matches, t),
    [cells, matches, collapsedTurns, collapsedAssistants, collapsedTools, t],
  )
  const visible = React.useMemo(() => ledger.map((row) => row.cell), [ledger])
  const virtual = visible.length > 200
  const rowHeight = (_cell: TrajectoryCellProps, index: number) => ledgerRowHeight(ledger[index]!, index === ledger.length - 1)
  const virtualizer = useVirtualizer({
    count: virtual ? visible.length : 0,
    getScrollElement: () => pane.current,
    estimateSize: (index) => rowHeight(visible[index]!, index),
    overscan: 12,
    getItemKey: (index) => ledger[index]!.key,
  })
  React.useLayoutEffect(() => {
    if (virtual) virtualizer.measure()
  }, [virtual, virtualizer, visible, collapsedAssistants, matches])
  const items = virtualizer.getVirtualItems()
  const rendered = virtual ? items.map((item) => ({ row: ledger[item.index]!, position: item.index })) : ledger.map((row, position) => ({ row, position }))
  const selected = cells.find((cell) => cell.id === selectedId)
  const selectedRequest = cells.find((cell) => cell.kind === 'message' && cell.id === selectedRequestId)
  const inspected = selectedRequest ?? selected
  const selectRecord = (cell: TrajectoryCellProps) => {
    setSelectedId(cell.id)
    setSelectedRequestId(null)
    setSelectionRevision((revision) => revision + 1)
  }
  const selectRequest = (cell: TrajectoryCellProps) => {
    setSelectedId(null)
    setSelectedRequestId(cell.id)
    setSelectionRevision((revision) => revision + 1)
  }
  const expandSummary = (row: LedgerRow) => {
    if (row.summary?.kind === 'turn' && row.cell.turn !== null) setCollapsedTurns((current) => changeSet(current, row.cell.turn!))
    else if (row.summary?.kind === 'tool') setCollapsedTools((current) => changeSet(current, row.cell.id))
    else setCollapsedAssistants((current) => changeSet(current, row.cell.id))
  }
  const reveal = React.useCallback((cell: TrajectoryCellProps, select: boolean, clearSearch = true) => {
    if (clearSearch) setQuery('')
    if (cell.turn !== null)
      setCollapsedTurns((current) => {
        const next = new Set(current)
        next.delete(cell.turn!)
        return next
      })
    if (cell.parentId) {
      setCollapsedAssistants((current) => {
        const next = new Set(current)
        next.delete(cell.parentId!)
        return next
      })
      setCollapsedTools((current) => {
        const next = new Set(current)
        next.delete(cell.parentId!)
        return next
      })
    }
    if (select) {
      setSelectedId(cell.id)
      setSelectedRequestId(null)
      setSelectionRevision((revision) => revision + 1)
    }
    pendingScroll.current = cell.id
  }, [])
  React.useEffect(() => {
    if (!inspect) return
    const target = cells.find((cell) => cell.toolCallId === inspect.toolCallId)
    if (!target) return
    setRange(null)
    reveal(target, true)
    completeTrajectoryInspect(sessionId, inspect.revision)
  }, [inspect, cells, reveal, sessionId])
  React.useLayoutEffect(() => {
    const scroll = pane.current
    if (!scroll) return
    const id = pendingScroll.current
    if (id) {
      const position = visible.findIndex((cell) => cell.id === id)
      if (position < 0) return
      if (virtual) virtualizer.scrollToIndex(position, { align: 'center' })
      else
        scroll.scrollTop = Math.max(0, visible.slice(0, position).reduce((height, cell, index) => height + rowHeight(cell, index), 0) - scroll.clientHeight / 2)
      const frame = requestAnimationFrame(() => {
        const row = [...scroll.querySelectorAll<HTMLElement>('[data-record-id]')].find((el) => el.dataset.recordId === id)
        if (row) {
          row.focus({ preventScroll: true })
          pendingScroll.current = null
        }
      })
      return () => cancelAnimationFrame(frame)
    }
    if (followsTail.current && selectedId === null && selectedRequestId === null && matches === null) scroll.scrollTop = scroll.scrollHeight
  }, [visible, selectedId, selectedRequestId, matches, virtual, virtualizer, items])
  return (
    <div className={css.root} data-slot="trajectory-panel">
      <div className={css.toolbar}>
        <TrajectoryToolbar
          t={t}
          actualDuration={duration}
          onActualDurationChange={(next) => {
            setDuration(next)
            setRange(null)
          }}
          actualTime={actualTime}
          onActualTimeChange={setActualTime}
          allTurnsCollapsed={allCollapsed(turnIds, collapsedTurns)}
          onToggleAllTurns={() => setCollapsedTurns(allCollapsed(turnIds, collapsedTurns) ? new Set() : new Set(turnIds))}
          allAssistantsCollapsed={allCollapsed(assistantIds, collapsedAssistants)}
          onToggleAllAssistants={() => setCollapsedAssistants(allCollapsed(assistantIds, collapsedAssistants) ? new Set() : new Set(assistantIds))}
          allSubCallsCollapsed={allCollapsed(subtoolIds, collapsedTools)}
          onToggleAllSubCalls={() => setCollapsedTools(allCollapsed(subtoolIds, collapsedTools) ? new Set() : new Set(subtoolIds))}
          searchQuery={query}
          onSearchQueryChange={setQuery}
        />
        <Button
          variant="ghost"
          size="icon-sm"
          data-action="export-session"
          aria-label={exporting ? appT('trace.exporting') : appT('trace.export')}
          disabled={exporting}
          onClick={() => void download()}
        >
          {exporting ? <LoaderCircleIcon className="animate-spin" /> : <DownloadIcon />}
        </Button>
      </div>
      <TrajectoryTimeline
        t={t}
        turns={turns}
        mode={mode}
        range={range}
        onRangeChange={setRange}
        selectedIndex={selected?.index ?? null}
        searchMatchIndexes={matches}
        onRecordSelect={(index) => {
          const cell = cells.find((cell) => cell.index === index)
          if (cell) reveal(cell, true)
        }}
        onRecordFocus={(index) => {
          const cell = cells.find((cell) => cell.index === index)
          if (cell) reveal(cell, false)
        }}
      />
      <div
        className={css.split}
        onKeyDown={(event) => {
          if (event.defaultPrevented) return
          if (event.key === 'Escape') {
            setSelectedId(null)
            setSelectedRequestId(null)
            setRange(null)
          }
        }}
      >
        <div
          ref={pane}
          className={css.tablePane}
          data-scroll-stable
          onScroll={(event) => {
            const el = event.currentTarget
            followsTail.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setSelectedId(null)
              setSelectedRequestId(null)
            }
          }}
        >
          <table className={css.table} aria-label={t('view.trajectory')}>
            <colgroup>
              <col className={css.eventColumn} />
              <col />
            </colgroup>
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">{t('view.trajectory')}</th>
              </tr>
            </thead>
            <tbody>
              {virtual && (items[0]?.start ?? 0) > 0 && (
                <tr aria-hidden data-virtual-spacer>
                  <td colSpan={2} style={{ height: items[0]!.start, padding: 0 }} />
                </tr>
              )}
              {rendered.map(({ row, position }) => {
                const { cell, summary, turnStart, turnEnd } = row
                const requestBoundary =
                  !summary && cell.kind === 'message' && cell.requestNumber !== undefined && (cell.turn === null || !collapsedTurns.has(cell.turn))
                const activeTurn = inspected?.turn === cell.turn && inspected?.turn !== null
                const select = () => (summary ? expandSummary(row) : cell.requestOnly ? undefined : selectRecord(cell))
                const label = summary
                  ? t('request.collapsedSummary', {
                      kind: t(
                        summary.kind === 'turn'
                          ? 'request.collapsedTurn'
                          : summary.kind === 'assistant'
                            ? 'request.collapsedAssistant'
                            : 'request.collapsedTool',
                      ),
                      summary: summary.text,
                    })
                  : `${requestBoundary ? t('request.label', { request: cell.requestNumber! }) + ' ' : ''}${t(kindKey(cell.kind))}: ${cellText(cell, t)}`
                return (
                  <tr
                    key={row.key}
                    tabIndex={cell.requestOnly ? -1 : 0}
                    aria-rowindex={position + 2}
                    aria-label={label}
                    aria-selected={!summary && !cell.requestOnly && selectedId === cell.id}
                    data-record-id={!summary && !cell.requestOnly ? cell.id : undefined}
                    data-ledger-key={row.key}
                    data-kind={cell.kind}
                    data-context-section={cell.contextSection}
                    data-tool-call-id={!summary ? cell.toolCallId : undefined}
                    data-request-id={cell.request?.requestId}
                    data-request-purpose={cell.request?.purpose}
                    data-request-only={cell.requestOnly || undefined}
                    data-terminal-request-boundary={(cell.requestOnly && position === ledger.length - 1) || undefined}
                    data-collapsed-summary={summary?.kind}
                    data-turn-start={turnStart || undefined}
                    data-turn-end={turnEnd || undefined}
                    data-group-start={requestBoundary || undefined}
                    data-selected={(!summary && selectedId === cell.id) || undefined}
                    data-error={cell.isError || undefined}
                    data-timeline-focus={!summary && focusIndexes !== null && !focusIndexes.has(cell.index) ? 'outside' : undefined}
                    onClick={select}
                    onDoubleClick={(event) => {
                      if (summary || cell.requestOnly) return
                      event.preventDefault()
                      if (cell.turn !== null && collapsedTurns.has(cell.turn)) setCollapsedTurns((current) => changeSet(current, cell.turn!))
                      else if (cell.kind === 'message' && childrenByParent.has(cell.id)) setCollapsedAssistants((current) => changeSet(current, cell.id))
                      else if (
                        turnStart &&
                        cell.turn !== null &&
                        cells.filter((item) => item.turn === cell.turn && item.kind !== 'system' && !item.requestOnly).length > 1
                      )
                        setCollapsedTurns((current) => changeSet(current, cell.turn!))
                    }}
                    onKeyDown={(event) => {
                      if (event.target !== event.currentTarget) return
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        select()
                      } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                        event.preventDefault()
                        const direction = event.key === 'ArrowDown' ? 1 : -1
                        let nextIndex = position + direction
                        while (ledger[nextIndex]?.cell.requestOnly) nextIndex += direction
                        const next = ledger[nextIndex]
                        if (!next) return
                        if (!next.summary) reveal(next.cell, true, false)
                        else {
                          if (virtual) virtualizer.scrollToIndex(nextIndex, { align: 'auto' })
                          requestAnimationFrame(() =>
                            [...(pane.current?.querySelectorAll<HTMLElement>('[data-ledger-key]') ?? [])]
                              .find((el) => el.dataset.ledgerKey === next.key)
                              ?.focus(),
                          )
                        }
                      }
                    }}
                  >
                    <td className={css.event}>
                      {requestBoundary && (
                        <button
                          className={css.requestDot}
                          type="button"
                          data-label={t('request.label', { request: cell.requestNumber! })}
                          aria-label={t('request.label', { request: cell.requestNumber! })}
                          aria-pressed={selectedRequestId === cell.id}
                          data-request-status={cell.isError ? 'error' : undefined}
                          onClick={(event) => {
                            event.stopPropagation()
                            selectRequest(cell)
                          }}
                          onDoubleClick={(event) => event.stopPropagation()}
                        />
                      )}
                      {activeTurn && <span className={css.turnRail} aria-hidden />}
                      {!summary && selectedId === cell.id && <span className={css.selectionRail} aria-hidden />}
                      {!summary && !cell.requestOnly && turnStart && (
                        <span
                          className={cn(css.turnLabel, activeTurn && css.turnLabelActive)}
                          aria-label={cell.turn === null ? t('section.betweenTurns') : t('turn.label', { turn: cell.turn })}
                        >
                          <span className={css.turnLabelFull} aria-hidden>
                            {cell.turn === null ? t('section.betweenTurns') : t('turn.label', { turn: cell.turn })}
                          </span>
                          <span className={css.turnLabelCompact} aria-hidden>
                            #{cell.turn}
                          </span>
                        </span>
                      )}
                      <div className={css.eventInner}>
                        {!summary && !cell.requestOnly && (
                          <span className={css.kindSlot}>
                            <KindTag cell={cell} t={t} />
                          </span>
                        )}
                      </div>
                    </td>
                    <td className={css.content}>
                      {cell.requestOnly ? null : summary ? (
                        <span className={css.collapsedSummary} title={summary.text}>
                          <span aria-hidden>…</span>
                          <span>{summary.text}</span>
                        </span>
                      ) : (
                        <span className={cell.kind === 'tool' || cell.kind === 'subtool' ? css.resultPreview : css.contentText} title={cellText(cell, t)}>
                          <span className={css.requestText}>
                            <span>{cellText(cell, t)}</span>
                            {(cell.kind === 'tool' || cell.kind === 'subtool') && <span className={css.toolArguments}>{stringify(cell.input)}</span>}
                          </span>
                          {(cell.kind === 'tool' || cell.kind === 'subtool') && (
                            <span className={css.inlineResult}>
                              <span aria-hidden>→</span>
                              <span>
                                {cell.output === undefined
                                  ? cell.status === 'running'
                                    ? t('code.running')
                                    : t('record.noResult')
                                  : outputPreview(cell, t) || t('record.noOutput')}
                              </span>
                            </span>
                          )}
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
              {virtual && items.length > 0 && (
                <tr aria-hidden data-virtual-spacer>
                  <td colSpan={2} style={{ height: Math.max(0, virtualizer.getTotalSize() - items.at(-1)!.end), padding: 0 }} />
                </tr>
              )}
            </tbody>
          </table>
          {visible.length === 0 && <p className={css.empty}>{matches === null ? appT('trace.empty') : t('search.noMatches')}</p>}
        </div>
        {inspected && (
          <DetailPanel
            cell={inspected}
            requestDetail={selectedRequest !== undefined}
            cumulative={
              inspected.request
                ? cumulativeUsage(
                    runs.flatMap((run) => run.requests),
                    inspected.request,
                  )
                : undefined
            }
            toolCallCount={childrenByParent.get(inspected.id)?.length ?? 0}
            selectionRevision={selectionRevision}
            onOpenCall={(id) => {
              const target = cells.find((cell) => cell.toolCallId === id || cell.id === id)
              if (target) reveal(target, true)
            }}
            onOpenRequest={() => {
              const target = cells.find((cell) => cell.kind === 'message' && cell.requestNumber === inspected.requestNumber)
              if (target) selectRequest(target)
            }}
            onClose={() => {
              const target = pane.current?.querySelector<HTMLElement>(selectedRequest ? 'button[aria-pressed="true"]' : '[data-selected="true"]')
              setSelectedId(null)
              setSelectedRequestId(null)
              target?.focus()
            }}
          />
        )}
      </div>
    </div>
  )
}
