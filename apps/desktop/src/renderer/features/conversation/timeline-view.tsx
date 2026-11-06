import { TimelineRevealContext, useMainTimelineReveal } from './timeline-reveal.tsx'
import { publishTimelineProjection, releaseTimelineProjection } from './timeline-projection.ts'
import { copiedReplyFooters } from './fork-history.ts'
import type { SessionEntry } from '@coko/protocol'
import * as React from 'react'
import { Button } from '@coko/ui'
import { ChevronRightIcon, GitBranchIcon, FileIcon, FolderIcon, LoaderCircleIcon, RotateCcwIcon, SquareSlashIcon, Undo2Icon } from 'lucide-react'
import type { Theme } from '../../app/appearance-store.ts'
import { useI18n } from '../../app/i18n.tsx'
import { CompactionDivider } from './compaction-divider.tsx'
import './business-timeline.css'
import { GoalRow } from './goal-row.tsx'
import { JobRow } from './job-row.tsx'
import { AgentNotificationRow } from './agent-notification-row.tsx'
import { HandoffRow } from './handoff-row.tsx'
import { HookRow } from './hook-row.tsx'
import { ScheduleFireRow } from './schedule-fire-row.tsx'
import { TeamMessageRow } from './team-message-row.tsx'
import { TeamTaskRow } from './team-task-row.tsx'
import { Markdown } from './markdown.tsx'
import { MessageTime } from './message-time.tsx'
import { CopyMessage, MessageAction } from './message-actions.tsx'
import { AssistantFooter, completedReplyFooters, endedRunFooter, withoutPricing } from './assistant-footer.tsx'
import { ReasoningRow } from './reasoning-row.tsx'
import { sumUsageByRun } from './session-cost.tsx'
import { useMessageIdentities } from './message-identities.ts'
import { PlanCard, planCardSuppressed } from './plan-card.tsx'
import type { TimelineItem } from './timeline.ts'
import { ProcessTimeline } from './process-timeline.tsx'
import type { DisplayRun } from './process-groups.ts'
import { TimelineSessionContext } from './timeline-session.tsx'
import { ToolCardView } from './tool-cards.tsx'

export interface TimelineViewProps {
  /** Only ConversationPane opts in; child/rewound timelines never publish. */
  publishMainProjection?: boolean
  historical?: boolean
  readOnly?: boolean
  onOpenPlan?: () => void
  sessionId?: string
  /** Actual caller-owned entries; never inferred from the active parent Session. */
  entries?: readonly SessionEntry[]
  runs?: ReadonlyMap<string, DisplayRun>
  connected?: boolean
  items: TimelineItem[]
  theme: Theme
  onRetry: () => void
  /** 用户消息的"回退到此处"；省略时不显示回退动作。 */
  onRewind?: (seq: number, text: string) => void
  /** 兼容既有调用方；用户消息已不呈现分叉入口。 */
  onFork?: (seq: number) => void
  /** 成功助手最终回复为包含边界的新对话。 */
  onBranch?: (seq: number) => void
  /** Run 进行中或有待处理的请求：消息动作不可用。 */
  actionsDisabled?: boolean
  /** 应用拥有追踪入口；子 Session 无对应定位时省略。 */
  onInspect?: (toolCallId: string) => void
}

