import { CircleXIcon, LightbulbIcon } from 'lucide-react'
import type * as React from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip.tsx'

/** 输入工具栏的计划状态；标签与行为由应用提供，图标替换不改变几何。 */
export function PlanModePill({
  label,
  closeLabel,
  onClose,
  disabled,
}: {
  label: string
  closeLabel: string
  onClose: React.MouseEventHandler<HTMLButtonElement>
  disabled?: boolean
}) {
  return (
    <span data-slot="plan-state" className="inline-flex shrink-0 items-center gap-1">
      <span aria-hidden className="h-4 w-px scale-x-50 bg-border" />
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            data-slot="plan-chip"
            aria-label={closeLabel}
            disabled={disabled}
            onClick={onClose}
            className="group inline-flex h-7 min-w-18 shrink-0 items-center gap-1 rounded-round pl-1 pr-3 text-ui-body text-muted-foreground focus-ring disabled:pointer-events-none disabled:opacity-50 [@media(hover:hover)]:hover:bg-accent focus-visible:bg-accent"
          >
            <span aria-hidden className="relative flex size-6 items-center justify-center">
              <LightbulbIcon className="size-3.5 group-focus-visible:hidden [@media(hover:hover)]:group-hover:hidden pointer-coarse:hidden" />
              <CircleXIcon className="hidden size-3.5 fill-current [&_path]:stroke-background group-focus-visible:block [@media(hover:hover)]:group-hover:block pointer-coarse:block" />
            </span>
            <span data-slot="plan-label">{label}</span>
          </button>
        </TooltipTrigger>
        <TooltipContent>{closeLabel}</TooltipContent>
      </Tooltip>
    </span>
  )
}
