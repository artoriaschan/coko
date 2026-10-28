import { CheckIcon } from 'lucide-react'
import { Checkbox as CheckboxPrimitive } from 'radix-ui'
import type * as React from 'react'
import { cn } from '../lib/utils.ts'

// 由 shadcn CLI 4.21.4 的 checkbox 改写：细小元素 R4、0.5px 中性线；选中时使用 primary 语义色。
function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        'peer box-border inline-flex size-4 shrink-0 items-center justify-center rounded-xs border-hairline border-input bg-background focus-ring disabled:pointer-events-none disabled:opacity-50 data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator data-slot="checkbox-indicator" className="flex items-center justify-center">
        <CheckIcon className="size-3.5" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
