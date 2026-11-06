import { useRef, type ReactNode } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@coko/ui'
import css from './trajectory-panel.module.css'

export interface MenuEntry {
  id: string
  label: string
}

/** Keep Harness's click-to-copy / right-click-for-options interaction on Coko's shared menu. */
export function Menu({
  open,
  anchor,
  items,
  onSelect,
  onClose,
  align,
}: {
  open: boolean
  anchor: ReactNode
  items: readonly MenuEntry[]
  onSelect: (id: string) => void
  onClose: () => void
  align?: 'start' | 'end'
  compact?: boolean
  portal?: boolean
  getAnchorRect?: () => DOMRect
}) {
  const root = useRef<HTMLSpanElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const walkIndex = useRef<number | null>(null)
  const close = () => {
    walkIndex.current = null
    onClose()
  }
  return (
    <span
      ref={root}
      onKeyDownCapture={(event) => {
        if (!open || event.defaultPrevented || event.nativeEvent.isComposing || event.ctrlKey || event.altKey || event.metaKey) return
        if (!['Tab', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
        const rows = Array.from(content.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([data-disabled])') ?? [])
        const focused = document.activeElement
        const index = rows.indexOf(focused as HTMLElement)
        if (!root.current?.contains(focused) && !content.current?.contains(focused)) return
        event.preventDefault()
        event.stopPropagation()
        if (event.key === 'Tab') {
          if (event.shiftKey) {
            close()
            root.current?.querySelector('button')?.focus()
          } else if (index >= 0) rows[index]?.click()
          else {
            rows[0]?.focus()
            walkIndex.current = 0
          }
          return
        }
        const from = index >= 0 ? index : walkIndex.current
        const next =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? rows.length - 1
              : from === null
                ? event.key === 'ArrowDown'
                  ? 0
                  : rows.length - 1
                : (from + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length
        rows[next]?.focus()
        walkIndex.current = next
      }}
    >
      <Popover
        open={open}
        onOpenChange={(next) => {
          if (!next) {
            close()
          }
        }}
      >
        <PopoverTrigger asChild aria-haspopup="menu">
          {anchor}
        </PopoverTrigger>
        <PopoverContent
          ref={content}
          role="menu"
          className={css.jsonCopyMenu}
          align={align}
          sideOffset={4}
          collisionPadding={12}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onFocusOutside={(event) => event.preventDefault()}
          onEscapeKeyDown={(event) => event.stopPropagation()}
        >
          {items.map((item) => (
            <button
              type="button"
              role="menuitem"
              key={item.id}
              className={css.jsonCopyMenuItem}
              onClick={() => {
                onSelect(item.id)
                close()
              }}
            >
              {item.label}
            </button>
          ))}
        </PopoverContent>
      </Popover>
    </span>
  )
}
