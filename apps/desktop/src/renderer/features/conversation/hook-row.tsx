import type { TimelineRootAttributes } from './timeline-projection.ts'
import { WebhookIcon } from 'lucide-react'
import { useI18n } from '../../app/i18n.tsx'
import type { TimelineItem } from './timeline.ts'

/** 结论为阻断、停止或失败的 hook_run 用警示色（与工具卡的拒绝标注一致）；要求继续、追加上下文与放行为常规色。 */
const DESTRUCTIVE = new Set(['blocked', 'denied', 'stopped', 'timeout', 'error', 'invalid-output'])

/**
 * 时间线的 Hook 行（hook_run 条目）：紧凑行。事件名、结论、来源与（已脱敏的）命令；有 message 时另起一行显示（换行，不截断）。
 * 命令单行截断，完整内容在 title 中。
 */
export function HookRow({ item, rootAttributes }: { item: Extract<TimelineItem, { kind: 'hook' }>; rootAttributes?: TimelineRootAttributes }) {
  const { t } = useI18n()
  const { hook } = item
  const destructive = DESTRUCTIVE.has(hook.outcome)
  return (
    <div
      {...rootAttributes}
      data-slot="hook-row"
      data-event={hook.event}
      data-outcome={hook.outcome}
      data-source={hook.source}
      className="flex min-w-0 items-start gap-1.5 conversation-business-row text-muted-foreground"
    >
      <WebhookIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="shrink-0 font-mono text-ui-small">{hook.event}</span>
          <span data-slot="hook-outcome" className={destructive ? 'shrink-0 text-destructive' : 'shrink-0 text-foreground'}>
            {t(`hooks.outcome.${hook.outcome}`)}
          </span>
          <span className="shrink-0 text-ui-small">
            {[t(`hooks.source.${hook.source}`), hook.exitCode === undefined ? undefined : t('hooks.exitCode', { code: hook.exitCode })]
              .filter(Boolean)
              .join(' · ')}
          </span>
          <code data-slot="hook-command" data-user-content title={hook.command} className="min-w-0 flex-1 truncate font-mono text-ui-small">
            {hook.command}
          </code>
        </p>
        {hook.message !== undefined && (
          <p data-slot="hook-message" data-user-content className="min-w-0 [overflow-wrap:anywhere] whitespace-pre-wrap">
            {hook.message}
          </p>
        )}
      </div>
    </div>
  )
}
