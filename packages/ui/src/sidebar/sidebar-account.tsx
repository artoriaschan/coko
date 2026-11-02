import type * as React from 'react'
import { Button } from '../components/button.tsx'
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/tooltip.tsx'

/** 固定于侧栏底部的用户入口；标签与头像由宿主提供。 */
export function SidebarAccount({
  username,
  avatar,
  icon,
  label,
  onClick,
}: {
  username: string
  avatar: React.ReactNode
  icon: React.ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <div
      data-workbench-account
      className="h-(--local-account-height) shrink-0 border-t-hairline border-sidebar-border px-3 pt-1 pb-1.5 [--local-account-height:46px] [--local-avatar-size:22px] [--local-account-inset:9px]"
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            aria-label={label}
            onClick={onClick}
            className="h-9 w-full justify-start gap-(--local-account-inset) rounded-sm ps-(--local-account-inset) pe-3 [corner-shape:round] has-[>svg]:ps-(--local-account-inset) has-[>svg]:pe-3"
          >
            <span
              data-workbench-avatar
              className="flex size-(--local-avatar-size) shrink-0 items-center justify-center rounded-round bg-accent text-muted-foreground"
            >
              {avatar}
            </span>
            <span className="min-w-0 flex-1 truncate text-left text-ui-body">{username}</span>
            {icon}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">{label}</TooltipContent>
      </Tooltip>
    </div>
  )
}
