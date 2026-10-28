import { Button } from '@coko/ui'
import { LoaderCircleIcon, RotateCcwIcon } from 'lucide-react'
import type { Theme } from '../../app/appearance-store.ts'
import { useI18n } from '../../app/i18n.tsx'
import { Markdown } from './markdown.tsx'
import type { TimelineItem } from './timeline.ts'
import { ToolCardView } from './tool-cards.tsx'

export interface TimelineViewProps {
  items: TimelineItem[]
  theme: Theme
  onRetry: (text: string) => void
}

/** 消息流：用户气泡、流式 Markdown、思考过程、工具卡与 Run 结束状态。key 为条目身份，流式更新不重挂载。 */
export function TimelineView({ items, theme, onRetry }: TimelineViewProps) {
  const { t } = useI18n()
  return (
    <>
      {items.map((item) => {
        switch (item.kind) {
          case 'user':
            return (
              <article key={item.key} aria-label={t('conversation.you')} className="ms-auto w-fit max-w-[85%]">
                <p data-user-content className="rounded-xl bg-bubble px-4 py-2.5 text-ui-body-lg break-words whitespace-pre-wrap">
                  {item.text}
                </p>
              </article>
            )
          case 'text':
            return (
              <article
                key={item.key}
                aria-label={t('conversation.assistant')}
                data-user-content
                data-streaming={item.streaming || undefined}
                className="min-w-0"
              >
                <Markdown text={item.text} streaming={item.streaming} theme={theme} />
              </article>
            )
          case 'thinking':
            return (
              <details key={item.key} className="min-w-0 text-ui-body text-muted-foreground">
                <summary className="cursor-pointer select-none">{t('conversation.thinking')}</summary>
                <p data-user-content className="mt-1 border-l-hairline border-border ps-3 break-words whitespace-pre-wrap">
                  {item.text}
                </p>
              </details>
            )
          case 'tool':
            return <ToolCardView key={item.key} item={item} />
          case 'generating':
            return (
              <p key={item.key} aria-live="polite" data-generating className="flex items-center gap-2 text-ui-body text-muted-foreground">
                <LoaderCircleIcon aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
                {item.retry ? t('conversation.retrying', { attempt: item.retry.attempt, max: item.retry.maxRetries }) : t('conversation.generating')}
              </p>
            )
          case 'stopped':
            return (
              <p key={item.key} data-run-status="aborted" className="text-ui-body text-muted-foreground">
                {t('conversation.stopped')}
              </p>
            )
          case 'error':
            return (
              <div
                key={item.key}
                role="alert"
                data-run-status="error"
                className="flex flex-col gap-2 rounded-lg border border-destructive px-3 py-2 text-ui-body"
              >
                <p className="font-medium text-destructive">{t('conversation.runError')}</p>
                {item.message !== '' && (
                  <p data-user-content className="break-words whitespace-pre-wrap text-muted-foreground select-text">
                    {item.message}
                  </p>
                )}
                {item.retryText !== null && (
                  <Button variant="outline" size="sm" className="self-start" onClick={() => onRetry(item.retryText!)}>
                    <RotateCcwIcon />
                    {t('conversation.retry')}
                  </Button>
                )}
              </div>
            )
        }
      })}
    </>
  )
}
