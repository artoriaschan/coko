import type * as React from 'react'
import { cn } from '../lib/utils.ts'

/** 分类下的列表项：H32/R8 圆弧，嵌套只缩进内容，整行仍可命中。 */
export function SidebarListRow({ className, ...props }: React.ComponentProps<'button'>) {
  return (
    <button
      className={cn(
        'sidebar-list-row flex h-8 w-full min-w-0 items-center gap-2 rounded-sm px-2 text-left text-ui-body focus-ring hover:bg-accent aria-[current=page]:bg-accent [corner-shape:round]',
        className,
      )}
      {...props}
    />
  )
}
