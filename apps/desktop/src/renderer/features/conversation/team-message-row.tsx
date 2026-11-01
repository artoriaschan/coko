import { ArrowRightIcon, MessageSquareIcon } from 'lucide-react'
import { useI18n } from '../../app/i18n.tsx'
import type { TimelineItem } from './timeline.ts'

/**
 * 团队消息的紧凑行（team_message 条目）：发送方 → 接收方与 summary。送达它的 <team-message> 包装由时间线按条目位置去掉，正文只发给模型、
 * 不在这里显示。名字与 summary 是协议值与模型输出，原样显示。
 */
export function TeamMessageRow({ item }: { item: Extract<TimelineItem, { kind: 'team-message' }> }) {
  const { t } = useI18n()
  const { from, to, summary, messageId } = item.message
  return (
    <div
      data-slot="team-message"
      data-message-id={messageId}
      data-from={from}
      data-to={to}
      className="flex min-w-0 items-start gap-2 text-ui-body text-muted-foreground"
    >
      <MessageSquareIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span data-slot="team-message-route" role="group" aria-label={t('teams.message.route', { from, to })} className="flex shrink-0 items-center gap-1">
          <span data-user-content className="font-medium text-foreground">
            {from}
          </span>
          <ArrowRightIcon role="img" aria-label={t('teams.message.arrow')} className="size-3.5 shrink-0 self-center" />
          <span data-user-content className="font-medium text-foreground">
            {to}
          </span>
        </span>
        {summary !== undefined && summary !== '' && (
          <span data-slot="team-message-summary" data-user-content className="min-w-0 break-words">
            {summary}
          </span>
        )}
      </div>
    </div>
  )
}
