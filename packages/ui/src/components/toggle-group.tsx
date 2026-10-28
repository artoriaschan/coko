import { ToggleGroup as ToggleGroupPrimitive } from 'radix-ui'
import type * as React from 'react'
import { cn } from '../lib/utils.ts'

// 分段控件：外框 R12、内边距 4px，项与指示器 R8（设计系统规格的嵌套表）。选中项用背景与 elevation 区分。
function ToggleGroup({ className, ...props }: React.ComponentProps<typeof ToggleGroupPrimitive.Root>) {
  return (
    <ToggleGroupPrimitive.Root data-slot="toggle-group" className={cn('inline-flex w-fit items-center gap-1 rounded-md bg-muted p-1', className)} {...props} />
  )
}

function ToggleGroupItem({ className, ...props }: React.ComponentProps<typeof ToggleGroupPrimitive.Item>) {
  return (
    <ToggleGroupPrimitive.Item
      data-slot="toggle-group-item"
      className={cn(
        'inline-flex h-7 min-w-0 items-center justify-center gap-1.5 rounded-sm px-3 text-ui-body text-muted-foreground transition-colors focus-ring hover:text-foreground disabled:pointer-events-none disabled:opacity-50 data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-panel [&_svg]:size-4 [&_svg]:shrink-0',
        className,
      )}
      {...props}
    />
  )
}

export { ToggleGroup, ToggleGroupItem }
