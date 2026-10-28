import { CircleCheckIcon, InfoIcon, Loader2Icon, OctagonXIcon, TriangleAlertIcon } from 'lucide-react'
import type * as React from 'react'
import { Toaster as Sonner, type ToasterProps } from 'sonner'

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
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster, type ToasterProps }
