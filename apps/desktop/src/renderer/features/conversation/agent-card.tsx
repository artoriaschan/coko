import type { AgentStatus } from '@coko/protocol'
import { cn, ToolCard, type ToolCardStatus } from '@coko/ui'
import { IconRobot, IconGitBranch, IconLayoutSidebarRightExpand } from '@tabler/icons-react'
import * as React from 'react'
import { useI18n } from '../../app/i18n.tsx'
import { agentRecords, agentUsageText, useAgents, useAgentStatus, useAgentsStoreApi, useSessionAgents } from './agents-button.tsx'
import { OriginalIO, OriginalToolIO, ToolInspect } from './original-tool-io.tsx'
import { useTimelineSession } from './timeline-session.tsx'
import { ToolStateMeta, ToolStateDetail } from './tool-states.tsx'
import { ToolImages } from './tool-image-details.tsx'
import { useProcessDisclosure } from './process-disclosure.tsx'
import type { TimelineItem } from './timeline.ts'

type ToolItem = Extract<TimelineItem, { kind: 'tool' }>

const str = (value: unknown) => (typeof value === 'string' ? value : undefined)

const CARD_STATUS: Record<AgentStatus, ToolCardStatus> = {
  running: 'running',
  completed: 'done',
  failed: 'error',
  cancelled: 'pending',
  'max-turns': 'error',
  interrupted: 'pending',
  dismissed: 'pending',
}

/** <agent-result …>文本</agent-result> 中的文本；不是这个形状时为原文。 */
function resultBody(text: string): string {
  const match = /^<agent-result\b[^>]*>([\s\S]*?)<\/agent-result>\s*([\s\S]*)$/.exec(text)
  if (!match) return text
  return [match[1]!.trim(), match[2]!.trim()].filter(Boolean).join('\n\n')
}

/**
 * agent 工具卡（docs/subsystems/subagents.md#界面）：子代理类型、描述、状态、一行进度（agent_update 的最近一次工具调用）、结束后的用量、
 * 后台 chip 与保留的 worktree；明细为结果文本与"在右栏查看"。状态与用量只来自宿主的 agent_start / agent_end 与 agent_update，
 * 不读结果文本中的标签。
 */
export function AgentCard({
  item,
  onInspect,
  rootAttributes,
}: {
  item: ToolItem
  onInspect?: () => void
  rootAttributes?: React.ComponentProps<typeof ToolCard>['rootAttributes']
}) {
  const [expanded, onExpandedChange] = useProcessDisclosure()
  const { t, locale } = useI18n()
  const agents = useAgentsStoreApi()
  const { sessionId, entries } = useTimelineSession()
  useSessionAgents(sessionId)
  const record = React.useMemo(
    () => agentRecords(entries).find((r) => r.start.toolCallId === item.call.id && (item.origin?.runId === undefined || r.runId === item.origin.runId)),
    [entries, item.call.id, item.origin?.runId],
  )
  const status = useAgentStatus(record, sessionId)
  const activity = useAgents((s) => (record ? s.activity[record.start.agentId] : undefined))
  const args = (item.call.arguments && typeof item.call.arguments === 'object' ? item.call.arguments : {}) as Record<string, unknown>
  const type = record?.start.agentType ?? str(args.subagent_type) ?? 'general'
  const description = record?.start.description ?? str(args.description) ?? ''
  const background = record?.start.background ?? args.run_in_background === true
  // 派发之前（审批中、尚未开始）或派发失败（没有子 Session）：沿用工具调用本身的状态。
  const cardStatus: ToolCardStatus = status ? CARD_STATUS[status] : item.status
  const statusLabel = status ? t(`agents.status.${status}`) : t(`tool.${item.status}`)
  const failedToStart = !record && item.result?.isError === true
  const running = status === 'running'
  const progress =
    running && activity
      ? activity.summary === ''
        ? activity.toolName
        : t('agents.card.activity', { tool: activity.toolName, summary: activity.summary })
      : running
        ? background && item.result
          ? t('agents.card.backgroundStarted')
          : t('agents.card.starting')
        : undefined
  const usage = record?.end ? agentUsageText(t, locale, record.end.usage) : undefined
  const result = item.result && !background ? resultBody(item.result.text) : failedToStart ? (item.result?.text ?? '') : undefined
  return (
    <ToolCard
      rootAttributes={rootAttributes}
      variant="row"
      data-tool="agent"
      icon={<IconRobot aria-hidden />}
      title={t('agents.card.title', { type })}
      summary={description}
      status={cardStatus}
      statusLabel={statusLabel}
      meta={
        <>
          {background && (
            <span data-slot="agent-background" className="shrink-0 rounded-xs border-hairline border-border px-1.5 text-ui-caption text-muted-foreground">
              {t('agents.card.background')}
            </span>
          )}
          <ToolStateMeta item={item} />
        </>
      }
      expanded={expanded}
      onExpandedChange={onExpandedChange}
    >
      <div data-slot="agent-card" data-agent-id={record?.start.agentId} data-agent-status={status} className="flex flex-col">
        <ToolStateDetail item={item} />
        <div className="structured-detail">
          {(progress !== undefined || usage !== undefined) && (
            <div className="flex min-w-0 items-center gap-2 px-3 py-2 text-ui-small text-muted-foreground">
              {progress !== undefined && (
                <span
                  data-slot="agent-progress"
                  {...(running && activity ? { 'data-user-content': '' } : {})}
                  className={cn('min-w-0 flex-1 truncate', running && activity && 'font-mono')}
                  title={progress}
                  aria-live="polite"
                >
                  {progress}
                </span>
              )}
              {usage !== undefined && (
                <span data-slot="agent-usage" className="min-w-0 flex-1 break-words tabular-nums" title={usage}>
                  {usage}
                </span>
              )}
            </div>
          )}
          {record?.end?.worktree?.kept && (
            <p data-slot="agent-worktree" className="flex min-w-0 items-center gap-1.5 px-3 pb-2 text-ui-small text-muted-foreground">
              <IconGitBranch aria-hidden className="size-3.5 shrink-0" />
              <span data-user-content className="min-w-0 break-all font-mono" title={record.end.worktree.path}>
                {t('agents.card.worktreeKept', { branch: record.end.worktree.branch })}
              </span>
            </p>
          )}
          {result !== undefined && result !== '' && (
            <div className="border-t-hairline border-border">
              <p className="px-3 pt-2 text-ui-small text-muted-foreground">{t('agents.card.result')}</p>
              <p data-slot="agent-result" data-user-content className="max-h-60 overflow-y-auto px-3 py-2 text-ui-body break-words whitespace-pre-wrap">
                {result}
              </p>
            </div>
          )}
          {record && sessionId !== null && (
            <div className="flex justify-end border-t-hairline border-border px-2 py-1">
              <button
                type="button"
                data-action="open-agent"
                aria-label={t('agents.card.openLabel', { description })}
                className="flex h-7 items-center gap-1.5 rounded-sm px-2 text-ui-small text-muted-foreground focus-ring [@media(hover:hover)]:hover:bg-accent [@media(hover:hover)]:hover:text-foreground"
                onClick={() => agents.getState().open(sessionId, record.start.agentId)}
              >
                <IconLayoutSidebarRightExpand aria-hidden className="size-3.5" />
                {t('agents.card.open')}
              </button>
            </div>
          )}
        </div>
        <OriginalIO>
          <OriginalToolIO item={item} />
        </OriginalIO>
        <ToolImages item={item} />
        <ToolInspect onInspect={onInspect} />
      </div>
    </ToolCard>
  )
}
