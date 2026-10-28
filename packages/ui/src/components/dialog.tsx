import { XIcon } from 'lucide-react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { FocusScope } from 'radix-ui/internal'
import * as React from 'react'
import { cn } from '../lib/utils.ts'
import { useToasterHost } from './sonner.tsx'

// 由 shadcn CLI 4.21.4 的 dialog 改写：遮罩 bg-overlay（不模糊父页面）；对话框为主容器面 R28、shadow-prominent、无中性边框；
// 关闭按钮的可访问名称由调用方传入（共享组件不内置文案）；点击 Toast 不关闭对话框；对话框打开时 Toast 的动作可用 Tab 到达。
function Dialog({ ...props }: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({ ...props }: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogClose({ ...props }: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

/** Toast 宿主比对话框活得更久：点击 Toast 不算对话框外的交互，不关闭对话框。 */
const isInToast = (event: Event) => event.target instanceof Element && event.target.closest('[data-sonner-toaster]') !== null

const TABBABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]'

/** 按 DOM 顺序的可 Tab 元素（可见、未禁用、tabIndex 非负）。 */
const tabbables = (root: Element): HTMLElement[] =>
  [...root.querySelectorAll<HTMLElement>(TABBABLE)].filter((el) => el.tabIndex >= 0 && el.getClientRects().length > 0)

/**
 * 模态对话框与 Toast：Toast 宿主不在对话框的 DOM 与 React 子树中，Radix 的焦点约束会把进入 Toast 的焦点拉回。
 * 这里把宿主登记为对话框焦点范围的分支（不再拉回），并在两者的边界上衔接 Tab 顺序：
 * 对话框最后一个元素 → Toast → 对话框第一个元素，Shift+Tab 反向。没有 Toast 时保持对话框内循环。
 */
function ToastFocusBridge() {
  const host = useToasterHost()
  const [marker, setMarker] = React.useState<HTMLSpanElement | null>(null)
  FocusScope.useFocusScopeBranch(host)

  React.useEffect(() => {
    const content = marker?.closest<HTMLElement>('[data-slot="dialog-content"]')
    if (!host || !content) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey || event.defaultPrevented) return
      const toasts = tabbables(host)
      if (toasts.length === 0) return
      const inner = tabbables(content)
      const active = document.activeElement
      const forward = !event.shiftKey
      let next: HTMLElement | undefined
      if (active !== null && host.contains(active)) {
        if (active === (forward ? toasts.at(-1) : toasts[0])) next = (forward ? inner[0] : inner.at(-1)) ?? content
      } else if (active !== null && content.contains(active)) {
        if (inner.length === 0 || active === (forward ? inner.at(-1) : inner[0])) next = forward ? toasts[0] : toasts.at(-1)
      } else {
        // Toast 被移除后焦点可能落到 body：回到对话框。
        next = (forward ? inner[0] : inner.at(-1)) ?? content
      }
      if (next) {
        event.preventDefault()
        next.focus()
      }
    }
    // 捕获阶段：先于 Radix FocusScope 的循环处理。
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [host, marker])

  return <span ref={setMarker} hidden />
}

function DialogContent({
  className,
  children,
  closeLabel,
  onInteractOutside,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  /** 右上角关闭按钮的可访问名称；省略时不渲染关闭按钮。 */
  closeLabel?: string
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        data-slot="dialog-overlay"
        className="fixed inset-0 z-50 bg-overlay data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0"
      />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          'fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100vh-32px)] w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-panel border-0 bg-background text-foreground shadow-prominent outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
          className,
        )}
        onInteractOutside={(event) => {
          if (isInToast(event)) event.preventDefault()
          onInteractOutside?.(event)
        }}
        {...props}
      >
        <ToastFocusBridge />
        {children}
        {closeLabel !== undefined && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            aria-label={closeLabel}
            className="absolute top-3 right-3 inline-flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors focus-ring hover:bg-accent hover:text-foreground [&_svg]:size-4"
          >
            <XIcon />
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title data-slot="dialog-title" className={cn('text-ui-title font-medium', className)} {...props} />
}

function DialogDescription({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description data-slot="dialog-description" className={cn('text-ui-body text-muted-foreground', className)} {...props} />
}

export { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger }
