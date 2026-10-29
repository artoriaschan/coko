import type * as React from 'react'
import { Button, Tooltip, TooltipContent, TooltipTrigger } from '@coko/ui'
import { ChevronRightIcon, FileIcon, FolderIcon, GitBranchIcon, LoaderCircleIcon, RotateCcwIcon, SquareSlashIcon, Undo2Icon } from 'lucide-react'
import type { Theme } from '../../app/appearance-store.ts'
import { useI18n } from '../../app/i18n.tsx'
import { Markdown } from './markdown.tsx'
import type { TimelineItem } from './timeline.ts'
import { ToolCardView } from './tool-cards.tsx'

export interface TimelineViewProps {
  items: TimelineItem[]
  theme: Theme
  onRetry: () => void
  /** 用户消息的"回退到此处"；省略时不显示消息动作。 */
  onRewind?: (seq: number, text: string) => void
  /** 用户消息的"从这里分叉"。 */
  onFork?: (seq: number) => void
  /** Run 进行中或有待处理的请求：消息动作不可用。 */
  actionsDisabled?: boolean
}

/** 消息动作按钮：仅图标，Tooltip 与可访问名称同一文案。 */
function MessageAction({
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
        <Button variant="toolbar" size="icon-sm" aria-label={label} data-action={action} disabled={disabled} onClick={onClick}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

/** 消息流：用户气泡、流式 Markdown、思考过程、工具卡与 Run 结束状态。key 为条目身份，流式更新不重挂载。 */
export function TimelineView(props: TimelineViewProps) {
  const { items, theme, onRetry, onRewind, onFork, actionsDisabled = false } = props
  const { t } = useI18n()
  return (
    <>
      {items.map((item) => {
        switch (item.kind) {
          case 'user': {
            const actions = item.checkpoint && (onRewind || onFork)
            return (
              // 动作在悬停（支持 hover 的设备）或焦点进入消息时出现；不支持 hover 时一直可见。Tab 到消息即可到达。
              <article
                key={item.key}
                aria-label={t('conversation.you')}
                data-seq={item.seq}
                tabIndex={actions ? 0 : undefined}
                className="group ms-auto flex w-fit max-w-[85%] flex-col items-end gap-1 rounded-xl focus-ring"
              >
                {item.command ? (
                  // 命令消息：显示命令名与参数，可展开看展开后的全文。
                  <details data-slot="command-message" data-command={item.command.name} className="group/command flex flex-col items-end">
                    <summary
                      aria-label={t('commands.chipLabel', { name: `/${item.command.name}` })}
                      className="flex cursor-pointer items-center gap-1.5 rounded-xl bg-bubble px-4 py-2.5 text-ui-body-lg select-none focus-ring [&::-webkit-details-marker]:hidden"
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
                  <p data-user-content className="rounded-xl bg-bubble px-4 py-2.5 text-ui-body-lg break-words whitespace-pre-wrap">
                    {item.text}
                  </p>
                )}
                {item.references && (
                  // 随消息附上的文件：每个一个 chip（目录以 / 结尾），内容只发给模型。
                  <ul aria-label={t('references.attached')} data-slot="file-references" className="flex max-w-full flex-wrap justify-end gap-1">
                    {item.references.map((path) => (
                      <li
                        key={path}
                        data-slot="file-reference-chip"
                        data-path={path}
                        aria-label={t('references.chipLabel', { path })}
                        className="flex h-6 max-w-full min-w-0 items-center gap-1 rounded-sm border-hairline border-border px-2 text-ui-small text-muted-foreground"
                      >
                        {path.endsWith('/') ? <FolderIcon aria-hidden className="size-3.5 shrink-0" /> : <FileIcon aria-hidden className="size-3.5 shrink-0" />}
                        <span className="truncate">{path}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {actions && (
                  <div
                    role="group"
                    aria-label={t('conversation.messageActions')}
                    data-slot="message-actions"
                    className="flex gap-0.5 transition-opacity group-focus-within:opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100"
                  >
                    {onRewind && (
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
                    {onFork && (
                      <MessageAction label={t('conversation.forkHere')} action="fork" disabled={actionsDisabled} onClick={() => onFork(item.seq)}>
                        <GitBranchIcon />
                      </MessageAction>
                    )}
                  </div>
                )}
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
                <div className="mt-2 flex flex-col gap-4 border-l-hairline border-border ps-3 opacity-70">
                  <TimelineView items={item.items} theme={theme} onRetry={onRetry} />
                </div>
              </details>
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
          case 'steering':
            // 待送达的追加指令：与用户气泡同形，弱化显示并标注状态。
            return (
              <article
                key={item.key}
                aria-label={t('conversation.you')}
                data-steering="pending"
                className="ms-auto flex w-fit max-w-[85%] flex-col items-end gap-1"
              >
                <p data-user-content className="rounded-xl bg-bubble px-4 py-2.5 text-ui-body-lg break-words whitespace-pre-wrap opacity-60">
                  {item.text}
                </p>
                <span className="text-ui-small text-muted-foreground">{t('conversation.steeringPending')}</span>
              </article>
            )
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
                {item.retryable && (
                  <Button variant="outline" size="sm" className="self-start" onClick={onRetry}>
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
