import type * as React from 'react'
import { Button } from '../components/button.tsx'

/** 侧栏底部的设置入口：H46 底栏、H36 圆弧按钮，常态透明，hover 使用共享 accent。 */
export function SidebarSettings({ label, icon, onClick }: { label: string; icon: React.ReactNode; onClick: () => void }) {
  return (
    <div
      data-workbench-settings
      className="h-(--local-settings-height) shrink-0 border-t-hairline border-sidebar-border px-2 pt-1 pb-1.5 [--local-settings-height:46px]"
    >
      <Button
        variant="ghost"
        onClick={onClick}
        className="h-9 w-full justify-start gap-2 rounded-sm px-2 pe-2 text-ui-body [corner-shape:round] has-[>svg]:px-2 has-[>svg]:pe-2"
      >
        <span aria-hidden className="flex size-4 shrink-0 items-center justify-center">
          {icon}
        </span>
        <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      </Button>
    </div>
  )
}
