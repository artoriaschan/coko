import { Switch as SwitchPrimitive } from 'radix-ui'
import type * as React from 'react'
import { cn } from '../lib/utils.ts'

// 由 shadcn CLI 4.21.4 的 switch 改写：H20 全圆轨道、16px 圆形滑块（rounded-round）；未选中为 input 语义色，选中为 primary；
// 焦点环使用共享 focus-ring。
function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        'peer box-border inline-flex h-5 w-8 shrink-0 items-center rounded-round p-0.5 transition-colors focus-ring disabled:pointer-events-none disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block size-4 rounded-round bg-background transition-transform data-[state=checked]:translate-x-3 data-[state=unchecked]:translate-x-0 motion-reduce:transition-none"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
