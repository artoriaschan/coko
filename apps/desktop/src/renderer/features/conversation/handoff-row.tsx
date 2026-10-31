import { Button } from '@coko/ui'
import { ArrowRightLeftIcon, TriangleAlertIcon } from 'lucide-react'
import * as React from 'react'
import { useOptionalChatStoreApi } from '../../app/chat.tsx'
import { useI18n } from '../../app/i18n.tsx'
import { handoffFailure } from '../../stores/handoff-store.ts'
import { HANDOFF_ERRORS } from './handoff-dialog.tsx'
import type { TimelineItem } from './timeline.ts'

/**
 * 时间线的交接行：源会话的 handoff（"已交接到 <标题>"，可打开目标会话）与目标会话首条的 handoff_origin（"交接自 <标题>"，可跳回源会话）。
 * 标题取会话列表；不在列表中（已删除或尚未读取）时显示"未命名"。失败的 handoff（摘要之后目标没能创建）没有目标，显示失败与原因。
 */
export function HandoffRow({ item }: { item: Extract<TimelineItem, { kind: 'handoff' }> }) {
  const { handoff } = item
  const failure = handoff.kind === 'source' ? handoffFailure(handoff.payload) : undefined
  return failure ? <FailedHandoffRow code={failure.error.code} /> : <LinkedHandoffRow item={item} />
}

function FailedHandoffRow({ code }: { code: string }) {
  const { t } = useI18n()
  const reason = HANDOFF_ERRORS[code]
  return (
    <div data-slot="handoff-row" data-handoff="failed" data-code={code} className="flex min-w-0 items-start gap-2 text-ui-body text-muted-foreground">
      <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
      <p className="min-w-0 flex-1">
        {t('handoff.failed')}
        {reason && <span className="block text-ui-small">{t(reason)}</span>}
      </p>
    </div>
  )
}

function LinkedHandoffRow({ item }: { item: Extract<TimelineItem, { kind: 'handoff' }> }) {
  const { t } = useI18n()
  const chat = useOptionalChatStoreApi()
  const { handoff } = item
  const otherId = handoff.kind === 'source' ? handoff.payload.targetSessionId : handoff.payload.sessionId
  const title = React.useSyncExternalStore(chat?.subscribe ?? (() => () => {}), () => chat?.getState().sessions.find((s) => s.id === otherId)?.title)
  const name = title?.trim() || t('sidebar.untitled')
  const text =
    handoff.kind === 'source'
      ? t('handoff.row.source', { title: name }) + (handoff.payload.target === 'worktree' ? t('handoff.row.inWorktree') : '')
      : t('handoff.row.origin', { title: name })
  const action = handoff.kind === 'source' ? t('handoff.row.open') : t('handoff.row.back')
  return (
    <div
      data-slot="handoff-row"
      data-handoff={handoff.kind}
      data-session-id={otherId}
      className="flex min-w-0 items-center gap-2 text-ui-body text-muted-foreground"
    >
      <ArrowRightLeftIcon aria-hidden className="size-4 shrink-0" />
      <p data-user-content className="min-w-0 flex-1 truncate" title={text}>
        {text}
      </p>
      {chat && (
        <Button
          size="sm"
          variant="ghost"
          data-action={handoff.kind === 'source' ? 'open-handoff-target' : 'open-handoff-source'}
          onClick={() => chat.getState().openSession(otherId)}
        >
          {action}
        </Button>
      )}
    </div>
  )
}
