import * as React from 'react'
import { Button, Tooltip, TooltipContent, TooltipTrigger, toast } from '@coko/ui'
import { IconCheck } from '@tabler/icons-react'
import { useI18n } from '../../app/i18n.tsx'

/** 消息动作按钮：仅图标，Tooltip 与可访问名称同一文案。 */
export function MessageAction({
  label,
  action,
  disabled,
  onClick,
  children,
}: {
  label: string
  action: string
  disabled: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="toolbar"
          size="icon-sm"
          aria-label={label}
          data-action={action}
          disabled={disabled}
          onClick={onClick}
          className="size-[22px] rounded-sm p-0 [&_svg]:stroke-[1]"
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

export function CopyMessage({ text }: { text: string }) {
  const { t } = useI18n()
  const [copied, setCopied] = React.useState(false)
  React.useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timer)
  }, [copied])
  return (
    <MessageAction
      label={t(copied ? 'conversation.messageCopied' : 'conversation.copyMessage')}
      action="copy-message"
      disabled={false}
      onClick={() => {
        setCopied(false)
        void (async () => {
          try {
            await navigator.clipboard.writeText(text)
            setCopied(true)
          } catch {
            toast.error(t('conversation.copyMessageFailed'))
          }
        })()
      }}
    >
      {copied ? (
        <IconCheck aria-hidden />
      ) : (
        <svg aria-hidden viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1">
          <rect x="1.52075" y="4.07373" width="10.3932" height="10.3932" rx="2" />
          <path
            stroke="none"
            fill="currentColor"
            d="M11.9792 1.53296C13.36 1.53296 14.4792 2.65225 14.4792 4.03296V9.42847C14.4792 10.3756 13.9521 11.1987 13.1755 11.6228V10.3298C13.3652 10.0787 13.4792 9.7674 13.4792 9.42847V4.03296C13.4792 3.20453 12.8077 2.53296 11.9792 2.53296H6.58374C6.27966 2.53301 5.99684 2.6235 5.7605 2.77905H4.42358C4.85652 2.03463 5.66056 1.53304 6.58374 1.53296H11.9792Z"
          />
        </svg>
      )}
    </MessageAction>
  )
}
