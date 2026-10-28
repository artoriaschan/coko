import { cva, type VariantProps } from 'class-variance-authority'
import { Slot } from 'radix-ui'
import type * as React from 'react'
import { cn } from '../lib/utils.ts'

// 由 shadcn CLI 4.21.4 生成后按设计系统改写：sm 为 H28/R8，default 为 H36/R12；各变体尺寸与圆角一致；
// 焦点环使用主题的共享 focus-ring 工具类（ring token、:focus-visible）；去掉 dark: 分支与默认色板。
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 font-medium whitespace-nowrap transition-colors focus-ring disabled:pointer-events-none disabled:opacity-50 aria-invalid:text-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary-hover',
        destructive: 'bg-destructive text-destructive-foreground hover:opacity-90',
        outline: 'border-hairline border-input bg-background hover:bg-accent hover:text-accent-foreground',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-accent-active',
        ghost: 'hover:bg-accent hover:text-accent-foreground active:bg-accent-active',
        toolbar: 'text-muted-foreground hover:bg-accent hover:text-foreground active:bg-accent-active aria-pressed:bg-accent aria-pressed:text-foreground',
        link: 'text-link underline-offset-3 hover:underline hover:decoration-dotted focus-visible:underline focus-visible:decoration-dotted',
      },
      size: {
        default: 'h-9 rounded-md px-4 text-ui-body has-[>svg]:px-3',
        sm: 'h-7 gap-1.5 rounded-sm px-2.5 text-ui-body has-[>svg]:px-2',
        lg: 'h-10 rounded-md px-6 text-ui-body-lg has-[>svg]:px-4',
        icon: 'size-9 rounded-md',
        'icon-sm': 'size-7 rounded-sm',
        'icon-xs': "size-5 rounded-xs [&_svg:not([class*='size-'])]:size-3",
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

function Button({
  className,
  variant = 'default',
  size = 'default',
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : 'button'

  return <Comp data-slot="button" data-variant={variant} data-size={size} className={cn(buttonVariants({ variant, size, className }))} {...props} />
}

export { Button, buttonVariants }
