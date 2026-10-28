import type * as React from 'react'
import { cn } from '../lib/utils.ts'

// 由 shadcn CLI 4.21.4 的 input 改写：标准 H32/R12、0.5px 中性线；无效时 1px 状态色边框；粗指针下字号 16px。
function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'box-border h-8 w-full min-w-0 rounded-md border-hairline border-input bg-background px-3 text-ui-body text-foreground transition-colors focus-ring placeholder:text-muted-foreground disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive pointer-coarse:text-ui-title',
        className,
      )}
      {...props}
    />
  )
}

export { Input }
