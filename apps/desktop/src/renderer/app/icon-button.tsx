import { Button, Tooltip, TooltipContent, TooltipTrigger } from '@coko/ui'
import type * as React from 'react'

/** 仅图标按钮：Tooltip 缺省沿用可访问名称，也可传入单独的已本地化文案。 */
export function IconButton({
  label,
  tooltip = label,
  children,
  ...props
}: { label: string; tooltip?: string } & Omit<React.ComponentProps<typeof Button>, 'aria-label'>) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="toolbar" size="icon" aria-label={label} {...props}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right">{tooltip}</TooltipContent>
    </Tooltip>
  )
}
