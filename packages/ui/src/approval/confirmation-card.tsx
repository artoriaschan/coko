import * as React from 'react'
import { Button } from '../components/button.tsx'
import { cn } from '../lib/utils.ts'

export type ConfirmationAnswer = 'applied' | 'not-applied' | 'unknown'

export interface ConfirmationCardLabels {
  /** 状态行，例如"结果不明"。 */
  status: string
  /** 详情区（可聚焦）的无障碍名称。 */
  detailLabel: string
  applied: string
  notApplied: string
  unknown: string
}

export interface ConfirmationCardProps {
  /** 请求身份（toolCallId）；变化时重置回答状态。 */
  requestKey: string
  title: string
  description?: string
  labels: ConfirmationCardLabels
  /** 回答；拒绝（reject）后解锁，可再次回答。 */
  onAnswer: (answer: ConfirmationAnswer) => Promise<void>
  /** 中断的调用：工具、命令或路径。 */
  children?: React.ReactNode
  /** 出现时聚焦卡片本身；Tab 进入详情与按钮。 */
  autoFocus?: boolean
  className?: string
}

/**
 * 结果确认卡：恢复时结果不明的调用临时接管输入区（与审批卡同位置、同时只显示一张）。三个回答没有默认项，
 * Enter / Esc 不代替用户作答；同一请求只回答一次，失败后解锁。
 */
export function ConfirmationCard(props: ConfirmationCardProps) {
  return <ConfirmationFlow key={props.requestKey} {...props} />
}

function ConfirmationFlow({ requestKey, title, description, labels, onAnswer, children, autoFocus, className }: ConfirmationCardProps) {
  const [answered, setAnswered] = React.useState(false)
  const waiting = React.useRef(false)
  const mounted = React.useRef(true)
  const root = React.useRef<HTMLElement>(null)
  const titleId = React.useId()
  React.useEffect(() => {
    if (autoFocus) root.current?.focus()
    // 只在请求出现时聚焦一次（requestKey 变化会重新挂载）。
  }, [])
  React.useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const answer = (value: ConfirmationAnswer) => {
    if (waiting.current) return
    waiting.current = true
    setAnswered(true)
    onAnswer(value).catch(() => {
      if (!mounted.current) return
      waiting.current = false
      setAnswered(false)
    })
  }

  return (
    <section
      ref={root}
      tabIndex={-1}
      data-slot="confirmation-card"
      data-confirmation-key={requestKey}
      aria-busy={answered || undefined}
      aria-labelledby={titleId}
      className={cn('flex flex-col overflow-hidden rounded-panel bg-background shadow-soft outline-none', className)}
    >
      <p role="status" className="flex items-center gap-2 px-4 pt-3 text-ui-small text-muted-foreground">
        <span aria-hidden className="size-2 shrink-0 rounded-round bg-warning" />
        {labels.status}
      </p>
      <div
        role="group"
        tabIndex={0}
        aria-label={labels.detailLabel}
        data-slot="confirmation-detail"
        className="mx-2 mt-1 flex max-h-60 min-w-0 flex-col gap-2 overflow-y-auto rounded-xl px-2 py-2 focus-ring"
      >
        <p id={titleId} className="text-ui-body-lg font-medium">
          {title}
        </p>
        {description !== undefined && <p className="text-ui-body text-muted-foreground">{description}</p>}
        {children}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2 px-4 py-3">
        <Button type="button" variant="ghost" size="sm" data-answer="unknown" disabled={answered} onClick={() => answer('unknown')}>
          {labels.unknown}
        </Button>
        <Button type="button" variant="outline" size="sm" data-answer="not-applied" disabled={answered} onClick={() => answer('not-applied')}>
          {labels.notApplied}
        </Button>
        <Button type="button" variant="outline" size="sm" data-answer="applied" disabled={answered} onClick={() => answer('applied')}>
          {labels.applied}
        </Button>
      </div>
    </section>
  )
}
