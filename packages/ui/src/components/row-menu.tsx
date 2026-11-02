import type * as React from 'react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from './dropdown-menu.tsx'
import { rowOverlayPosition } from './row-hover-card.tsx'

export type RowMenuPoint = { x: number; y: number }

/** Place inside a positioned row. A pointer anchor uses viewport coordinates. */
export function RowMenu({
  open,
  onOpenChange,
  point,
  label,
  onCloseAutoFocus,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  point: RowMenuPoint | null
  label: string
  onCloseAutoFocus: (event: Event) => void
  children: React.ReactNode
}) {
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange} modal={false}>
      <DropdownMenuTrigger asChild>
        <span
          aria-hidden
          tabIndex={-1}
          className={point ? 'pointer-events-none fixed size-0' : 'pointer-events-none absolute inset-0'}
          style={point ? { left: point.x, top: point.y } : undefined}
        />
      </DropdownMenuTrigger>
      {open && (
        <DropdownMenuContent
          {...rowOverlayPosition}
          sideOffset={point ? 0 : rowOverlayPosition.sideOffset}
          aria-label={label}
          hideWhenDetached
          onCloseAutoFocus={onCloseAutoFocus}
        >
          {children}
        </DropdownMenuContent>
      )}
    </DropdownMenu>
  )
}
