import type { TimelineRootAttributes } from './timeline-projection.ts'
import { ArrowRightIcon, MessageSquareIcon } from 'lucide-react'
import { useI18n } from '../../app/i18n.tsx'
import { CollaborationRow } from './collaboration-row.tsx'
import type { TimelineItem } from './timeline.ts'

/**
 * 团队消息的紧凑行（team_message 条目）：发送方 → 接收方与 summary。送达它的 <team-message> 包装由时间线按条目位置去掉，正文由宿主包装提取并可手动展开查看。名字与 summary 是协议值与模型输出，原样显示。
 */
export function TeamMessageRow({ item, rootAttributes }: { item: Extract<TimelineItem, { kind: 'team-message' }>; rootAttributes?: TimelineRootAttributes }) {
  const { t } = useI18n()
  const { from, to, summary, messageId } = item.message
  return (
    <CollaborationRow
      {...rootAttributes}
      data-slot="team-message"
      data-message-id={messageId}
      data-from={from}
      data-to={to}
      triggerLabel={t('teams.message.route', { from, to })}
      icon={<MessageSquareIcon aria-hidden />}
      label={
        <>
          <span data-slot="team-message-route" aria-label={t('teams.message.route', { from, to })} className="inline-flex items-center gap-1">
            <span data-user-content>{from}</span>
            <ArrowRightIcon aria-hidden className="size-3.5" />
            <span data-user-content>{to}</span>
          </span>
          {summary !== undefined && summary !== '' && (
            <>
              <span aria-hidden> · </span>
              <span data-slot="team-message-summary" data-user-content>
                {summary}
              </span>
            </>
          )}
        </>
      }
    >
      {item.body !== undefined && (
        <p data-user-content data-slot="team-message-body">
          {item.body}
        </p>
      )}
      <p className="conversation-collaboration-source" data-user-content>
        {messageId}
      </p>
    </CollaborationRow>
  )
}
