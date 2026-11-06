import * as React from 'react'
import { useI18n } from '../../app/i18n.tsx'
import './conversation-width.css'

const WIDTH_KEY = 'coko.conversation.contentWidth'
const minimum = 640
const edgeBudget = 176
const maximumWidth = (column: number) => Math.max(680, column - edgeBudget)
const resolveWidth = (column: number, preference: number | null) => Math.min(Math.max(preference ?? maximumWidth(column), minimum), maximumWidth(column))

/** Open the reading column wide by default; explicit drag preferences share the composer axis. */
export function useConversationWidth() {
  const [container, ref] = React.useState<HTMLDivElement | null>(null)
  const [column, setColumn] = React.useState(0)
  const [preference, setPreference] = React.useState(() => {
    const value = Number(localStorage.getItem(WIDTH_KEY))
    return Number.isFinite(value) && value > 0 ? value : null
  })
  const [dragWidth, setDragWidth] = React.useState<number | null>(null)
  React.useLayoutEffect(() => {
    if (!container) return
    const observer = new ResizeObserver(() => setColumn(container.clientWidth))
    observer.observe(container)
    setColumn(container.clientWidth)
    return () => observer.disconnect()
  }, [container])
  const width = resolveWidth(column, dragWidth ?? preference)
  const commit = (value: number | null) => {
    if (value === null) localStorage.removeItem(WIDTH_KEY)
    else localStorage.setItem(WIDTH_KEY, String(resolveWidth(column, value)))
    setPreference(value === null ? null : resolveWidth(column, value))
    setDragWidth(null)
  }
  return {
    ref,
    width,
    maximum: maximumWidth(column),
    available: column - width >= 116,
    drag: setDragWidth,
    commit,
    cancel: () => setDragWidth(null),
    style: { '--local-chat-content-width': `${width}px` } as React.CSSProperties,
  }
}

export function ConversationWidthControls({ layout }: { layout: ReturnType<typeof useConversationWidth> }) {
  const { t } = useI18n()
  const drag = React.useRef<{ x: number; width: number; latest: number } | null>(null)
  if (!layout.available) return null
  return (['left', 'right'] as const).map((side) => (
    <div
      key={side}
      role="separator"
      aria-orientation="vertical"
      aria-label={t('conversation.contentWidth')}
      aria-valuemin={minimum}
      aria-valuemax={Math.round(Math.max(layout.maximum, layout.width))}
      aria-valuenow={Math.round(layout.width)}
      tabIndex={0}
      data-slot="conversation-width-handle"
      data-side={side}
      className="conversation-width-handle focus-ring"
      onPointerDown={(event) => {
        if (event.button !== 0) return
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        drag.current = { x: event.clientX, width: layout.width, latest: layout.width }
      }}
      onPointerMove={(event) => {
        const current = drag.current
        if (!current || !event.currentTarget.hasPointerCapture(event.pointerId)) return
        current.latest = current.width + (event.clientX - current.x) * (side === 'right' ? 2 : -2)
        layout.drag(current.latest)
      }}
      onPointerUp={(event) => {
        if (!drag.current || !event.currentTarget.hasPointerCapture(event.pointerId)) return
        if (event.clientX !== drag.current.x) layout.commit(drag.current.width + (event.clientX - drag.current.x) * (side === 'right' ? 2 : -2))
        drag.current = null
        event.currentTarget.releasePointerCapture(event.pointerId)
      }}
      onLostPointerCapture={() => {
        drag.current = null
        layout.cancel()
      }}
      onPointerCancel={() => {
        drag.current = null
        layout.cancel()
      }}
      onDoubleClick={() => layout.commit(null)}
      onWheel={(event) => {
        const scrollport = event.currentTarget.parentElement?.querySelector<HTMLElement>('.conversation-message-scroll')
        if (!scrollport || event.ctrlKey) return
        const scale = event.deltaMode === 2 ? scrollport.clientHeight : event.deltaMode === 1 ? 16 : 1
        scrollport.scrollBy({ top: event.deltaY * scale })
      }}
      onKeyDown={(event) => {
        if (event.key === 'Home') {
          event.preventDefault()
          layout.commit(null)
        } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault()
          layout.commit(layout.width + (event.key === 'ArrowRight' ? 1 : -1) * (side === 'right' ? 32 : -32))
        }
      }}
    />
  ))
}
