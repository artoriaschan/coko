import * as React from 'react'
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual'
import { MarkdownRenderer } from '@coko/ui/markdown'
import type { Theme } from '../../app/appearance-store.ts'
import { useI18n } from '../../app/i18n.tsx'
import type { TimelineItem } from './timeline.ts'
import './turn-navigator.css'

export interface NavigationTurn {
  id: string
  number: number
  anchorKey: string
  prompt: string
  response: string
}

/** Only visible, top-level items with recorded Run ownership contribute a mark. */
export function navigationTurns(items: readonly TimelineItem[]): NavigationTurn[] {
  const turns = new Map<string, NavigationTurn>()
  for (const item of items) {
    const id = item.origin?.runId
    if (!id || item.kind === 'run-usage' || item.kind === 'steering') continue
    let turn = turns.get(id)
    if (!turn) {
      turn = { id, number: turns.size + 1, anchorKey: item.key, prompt: '', response: '' }
      turns.set(id, turn)
    }
    if (item.kind === 'user' && turn.prompt === '') {
      turn.prompt = item.invocation ?? item.text
      turn.anchorKey = item.key
    }
    if (item.kind === 'text') turn.response = item.text
    if (item.kind === 'schedule-fire') turn.prompt = item.prompt ?? item.title ?? ''
  }
  return [...turns.values()]
}

export function TurnNavigator({
  items,
  scrollport,
  onNavigate,
  theme,
}: {
  items: readonly TimelineItem[]
  scrollport: HTMLDivElement | null
  onNavigate: (element: HTMLElement) => void
  theme: Theme
}) {
  const { t, dictionary } = useI18n()
  const turns = React.useMemo(() => navigationTurns(items), [items])
  const [active, setActive] = React.useState<string | null>(null)
  const [preview, setPreview] = React.useState<string | null>(null)
  const [focused, setFocused] = React.useState<string | null>(null)
  const rail = React.useRef<HTMLDivElement>(null)
  const [pointerInside, setPointerInside] = React.useState(false)
  const previewId = React.useId()
  const anchor = React.useCallback(
    (turn: NavigationTurn) => {
      if (!scrollport) return undefined
      return (
        scrollport.querySelector<HTMLElement>(
          `.conversation-message-column > [data-slot="process-timeline"] > [data-timeline-identity="${CSS.escape(turn.anchorKey)}"]`,
        ) ??
        scrollport.querySelector<HTMLElement>(`.conversation-message-column > [data-slot="process-timeline"] > [data-run-id="${CSS.escape(turn.id)}"]`) ??
        undefined
      )
    },
    [scrollport],
  )
  const virtualizer = useVirtualizer({
    count: turns.length,
    getScrollElement: () => rail.current,
    getItemKey: (index) => turns[index]!.id,
    estimateSize: () => 10,
    paddingStart: 6,
    paddingEnd: 6,
    overscan: 4,
    rangeExtractor: (range) => {
      const indexes = defaultRangeExtractor(range)
      const index = turns.findIndex((turn) => turn.id === focused)
      if (index >= 0 && !indexes.includes(index)) indexes.push(index)
      return indexes.sort((a, b) => a - b)
    },
  })
  React.useLayoutEffect(() => {
    if (!scrollport) return
    let frame = 0
    const update = () => {
      frame = 0
      const line = scrollport.getBoundingClientRect().top + Math.min(80, scrollport.clientHeight / 4)
      let current = turns[0]?.id ?? null
      for (const turn of turns) {
        const element = anchor(turn)
        if (element && element.getBoundingClientRect().top <= line) current = turn.id
      }
      if (scrollport.scrollHeight - scrollport.clientHeight - scrollport.scrollTop <= 1) current = turns.at(-1)?.id ?? null
      setActive(current)
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    const observer = new ResizeObserver(schedule)
    observer.observe(scrollport)
    if (scrollport.firstElementChild) observer.observe(scrollport.firstElementChild)
    scrollport.addEventListener('scroll', schedule)
    scrollport.addEventListener('coko-flow-layout', schedule)
    update()
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      scrollport.removeEventListener('scroll', schedule)
      scrollport.removeEventListener('coko-flow-layout', schedule)
    }
  }, [turns, scrollport, anchor])
  React.useLayoutEffect(() => {
    const index = turns.findIndex((turn) => turn.id === active)
    const element = rail.current
    if (!element || index < 0 || pointerInside) return
    const center = 6 + index * 10 + 5
    if (center < element.scrollTop + 24 || center > element.scrollTop + element.clientHeight - 24)
      element.scrollTo({ top: center - element.clientHeight / 2, behavior: 'instant' })
  }, [active, turns, pointerInside, virtualizer.scrollRect?.height])
  if (turns.length < 2) return null
  const shown = turns.find((turn) => turn.id === preview)
  const index = turns.findIndex((turn) => turn.id === preview)
  const offset = virtualizer.scrollOffset ?? 0
  const height = virtualizer.scrollRect?.height ?? 0
  return (
    <nav
      data-slot="turn-navigator"
      className="conversation-turn-navigator"
      aria-label={t('conversation.turnNavigation')}
      style={{ '--local-turn-total-height': `${virtualizer.getTotalSize()}px` } as React.CSSProperties}
      onPointerEnter={() => setPointerInside(true)}
      onPointerLeave={() => {
        setPointerInside(false)
        setPreview(focused)
      }}
    >
      <div
        ref={rail}
        className="conversation-turn-scroller panel-tab-scroll"
        data-fade-top={offset > 1 || undefined}
        data-fade-bottom={offset < virtualizer.getTotalSize() - height - 1 || undefined}
      >
        <div className="conversation-turn-marks" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((row) => {
            const turn = turns[row.index]!
            return (
              <button
                key={turn.id}
                type="button"
                className="conversation-turn-mark rounded-sm"
                data-turn={turn.number}
                style={{ transform: `translateY(${row.start}px)` }}
                aria-label={t('conversation.jumpToTurn', { turn: turn.number })}
                aria-current={active === turn.id ? 'true' : undefined}
                aria-describedby={preview === turn.id ? previewId : undefined}
                data-preview={preview === turn.id || undefined}
                onPointerMove={(event) => {
                  if (event.pointerType !== 'touch') setPreview(turn.id)
                }}
                onFocus={() => {
                  setFocused(turn.id)
                  setPreview(turn.id)
                }}
                onBlur={() => {
                  setFocused(null)
                  setPreview(null)
                }}
                onClick={() => {
                  const element = anchor(turn)
                  if (element) onNavigate(element)
                }}
              />
            )
          })}
        </div>
      </div>
      {shown && (
        <div
          id={previewId}
          role="tooltip"
          className="conversation-turn-preview rounded-lg bg-popover shadow-panel"
          style={{ '--local-turn-preview-center': `${6 + index * 10 + 5 - offset}px` } as React.CSSProperties}
        >
          <div className="conversation-turn-prompt text-ui-body font-medium" data-user-content inert>
            <MarkdownRenderer mode="streaming" colorScheme={theme} translations={dictionary.markdown} controls={false}>
              {shown.prompt || t('conversation.turnNumber', { turn: shown.number })}
            </MarkdownRenderer>
          </div>
          {shown.response && (
            <div className="conversation-turn-response text-ui-small text-muted-foreground" data-user-content inert>
              <MarkdownRenderer mode="streaming" colorScheme={theme} translations={dictionary.markdown} controls={false}>
                {shown.response}
              </MarkdownRenderer>
            </div>
          )}
        </div>
      )}
    </nav>
  )
}