/** 消息流：用户气泡、流式 Markdown、思考过程、工具卡与 Run 结束状态。key 为条目身份，流式更新不重挂载。 */
export function TimelineView(props: TimelineViewProps) {
  const { items, theme, onRetry, onRewind, actionsDisabled = false } = props
  const { t } = useI18n()
  const [attachmentFailure, setAttachmentFailure] = React.useState<string | null>(null)
  const inheritedReveal = React.useContext(TimelineRevealContext)
  const revealScope = useMainTimelineReveal(props.sessionId, props.publishMainProjection ?? false)
  const revealContext = React.useMemo(
    () =>
      revealScope
        ? { scope: revealScope }
        : inheritedReveal && inheritedReveal.scope.sessionId === props.sessionId
          ? { scope: inheritedReveal.scope }
          : undefined,
    [revealScope, inheritedReveal?.scope, props.sessionId],
  )
  const messageIdentities = useMessageIdentities(items, props.sessionId)
  // 一次遍历汇总每个 Run 的用量，避免每个底栏各扫一遍全部条目。
  const usage = React.useMemo(() => sumUsageByRun(props.entries ?? [], withoutPricing), [props.entries])
  const footers = new Map([...copiedReplyFooters(items, props.entries ?? []), ...completedReplyFooters(items, props.entries ?? [], props.runs)])
  const latestFooterRunId =
    items.findLast((item) => item.kind === 'run-usage')?.runId ?? footers.get(items.findLast((item) => footers.has(item.key))?.key ?? '')?.runId
  // 被回退区间只读，其末尾消息不是会话的最新输入，不享受常显。
  const latestUserKey = props.readOnly ? undefined : items.findLast((item) => item.kind === 'user')?.key
  const endingFooters = new Map(
    items.flatMap((item) => {
      if (item.kind !== 'run-usage' || [...footers.values()].some((reply) => reply.runId === item.runId)) return []
      const reply = endedRunFooter(props.entries ?? [], props.runs?.get(item.runId))
      return reply ? [[item.key, reply] as const] : []
    }),
  )
  // Suppressed ending seats must not reserve a ProcessTimeline gap after a final reply.
  const visibleItems = items.filter((item) => item.kind !== 'run-usage' || endingFooters.has(item.key))
  const projectionOwner = React.useMemo(() => ({}), [props.sessionId])
  React.useLayoutEffect(() => {
    if (!props.publishMainProjection || !props.sessionId) return
    const id = props.sessionId
    return () => releaseTimelineProjection(projectionOwner, id)
  }, [projectionOwner, props.publishMainProjection, props.sessionId])
  const renderItem = (item: TimelineItem) => {
    if (item.kind === 'thinking' && item.text.trim() === '') return null
    if (item.kind === 'plan' && planCardSuppressed(item, props.entries ?? [])) return null
    const rootAttributes = {
      'data-timeline-identity': messageIdentities.get(item.key) ?? item.key,
      'data-run-id': item.origin?.runId ?? undefined,
      'data-entry-seq': item.origin?.seq,
      ...(item.kind === 'tool' ? { 'data-tool-call-id': item.call.id } : {}),
    }
    switch (item.kind) {
      case 'user': {
        const actions = item.checkpoint && onRewind
        return (
          // 动作在悬停（支持 hover 的设备）或焦点进入消息时出现；不支持 hover 时一直可见。Tab 到消息即可到达。
          <article
            key={item.key}
            aria-label={t('conversation.you')}
            data-reading-anchor={item.key}
            data-seq={item.seq}
            tabIndex={actions || item.text !== '' ? 0 : undefined}
            data-slot="user-message"
            className="conversation-user-message group ms-auto flex w-fit min-w-0 flex-col items-end rounded-xl focus-ring"
          >
            {item.command ? (
              // 命令消息：显示命令名与参数，可展开看展开后的全文。
              <details data-slot="command-message" data-command={item.command.name} className="group/command flex flex-col items-end">
                <summary
                  aria-label={t('commands.chipLabel', { name: `/${item.command.name}` })}
                  data-slot="user-bubble"
                  className="flex max-w-full cursor-pointer items-center gap-1.5 rounded-xl bg-bubble px-4 py-2.5 text-ui-body-lg select-none focus-ring [&::-webkit-details-marker]:hidden"
                >
                  <SquareSlashIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                  <span className="font-medium">/{item.command.name}</span>
                  {item.command.args !== '' && (
                    <span data-user-content className="min-w-0 break-words whitespace-pre-wrap">
                      {item.command.args}
                    </span>
                  )}
                  <ChevronRightIcon
                    aria-hidden
                    className="size-4 shrink-0 text-muted-foreground transition-transform group-open/command:rotate-90 motion-reduce:transition-none"
                  />
                </summary>
                <div className="mt-1 rounded-xl border-hairline border-border px-4 py-2.5">
                  <p className="mb-1 text-ui-small text-muted-foreground">{t('commands.showExpanded')}</p>
                  <p data-user-content data-slot="command-expanded" className="text-ui-body break-words whitespace-pre-wrap">
                    {item.text}
                  </p>
                </div>
              </details>
            ) : (
              <p
                hidden={!item.text}
                data-slot="user-bubble"
                data-user-content
                className="max-w-full rounded-xl bg-bubble px-4 py-2.5 text-ui-body-lg break-words whitespace-pre-wrap"
              >
                {item.text}
              </p>
            )}
            {item.images
              ?.filter((image) => /^image\/(png|jpeg|gif|webp)$/.test(image.mimeType) && /^[A-Za-z0-9+/]+={0,2}$/.test(image.data))
              .map((image, index) => (
                <img
                  key={index}
                  src={`data:${image.mimeType};base64,${image.data}`}
                  alt={t('conversation.imageAttachment')}
                  className="max-h-80 max-w-full rounded-lg object-contain"
                />
              ))}
            {item.attachments && (
              <ul aria-label={t('conversation.fileAttachments')} data-slot="copied-attachments" className="flex max-w-full flex-wrap justify-end gap-2">
                {item.attachments.map((attachment) => (
                  <li key={attachment.path}>
                    <Button
                      type="button"
                      variant="outline"
                      className="max-w-full"
                      title={attachment.path}
                      onClick={async () => {
                        setAttachmentFailure(null)
                        try {
                          if (!(await window.coko?.openFile(attachment.path))) setAttachmentFailure(attachment.path)
                        } catch {
                          setAttachmentFailure(attachment.path)
                        }
                      }}
                    >
                      <FileIcon aria-hidden />
                      <span className="truncate">{attachment.name}</span>
                    </Button>
                    {attachmentFailure === attachment.path && (
                      <p role="alert" className="text-ui-small text-destructive">
                        {t('conversation.attachmentOpenFailed')}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {item.references && (
              // 随消息附上的文件：每个一个 chip（目录以 / 结尾），内容只发给模型。
              <ul aria-label={t('references.attached')} data-slot="file-references" className="flex max-w-full flex-wrap justify-end gap-2">
                {item.references.map((path) => (
                  <li
                    key={path}
                    data-slot="file-reference-chip"
                    data-path={path}
                    aria-label={t('references.chipLabel', { path })}
                    className="conversation-file-reference flex max-w-full min-w-0 items-center gap-2.5 rounded-lg border-hairline border-border px-3 py-2 text-ui-body-lg"
                  >
                    {path.endsWith('/') ? (
                      <FolderIcon aria-hidden className="size-7 shrink-0 text-muted-foreground" />
                    ) : (
                      <FileIcon aria-hidden className="size-7 shrink-0 text-muted-foreground" />
                    )}
                    <span data-user-content className="min-w-0 break-all">
                      {path}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div data-slot="user-message-footer" data-latest={item.key === latestUserKey} className="flex max-w-full items-center gap-2 transition-opacity">
              <MessageTime timestamp={item.origin?.createdAt} />
              {(item.text !== '' || actions) && (
                <div
                  role="group"
                  aria-label={t('conversation.messageActions')}
                  data-slot="message-actions"
                  className="conversation-message-actions flex items-center gap-2"
                >
                  {item.text !== '' && <CopyMessage text={item.invocation ?? item.text} />}
                  {actions && onRewind && (
                    <MessageAction
                      label={t('conversation.rewindHere')}
                      action="rewind"
                      disabled={actionsDisabled}
                      // 命令消息回退时放回原始调用，而不是展开后的全文。
                      onClick={() => onRewind(item.seq, item.invocation ?? item.text)}
                    >
                      <Undo2Icon />
                    </MessageAction>
                  )}
                </div>
              )}
            </div>
          </article>
        )
      }
      case 'rewound':
        // 被回退的区间：折叠保留，可展开查看；其中的消息不提供动作。
        return (
          <details key={item.key} data-slot="rewound" className="group/rewound min-w-0 text-ui-body text-muted-foreground">
            <summary className="flex cursor-pointer items-center gap-1.5 rounded-md select-none focus-ring [&::-webkit-details-marker]:hidden">
              <ChevronRightIcon aria-hidden className="size-4 transition-transform group-open/rewound:rotate-90 motion-reduce:transition-none" />
              {t('conversation.rewound', { count: item.items.length })}
            </summary>
            <div className="mt-2 flex flex-col gap-4 border-l-hairline border-border ps-3">
              <TimelineView
                sessionId={props.sessionId}
                entries={props.entries}
                items={item.items}
                runs={props.runs}
                connected={false}
                theme={theme}
                onRetry={onRetry}
                actionsDisabled
                historical
                readOnly
                onInspect={props.onInspect}
              />
            </div>
          </details>
        )
      case 'compaction':
        return <CompactionDivider key={item.key} rootAttributes={rootAttributes} item={item} theme={theme} />
      case 'text':
        return (
          <article
            key={messageIdentities.get(item.key) ?? item.key}
            aria-label={t('conversation.assistant')}
            data-user-content
            data-reading-anchor={messageIdentities.get(item.key) ?? item.key}
            data-streaming={item.streaming || undefined}
            className="conversation-assistant-message group min-w-0"
          >
            <div data-slot="assistant-message-body">
              <Markdown text={item.text} streaming={item.streaming} theme={theme} />
            </div>
            {footers.has(item.key) && (
              <AssistantFooter
                reply={footers.get(item.key)!}
                latest={footers.get(item.key)!.runId === latestFooterRunId}
                totals={usage.byRun.get(footers.get(item.key)!.runId)}
                branchAction={
                  props.onBranch && !props.readOnly && !props.historical ? (
                    <MessageAction
                      label={t('conversation.branchReply')}
                      action="branch-reply"
                      disabled={actionsDisabled}
                      onClick={() => props.onBranch?.(footers.get(item.key)!.seq)}
                    >
                      <GitBranchIcon />
                    </MessageAction>
                  ) : undefined
                }
              />
            )}
          </article>
        )
      case 'thinking':
        return (
          <ReasoningRow
            key={messageIdentities.get(item.key) ?? item.key}
            text={item.text}
            streaming={item.streaming}
            theme={theme}
            rootAttributes={rootAttributes}
          />
        )
      case 'tool':
        return (
          <ToolCardView
            key={item.key}
            item={item}
            onInspect={props.onInspect ? () => props.onInspect?.(item.call.id) : undefined}
            rootAttributes={rootAttributes}
          />
        )
      case 'generating':
        return (
          <p key={item.key} aria-live="polite" data-generating className="flex items-center gap-2 text-ui-body text-muted-foreground">
            <LoaderCircleIcon aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
            {item.retry ? t('conversation.retrying', { attempt: item.retry.attempt, max: item.retry.maxRetries }) : t('conversation.generating')}
          </p>
        )
      case 'steering':
        // 待送达的追加指令只在 dock 的 Queue 卡中显示（唯一呈现）。
        return null
      case 'paused':
        return (
          <p key={item.key} data-run-status="paused" className="text-ui-body text-muted-foreground">
            {t('conversation.paused')}
          </p>
        )
      case 'interrupted':
        return (
          <p key={item.key} data-run-status="interrupted" className="text-ui-body text-muted-foreground">
            {t('conversation.interrupted')}
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
          <div key={item.key} role="alert" data-run-status="error" className="flex flex-col gap-2 rounded-lg border border-destructive px-3 py-2 text-ui-body">
            <p className="font-medium text-destructive">{t('conversation.runError')}</p>
            {item.message !== '' && (
              <p data-user-content className="break-words whitespace-pre-wrap text-muted-foreground select-text">
                {item.message}
              </p>
            )}
            {item.incrementalToolsRejected && <p className="break-words whitespace-pre-wrap text-muted-foreground">{t('mcp.toolSearch.rejectedHint')}</p>}
            {item.retryable && !actionsDisabled && (
              <Button variant="outline" size="sm" className="self-start" onClick={onRetry}>
                <RotateCcwIcon />
                {t('conversation.retry')}
              </Button>
            )}
          </div>
        )
      case 'plan':
        return <PlanCard key={item.key} rootAttributes={rootAttributes} item={item} />
      case 'goal':
        return <GoalRow key={item.key} rootAttributes={rootAttributes} item={item} />
      case 'job':
        return <JobRow key={item.key} rootAttributes={rootAttributes} item={item} />
      case 'run-usage': {
        const reply = endingFooters.get(item.key)
        return reply ? (
          <div key={item.key} className="conversation-terminal-footer group min-w-0">
            <AssistantFooter reply={reply} latest={item.runId === latestFooterRunId} totals={usage.byRun.get(reply.runId)} />
          </div>
        ) : null
      }
      case 'hook':
        return <HookRow key={item.key} rootAttributes={rootAttributes} item={item} />
      case 'agent-notification':
        return <AgentNotificationRow key={item.key} rootAttributes={rootAttributes} item={item} />
      case 'schedule-fire':
        return <ScheduleFireRow key={item.key} rootAttributes={rootAttributes} item={item} />
      case 'handoff':
        return <HandoffRow key={item.key} rootAttributes={rootAttributes} item={item} />
      case 'team-message':
        return <TeamMessageRow key={item.key} rootAttributes={rootAttributes} item={item} />
      case 'team-task':
        return <TeamTaskRow key={item.key} rootAttributes={rootAttributes} item={item} />
    }
  }
  return (
    <TimelineSessionContext.Provider
      value={{
        sessionId: props.sessionId ?? null,
        entries: props.entries ?? [],
        actionsDisabled,
        historical: props.historical ?? false,
        readOnly: props.readOnly ?? false,
        openPlan: props.onOpenPlan,
      }}
    >
      <TimelineRevealContext.Provider value={revealContext}>
        <ProcessTimeline
          key={props.sessionId}
          mainRevealScope={revealScope}
          items={visibleItems}
          identities={messageIdentities}
          runs={props.runs}
          connected={props.connected}
          renderItem={renderItem}
          onProjection={
            props.publishMainProjection && props.sessionId
              ? (projection) =>
                  publishTimelineProjection(projectionOwner, {
                    ...projection,
                    sessionId: props.sessionId!,
                    entries: props.entries ?? [],
                  })
              : undefined
          }
        />
      </TimelineRevealContext.Provider>
    </TimelineSessionContext.Provider>
  )
}
