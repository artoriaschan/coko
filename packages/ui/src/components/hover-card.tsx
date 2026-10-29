import { HoverCard as HoverCardPrimitive } from 'radix-ui'
import type * as React from 'react'
import { cn } from '../lib/utils.ts'
import { menuSurface } from './dropdown-menu.tsx'

// 由 shadcn CLI 4.21.4 的 hover-card 改写：菜单材质（--menu-fill 与 ::before 模糊层、shadow-panel、无中性边框）、R16、
// 内边距 12px、text-ui-body；portal 脱离输入区的 overflow；窗口边缘按 collisionPadding 平移与翻转。
function HoverCard({ openDelay = 300, closeDelay = 150, ...props }: React.ComponentProps<typeof HoverCardPrimitive.Root>) {
  return <HoverCardPrimitive.Root data-slot="hover-card" openDelay={openDelay} closeDelay={closeDelay} {...props} />
}

function HoverCardTrigger({ ...props }: React.ComponentProps<typeof HoverCardPrimitive.Trigger>) {
  return <HoverCardPrimitive.Trigger data-slot="hover-card-trigger" {...props} />
}

function HoverCardContent({
  className,
  align = 'center',
  sideOffset = 6,
  collisionPadding = 8,
  ...props
}: React.ComponentProps<typeof HoverCardPrimitive.Content>) {
  return (
    <HoverCardPrimitive.Portal>
      <HoverCardPrimitive.Content
        data-slot="hover-card-content"
        align={align}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={cn(
          menuSurface,
          'w-72 max-w-(--radix-hover-card-content-available-width) origin-(--radix-hover-card-content-transform-origin) p-3 text-ui-body outline-hidden',
          'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 motion-reduce:animate-none',
          className,
        )}
        {...props}
      />
    </HoverCardPrimitive.Portal>
  )
}

export { HoverCard, HoverCardContent, HoverCardTrigger }
