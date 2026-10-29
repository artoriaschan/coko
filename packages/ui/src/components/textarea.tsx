import type * as React from 'react'
import { cn } from '../lib/utils.ts'

// 多行输入：与 Input 同一几何与 token（R12、0.5px 中性线、背景、无效时状态色边框、粗指针下 16px），可纵向拉伸。
// mono 变体为等宽小字号，用于命令参数、环境变量等配置文本。
const VARIANTS = {
  default: 'text-ui-body pointer-coarse:text-ui-title',
  mono: 'font-mono text-ui-small',
} as const

function Textarea({ className, variant = 'default', ...props }: React.ComponentProps<'textarea'> & { variant?: keyof typeof VARIANTS }) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'box-border min-h-16 w-full min-w-0 resize-y rounded-md border-hairline border-input bg-background px-3 py-1.5 text-foreground transition-colors focus-ring placeholder:text-muted-foreground disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive',
        VARIANTS[variant],
        className,
      )}
      {...props}
    />
  )
}

export { Textarea }
