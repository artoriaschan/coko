import { ChevronRightIcon, LoaderCircleIcon } from 'lucide-react'
import * as React from 'react'
import { cn } from '../lib/utils.ts'

/** awaiting：等待用户审批，尚未执行。 */
export type ToolCardStatus = 'running' | 'done' | 'error' | 'pending' | 'awaiting'

export interface ToolCardProps {
  icon: React.ReactNode
  /** 工具或操作名（已本地化或协议原文）。 */
  title: string
  /** 一行摘要：路径、命令、模式等，保持原文。 */
  summary?: string
  status: ToolCardStatus
  /** 已本地化的状态名称，作为状态指示的无障碍名称。 */
  statusLabel: string
  /** 摘要右侧的附加信息（如退出码、行数）。 */
  meta?: React.ReactNode
  /** 可展开的明细；为空时卡片只有标题行。 */
  children?: React.ReactNode
  defaultExpanded?: boolean
  /** 由业务层提供的稳定标识（例如工具名），便于观测与测试。 */
  'data-tool'?: string
  className?: string
}

/** 工具卡外壳：标题行（图标、名称、摘要、状态）与可展开明细。工具专属内容由业务层组合。 */
export function ToolCard({ icon, title, summary, status, statusLabel, meta, children, defaultExpanded = false, className, ...rest }: ToolCardProps) {
  const [expanded, setExpanded] = React.useState(defaultExpanded)
  const bodyId = React.useId()
  const hasBody = children !== undefined && children !== null && children !== false
  const header = (
    <>
      <span aria-hidden className="flex size-4 shrink-0 items-center justify-center text-muted-foreground [&_svg]:size-4">
        {icon}
      </span>
      <span className="shrink-0 font-medium">{title}</span>
      {summary !== undefined && summary !== '' && (
        <span data-user-content className="min-w-0 flex-1 truncate font-mono text-ui-small text-muted-foreground" title={summary}>
          {summary}
        </span>
      )}
      {(summary === undefined || summary === '') && <span className="flex-1" />}
      {meta}
      <ToolStatus status={status} label={statusLabel} />
      {hasBody && <ChevronRightIcon aria-hidden className={cn('size-4 shrink-0 text-muted-foreground transition-transform', expanded && 'rotate-90')} />}
    </>
  )
  return (
    <div
      data-slot="tool-card"
      data-status={status}
      data-tool={rest['data-tool']}
      className={cn(
        'min-w-0 overflow-hidden rounded-lg bg-card-fill text-ui-body',
        // 中性线为 0.5px；状态色边框保持 1px（设计系统规格）。
        status === 'error' ? 'border border-destructive' : 'border-hairline border-border',
        className,
      )}
    >
      {hasBody ? (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={bodyId}
          onClick={() => setExpanded((open) => !open)}
          className="flex h-9 w-full min-w-0 items-center gap-2 px-3 text-left focus-ring hover:bg-accent"
        >
          {header}
        </button>
      ) : (
        <div className="flex h-9 w-full min-w-0 items-center gap-2 px-3">{header}</div>
      )}
      {hasBody && expanded && (
        <div id={bodyId} data-slot="tool-card-body" className="border-t-hairline border-border">
          {children}
        </div>
      )}
    </div>
  )
}

function ToolStatus({ status, label }: { status: ToolCardStatus; label: string }) {
  if (status === 'running')
    return <LoaderCircleIcon role="img" aria-label={label} className="size-4 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none" />
  return (
    <span
      role="img"
      aria-label={label}
      className={cn(
        'size-2 shrink-0 rounded-round',
        status === 'done' && 'bg-success',
        status === 'error' && 'bg-destructive',
        status === 'pending' && 'bg-muted-foreground',
        status === 'awaiting' && 'bg-warning',
      )}
    />
  )
}

/** 终端与工具文本输出：等宽、保持列对齐，横向在区域内滚动，纵向限高。 */
export function ToolOutput({ children, className }: { children: string; className?: string }) {
  return (
    <pre data-user-content className={cn('max-h-80 overflow-auto px-3 py-2 font-mono text-ui-small whitespace-pre', className)}>
      {children}
    </pre>
  )
}

/**
 * 行号 diff（pi edit 工具格式：每行以 "+"、"-" 或空格开头，随后是行号与内容）。
 * 增删行使用 diff 语义色；整体在区域内横向滚动。
 */
export function DiffBlock({ diff, className }: { diff: string; className?: string }) {
  const lines = diff.split('\n')
  return (
    <pre data-user-content data-slot="diff-block" className={cn('max-h-96 overflow-auto py-1 font-mono text-ui-small', className)}>
      {lines.map((line, index) => {
        const kind = line.startsWith('+') ? 'added' : line.startsWith('-') ? 'deleted' : 'context'
        return (
          <div
            key={index}
            data-diff={kind}
            className={cn('min-w-max px-3 whitespace-pre', kind === 'added' && 'bg-diff-added', kind === 'deleted' && 'bg-diff-deleted')}
          >
            {line === '' ? ' ' : line}
          </div>
        )
      })}
    </pre>
  )
}
