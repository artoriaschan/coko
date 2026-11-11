import { HoverCard, HoverCardContent, HoverCardTrigger } from '@coko/ui'
import { IconClock } from '@tabler/icons-react'
import { useChat } from '../../../app/chat.tsx'
import { useI18n } from '../../../app/i18n.tsx'
import type { DockCardProps } from './dock-slots.ts'

const NONE: readonly string[] = []

/**
 * dock 的队列卡：本窗口在 Run 中发出、尚未送达的追加指令（chat-store 的 steering），每条单行截断，HoverCard 看全文。送达后由 user 条目
 * 替代并从这里消失；Run 结束时未送达的退回输入区（chat-store 的现有行为）。不能撤回。没有时不显示。
 */
export function QueueCard({ sessionId }: DockCardProps) {
  const { t } = useI18n()
  const steering = useChat((state) => state.conversations[sessionId]?.steering ?? NONE)
  if (steering.length === 0) return null
  return (
    <section data-slot="queue-card" aria-label={t('todo.queue.hint')} className="rounded-panel bg-background px-3 py-2 text-ui-body shadow-panel">
      <div className="flex min-w-0 items-center gap-2">
        <IconClock aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <span className="shrink-0 font-medium">{t('todo.queue.title', { count: steering.length })}</span>
        <span className="min-w-0 flex-1 truncate text-ui-small text-muted-foreground">{t('todo.queue.hint')}</span>
      </div>
      <ul className="mt-1 flex flex-col">
        {steering.map((text, i) => (
          <li key={`${i}:${text}`} data-queued className="min-w-0">
            <HoverCard>
              <HoverCardTrigger asChild>
                <button type="button" data-user-content className="block w-full truncate rounded-sm ps-6 text-start text-muted-foreground focus-ring">
                  {text}
                </button>
              </HoverCardTrigger>
              <HoverCardContent align="start" className="w-96 break-words whitespace-pre-wrap" data-user-content>
                {text}
              </HoverCardContent>
            </HoverCard>
          </li>
        ))}
      </ul>
    </section>
  )
}
