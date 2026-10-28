import { CircleCheckIcon, InfoIcon, Loader2Icon, OctagonXIcon, TriangleAlertIcon } from 'lucide-react'
import * as React from 'react'
import { Toaster as Sonner, type ToasterProps } from 'sonner'

// 当前挂载的 Toast 宿主节点（sonner 的 aria-live section）。模态对话框据此把它登记为焦点范围的分支，
// 使 Toast 的动作在对话框打开时仍可用键盘到达（见 dialog.tsx）。
let host: HTMLElement | null = null
const hostListeners = new Set<() => void>()
const setHost = (node: HTMLElement | null) => {
  host = node
  for (const listener of hostListeners) listener()
}
/** 稳定的回调 ref：卸载时只清除自己登记的节点。 */
const publishHost = (node: HTMLElement | null) => {
  if (!node) return
  setHost(node)
  return () => {
    if (host === node) setHost(null)
  }
}
const subscribeHost = (listener: () => void) => {
  hostListeners.add(listener)
  return () => void hostListeners.delete(listener)
}

/** 当前 Toast 宿主节点；没有挂载 Toaster 时为 null。 */
export function useToasterHost(): HTMLElement | null {
  return React.useSyncExternalStore(
    subscribeHost,
    () => host,
    () => null,
  )
}

// 由 shadcn CLI 4.21.4 生成后改写：主题由应用层传入（不依赖 next-themes）；顶部居中；
// 抬升表面用 shadow-prominent、无中性边框，R16；颜色取 toast 语义 token。
/** containerAriaLabel 为必填：共享组件不内置兜底文案。 */
function Toaster({ theme, position = 'top-center', containerAriaLabel, ...props }: ToasterProps & { containerAriaLabel: string }) {
  return (
    <Sonner
      theme={theme}
      position={position}
      containerAriaLabel={containerAriaLabel}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      toastOptions={{
        classNames: {
          toast: 'border-0! shadow-prominent! text-ui-body!',
        },
      }}
      style={
        {
          '--normal-bg': 'var(--toast)',
          '--normal-text': 'var(--toast-foreground)',
          '--normal-border': 'transparent',
          '--border-radius': 'var(--radius-lg)',
          // 模态对话框打开时 Radix 让 body 不接收指针事件；Toast（如"重试"）需要在对话框之上仍可点击。
          pointerEvents: 'auto',
        } as React.CSSProperties
      }
      {...props}
      ref={publishHost}
    />
  )
}

export { Toaster, type ToasterProps }
