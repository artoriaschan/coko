import { Button, Tooltip, TooltipContent, TooltipTrigger } from '@coko/ui'
import type * as React from 'react'

/** 仅图标按钮：可访问名称与 Tooltip 使用同一条已本地化文案。 */
export function IconButton({ label, children, ...props }: { label: string } & Omit<React.ComponentProps<typeof Button>, 'aria-label'>) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="toolbar" size="icon" aria-label={label} {...props}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  )
}
