import type * as React from 'react'
import { HoverCardContent } from './hover-card.tsx'
import { cn } from '../lib/utils.ts'

/** 整行锚点的首选位置；共享窗口避让仍由 Radix 处理。 */
export const rowOverlayPosition = { side: 'right', align: 'start', sideOffset: 2 } as const

export function RowHoverCardContent({ className, ...props }: React.ComponentProps<typeof HoverCardContent>) {
  return (
    <HoverCardContent
      {...rowOverlayPosition}
      hideWhenDetached
      className={cn('w-84 max-h-(--radix-hover-card-content-available-height) overflow-y-auto p-1', className)}
      {...props}
    />
  )
}
