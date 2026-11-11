import type { TimelineRootAttributes } from './timeline-projection.ts'
import { IconChevronRight } from '@tabler/icons-react'
import type { Theme } from '../../app/appearance-store.ts'
import { useI18n } from '../../app/i18n.tsx'
import { Markdown } from './markdown.tsx'
import type { TimelineItem } from './timeline.ts'

/**
 * 压缩分隔条："已压缩上下文 · 约节省 N tokens"，可展开查看摘要。之前的消息仍在时间线中（模型上下文从这里开始为摘要）。
 */
export function CompactionDivider({
  item,
  theme,
  rootAttributes,
}: {
  item: Extract<TimelineItem, { kind: 'compaction' }>
  theme: Theme
  rootAttributes?: TimelineRootAttributes
}) {
  const { t, locale } = useI18n()
  const saved = item.saved === undefined ? undefined : new Intl.NumberFormat(locale === 'zh' ? 'zh-CN' : 'en-US').format(item.saved)
  return (
    <details
      {...rootAttributes}
      data-slot="compaction-divider"
      data-trigger={item.trigger}
      className="group/compaction min-w-0 text-ui-small text-muted-foreground"
    >
      <summary
        aria-label={t('context.compaction.showSummary')}
        className="flex cursor-pointer items-center gap-2 rounded-md select-none focus-ring [&::-webkit-details-marker]:hidden"
      >
        <span aria-hidden className="h-px flex-1 bg-border" />
        <IconChevronRight aria-hidden className="size-3.5 shrink-0 transition-transform group-open/compaction:rotate-90 motion-reduce:transition-none" />
        <span className="shrink-0">
          {t('context.compaction.divider')}
          {saved !== undefined && <span className="tabular-nums"> · {t('context.compaction.saved', { tokens: saved })}</span>}
        </span>
        <span aria-hidden className="h-px flex-1 bg-border" />
      </summary>
      <div data-slot="compaction-summary" data-user-content className="mt-2 rounded-lg border-hairline border-border px-3 py-2 text-foreground">
        <Markdown text={item.summary} streaming={false} theme={theme} />
      </div>
    </details>
  )
}
