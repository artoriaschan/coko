// Adapted from DeepSeek Harness (MIT), Copyright (c) 2026 DeepSeek.
import { Button, Tooltip, TooltipContent, TooltipTrigger } from '@coko/ui'
import { defaultRangeExtractor, useVirtualizer, type Range, type Virtualizer } from '@tanstack/react-virtual'
import { ChevronDownIcon, ChevronRightIcon } from 'lucide-react'
import * as React from 'react'
import { useI18n } from '../../app/i18n.tsx'
import { DiagnosticTableHierarchy, diagnosticRowCollapsed, type DiagnosticDisclosure, type DiagnosticRow } from './table-model.ts'
import { DiagnosticTableLayout, DIAGNOSTIC_ROW_HEIGHT, type DiagnosticRowAnchor } from './table-layout.ts'
import type { DiagnosticModel, DiagnosticRecord } from './table-model.ts'
import { diagnosticPreview } from './format.ts'
import { RecordDetails } from './record-details.tsx'
import './diagnostic-table.css'

/** 共享的只读表格；数据模型不拥有滚动、选择、折叠或详情高度。 */
export function DiagnosticTable({
  model,
  showTime = true,
  toolbar,
  renderDetails,
  onSelect,
  changedKeys,
  revealRequest,
}: {
  model: DiagnosticModel
  showTime?: boolean
  toolbar?: React.ReactNode
  renderDetails?: (record: DiagnosticRecord | undefined, selectedKey: string) => React.ReactNode
  onSelect?: (key: string | null) => void
  changedKeys?: ReadonlySet<string>
  revealRequest?: { key: string; nonce: object } | undefined
}) {
  void revealRequest // The shared table reveal controller is integrated by the filter ticket.
  const { t } = useI18n()
  const [selected, updateSelected] = React.useState<string | null>(null)
  const setSelected = (key: string | null) => {
    updateSelected(key)
    onSelect?.(key)
  }
  const [disclosures, setDisclosures] = React.useState<ReadonlyMap<string, DiagnosticDisclosure>>(new Map())
  const scroller = React.useRef<HTMLDivElement>(null)
  const follow = React.useRef<'tail' | 'scroll' | 'manual'>('tail')
  const viewport = React.useRef({ offset: 0, height: 600 })
  const anchor = React.useRef<DiagnosticRowAnchor | undefined>(undefined)
  const [spacingGeneration, resetSpacing] = React.useState(0)
  const hierarchy = React.useMemo(() => new DiagnosticTableHierarchy(model.rows, disclosures), [model.rows, disclosures])
  const committed = React.useRef<{ layout: DiagnosticTableLayout; disclosures: typeof disclosures; spacingGeneration: number } | undefined>(undefined)
  const layout = React.useMemo(
    () =>
      new DiagnosticTableLayout(
        hierarchy,
        committed.current?.disclosures === disclosures && committed.current.spacingGeneration === spacingGeneration ? committed.current.layout : undefined,
        viewport.current,
        anchor.current,
      ),
    [hierarchy, disclosures, spacingGeneration],
  )
  const anchoredOffset = committed.current?.layout !== layout ? layout.scrollOffset : undefined
  const virtualRef = React.useRef<Virtualizer<HTMLDivElement, HTMLTableRowElement> | undefined>(undefined)
  const rangeExtractor = React.useCallback(
    (range: Range) => {
      const offset = anchoredOffset ?? virtualRef.current?.scrollOffset ?? 0
      const visible =
        anchoredOffset === undefined
          ? range
          : {
              ...range,
              startIndex: Math.max(0, Math.floor(offset / DIAGNOSTIC_ROW_HEIGHT) - 1),
              endIndex: Math.min(range.count - 1, Math.ceil((offset + viewport.current.height) / DIAGNOSTIC_ROW_HEIGHT) - 1),
            }
      return [...new Set([...layout.stickyIndexesAtOffset(offset), ...defaultRangeExtractor(visible)])].sort((left, right) => left - right)
    },
    [layout, anchoredOffset],
  )
  const virtual = useVirtualizer<HTMLDivElement, HTMLTableRowElement>({
    count: layout.items.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => DIAGNOSTIC_ROW_HEIGHT,
    getItemKey: (index) => layout.items[index]!.key,
    overscan: 12,
    initialRect: { width: 0, height: 600 },
    anchorTo: layout.scrollOffset !== undefined || follow.current !== 'tail' ? 'start' : 'end',
    scrollEndThreshold: 40,
    paddingStart: DIAGNOSTIC_ROW_HEIGHT,
    scrollPaddingStart: DIAGNOSTIC_ROW_HEIGHT,
    paddingEnd: layout.bottomPadding,
    rangeExtractor,
  })
  virtualRef.current = virtual
  const viewportHeight = virtual.scrollRect?.height
  React.useLayoutEffect(() => {
    if (anchoredOffset !== undefined) virtual.scrollToOffset(anchoredOffset)
    else if (follow.current === 'tail' && layout.bottomPadding === 0) virtual.scrollToEnd()
    if (scroller.current) viewport.current = { offset: scroller.current.scrollTop, height: viewportHeight ?? 600 }
    anchor.current = undefined
    committed.current = { layout, disclosures, spacingGeneration }
  }, [virtual, layout, disclosures, spacingGeneration, viewportHeight, anchoredOffset])
  const toggle = (row: DiagnosticRow, element: HTMLTableRowElement) => {
    const host = scroller.current
    if (!host) return
    follow.current = 'manual'
    anchor.current = { key: row.key, top: element.getBoundingClientRect().top - host.getBoundingClientRect().top - host.clientTop }
    viewport.current = { offset: host.scrollTop, height: host.clientHeight }
    setDisclosures((previous) => new Map(previous).set(row.key, { state: row.disclosure, collapsed: !diagnosticRowCollapsed(row, previous) }))
  }
  const items = virtual.getVirtualItems()
  const sticky = new Map(layout.stickyIndexesAtOffset(anchoredOffset ?? virtual.scrollOffset ?? 0).map((index, level) => [index, level]))
  const last = items.at(-1)
  const bottom = last ? Math.max(0, virtual.getTotalSize() - last.end) : 0
  const columns = showTime ? 5 : 4
  const selectedRecord = selected === null ? undefined : model.records.get(selected)
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 px-3 py-2">
        {toolbar}
        <span className="ms-auto text-ui-caption text-muted-foreground" role="status" aria-label={t('diagnostics.rowCount')}>
          {t('diagnostics.rows', { count: model.rows.length })}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            follow.current = 'tail'
            resetSpacing((value) => value + 1)
          }}
        >
          {t('diagnostics.latest')}
        </Button>
      </div>
      <div
        ref={scroller}
        data-slot="diagnostic-scroll"
        className="min-h-0 flex-1 overflow-auto [overflow-anchor:none]"
        data-scroll-stable
        onScroll={(event) => {
          const host = event.currentTarget
          const before = viewport.current.offset
          viewport.current = { offset: host.scrollTop, height: host.clientHeight }
          if (host.scrollTop < before && anchoredOffset === undefined) follow.current = 'scroll'
          else if (follow.current !== 'manual') follow.current = host.scrollHeight - host.clientHeight - host.scrollTop <= 40 ? 'tail' : 'scroll'
        }}
      >
        <table className="diagnostic-table text-ui-caption" aria-label={t('diagnostics.title')} aria-rowcount={hierarchy.rows.length + 1}>
          <colgroup>
            <col style={{ width: 64 }} />
            <col style={{ width: 190 }} />
            <col style={{ width: 60 }} />
            {showTime && <col style={{ width: 100 }} />}
            <col />
          </colgroup>
          <thead>
            <tr>
              <th className="font-medium">{t('diagnostics.sequence')}</th>
              <th className="font-medium">{t('diagnostics.type')}</th>
              <th className="font-medium">{t('diagnostics.run')}</th>
              {showTime && <th className="font-medium">{t('diagnostics.time')}</th>}
              <th className="font-medium">{t('diagnostics.data')}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, position) => {
              const gap = item.start - (items[position - 1]?.end ?? DIAGNOSTIC_ROW_HEIGHT)
              const row = layout.items[item.index]!.row
              const record = model.records.get(row.key)
              const level = sticky.get(item.index)
              const collapsed = diagnosticRowCollapsed(row, disclosures)
              const summary = record?.summary ?? diagnosticPreview(record?.value)
              return (
                <React.Fragment key={item.key}>
                  {gap > 0 && (
                    <tr aria-hidden>
                      <td colSpan={columns} style={{ height: gap, padding: 0 }} />
                    </tr>
                  )}
                  <tr
                    className="hover:bg-accent"
                    data-record-key={row.key}
                    data-diagnostic-updated={changedKeys?.has(row.key) || undefined}
                    aria-rowindex={item.index + 2}
                    aria-selected={row.key === selected}
                    data-sticky={level === undefined ? undefined : ''}
                    style={level === undefined ? undefined : { top: (level + 1) * DIAGNOSTIC_ROW_HEIGHT, zIndex: 19 - level }}
                  >
                    <td>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span tabIndex={0}>{record?.identity}</span>
                        </TooltipTrigger>
                        <TooltipContent>{record?.identity}</TooltipContent>
                      </Tooltip>
                    </td>
                    <td style={{ paddingInlineStart: 8 + row.depth * 20 }}>
                      <div className="flex items-center gap-1">
                        {hierarchy.isBranch(row.key) && (
                          <button
                            type="button"
                            className="flex size-5 shrink-0 items-center justify-center rounded-xs focus-ring hover:bg-muted"
                            aria-label={t(collapsed ? 'diagnostics.expand' : 'diagnostics.collapse', { type: record?.type ?? '' })}
                            aria-expanded={!collapsed}
                            onClick={(event) => toggle(row, event.currentTarget.closest('tr')!)}
                          >
                            {collapsed ? <ChevronRightIcon className="size-3.5" aria-hidden /> : <ChevronDownIcon className="size-3.5" aria-hidden />}
                          </button>
                        )}
                        <button type="button" className="min-w-0 truncate focus-ring" onClick={() => setSelected(row.key)}>
                          {record?.type}
                        </button>
                      </div>
                    </td>
                    <td>{record?.location}</td>
                    {showTime && <td>{record?.time === undefined ? '' : new Date(record.time).toISOString().slice(11, 23)}</td>}
                    <td>
                      <button
                        type="button"
                        className="block max-w-full truncate text-start focus-ring"
                        aria-label={t('diagnostics.inspect', { sequence: record?.identity ?? '' })}
                        onClick={() => setSelected(row.key)}
                      >
                        {collapsed ? (record?.collapsedSummary ?? summary) : summary}
                      </button>
                    </td>
                  </tr>
                </React.Fragment>
              )
            })}
            {bottom > 0 && (
              <tr aria-hidden data-diagnostic-fold-space={layout.bottomPadding > 0 ? '' : undefined}>
                <td colSpan={columns} style={{ height: bottom, padding: 0 }} />
              </tr>
            )}
          </tbody>
        </table>
        {model.rows.length === 0 && <p className="p-3 text-ui-body text-muted-foreground">{t('diagnostics.empty')}</p>}
      </div>
      {selected !== null && (
        <RecordDetails value={selectedRecord?.value} removed={selectedRecord === undefined} onClose={() => setSelected(null)}>
          {renderDetails?.(selectedRecord, selected)}
        </RecordDetails>
      )}
    </div>
  )
}
