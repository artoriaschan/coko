import { Tooltip, TooltipTrigger, TooltipContent } from '@coko/ui'
import type { ReactElement } from 'react'

export function TrajectoryTooltip({
  label,
  side,
  delayMs,
  children,
}: {
  label: string | (() => string)
  side: 'bottom' | 'right'
  delayMs?: number
  children: ReactElement
}) {
  return (
    <Tooltip delayDuration={delayMs}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side} className="whitespace-pre-line">
        {typeof label === 'function' ? label() : label}
      </TooltipContent>
    </Tooltip>
  )
}
