import { ChevronDownIcon } from 'lucide-react'
import * as React from 'react'
import { Button } from '../components/button.tsx'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '../components/dropdown-menu.tsx'
import { Input } from '../components/input.tsx'
import { cn } from '../lib/utils.ts'

export interface ApprovalCardLabels {
  /** 状态行，例如"等待审批"。 */
  status: string
  /** 详情区（可聚焦）的无障碍名称。 */
  detailLabel: string
  allowOnce: string
  reject: string
  rejectWithReason: string
  feedbackLabel: string
  feedbackPlaceholder: string
}

/** "总是允许"：按范围保存规则并允许。范围与文案由调用方给出。 */
export interface ApprovalAllowAlways<Scope extends string = string> {
  label: string
  /** 菜单的标题。 */
  menuLabel: string
  /** 菜单中的说明，例如将保存的规则。 */
  description?: string
  options: readonly { scope: Scope; label: string }[]
  onSelect: (scope: Scope) => Promise<void>
}

export interface ApprovalCardProps {
  /** 请求身份；变化时重置回答状态与反馈输入。 */
  requestKey: string
  title: string
  description?: string
  /** 已本地化的文案。 */
  labels: ApprovalCardLabels
  /** 允许一次。reject 后可再次回答。 */
  onAllow: () => Promise<void>
  /** 拒绝；带反馈时 feedback 为去掉首尾空白的非空文本。 */
  onReject: (feedback?: string) => Promise<void>
  /** 省略时不显示"总是允许"（例如越界写入与提权只能允许一次）。 */
  allowAlways?: ApprovalAllowAlways
  /** 工具、命令、路径或 diff 等明细。 */
  children?: React.ReactNode
  /** 出现时聚焦卡片本身（不是详情区：误触的 Enter 不会允许）；Tab 进入详情与按钮。 */
  autoFocus?: boolean
  className?: string
}

/** 输入法组合中的按键（Chrome：isComposing；Safari：组合结束后的 keyCode 229）。 */
// keyCode 已弃用，但 229 是 Safari 识别确认候选的唯一途径。
const isImeKey = (event: React.KeyboardEvent) => event.nativeEvent.isComposing || event.keyCode === 229

/**
 * 审批卡：临时接管输入区（DSH ui-approval）。焦点在详情区时 Enter 允许一次、Esc 拒绝；输入框与按钮保留自己的按键；
 * 键盘与指针共用一把锁，同一请求只回答一次，回答失败后解锁。
 */
export function ApprovalCard(props: ApprovalCardProps) {
  return <ApprovalFlow key={props.requestKey} {...props} />
}

function ApprovalFlow({ title, description, labels, onAllow, onReject, allowAlways, children, autoFocus, className, requestKey }: ApprovalCardProps) {
  const [answered, setAnswered] = React.useState(false)
  const [feedbackOpen, setFeedbackOpen] = React.useState(false)
  const [feedback, setFeedback] = React.useState('')
  const waiting = React.useRef(false)
  const mounted = React.useRef(true)
  const composing = React.useRef(false)
  const detail = React.useRef<HTMLDivElement>(null)
  const root = React.useRef<HTMLElement>(null)
  const feedbackId = React.useId()
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

  const answer = (send: () => Promise<void>) => {
    if (waiting.current) return
    waiting.current = true
    setAnswered(true)
    send().catch(() => {
      if (!mounted.current) return
      waiting.current = false
      setAnswered(false)
    })
  }
  const reject = () => {
    const text = feedback.trim()
    answer(() => (text === '' ? onReject() : onReject(text)))
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.defaultPrevented || (event.key !== 'Enter' && event.key !== 'Escape')) return
    const target = event.target as Element
    // 经 portal 渲染的菜单的按键沿 React 树冒泡到这里：只处理卡片自身 DOM 内的按键。
    if (!root.current?.contains(target)) return
    if (target.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]')) return
    if (event.key === 'Enter' && target.closest('button, a[href], [role="button"]')) return
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return
    // 已被卡片处理：不再触发外层快捷键（例如 Escape 停止 Run）。
    event.preventDefault()
    event.stopPropagation()
    if (event.repeat || composing.current || isImeKey(event)) return
    if (event.key === 'Enter') answer(onAllow)
    else answer(() => onReject())
  }

  return (
    <section
      ref={root}
      tabIndex={-1}
      data-slot="approval-card"
      data-approval-key={requestKey}
      aria-busy={answered || undefined}
      aria-labelledby={`${feedbackId}-title`}
      className={cn('flex flex-col overflow-hidden rounded-panel bg-background shadow-soft outline-none', className)}
      onKeyDown={onKeyDown}
      onCompositionStartCapture={() => (composing.current = true)}
      onCompositionEndCapture={() => (composing.current = false)}
    >
      <p role="status" className="flex items-center gap-2 px-4 pt-3 text-ui-small text-muted-foreground">
        <span aria-hidden className="size-2 shrink-0 rounded-round bg-warning" />
        {labels.status}
      </p>
      <div
        ref={detail}
        role="group"
        tabIndex={0}
        aria-label={labels.detailLabel}
        data-slot="approval-detail"
        className="mx-2 mt-1 flex max-h-60 min-w-0 flex-col gap-2 overflow-y-auto rounded-xl px-2 py-2 focus-ring"
      >
        <p id={`${feedbackId}-title`} className="text-ui-body-lg font-medium">
          {title}
        </p>
        {description !== undefined && <p className="text-ui-body text-muted-foreground">{description}</p>}
        {children}
      </div>
      {feedbackOpen && (
        <div className="px-4 pt-2">
          <Input
            autoFocus
            aria-label={labels.feedbackLabel}
            placeholder={labels.feedbackPlaceholder}
            value={feedback}
            disabled={answered}
            onChange={(event) => setFeedback(event.target.value)}
            onKeyDown={(event) => {
              if ((event.key !== 'Enter' && event.key !== 'Escape') || isImeKey(event)) return
              event.preventDefault()
              event.stopPropagation()
              if (event.key === 'Enter') reject()
              else {
                setFeedbackOpen(false)
                setFeedback('')
                detail.current?.focus()
              }
            }}
          />
        </div>
      )}
      <div className="flex flex-wrap items-center justify-end gap-2 px-4 py-3">
        {!feedbackOpen && (
          <Button type="button" variant="ghost" size="sm" disabled={answered} onClick={() => setFeedbackOpen(true)}>
            {labels.rejectWithReason}
          </Button>
        )}
        <Button type="button" variant="outline" size="sm" data-action="reject" disabled={answered} onClick={reject}>
          {labels.reject}
        </Button>
        {allowAlways && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" size="sm" data-action="allow-always" disabled={answered}>
                {allowAlways.label}
                <ChevronDownIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="end" className="max-w-80">
              <DropdownMenuLabel>{allowAlways.menuLabel}</DropdownMenuLabel>
              {allowAlways.description !== undefined && (
                <p data-user-content className="px-2 pb-1 text-ui-small break-all text-muted-foreground">
                  {allowAlways.description}
                </p>
              )}
              {allowAlways.options.map((option) => (
                <DropdownMenuItem key={option.scope} data-scope={option.scope} onSelect={() => answer(() => allowAlways.onSelect(option.scope))}>
                  {option.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <Button type="button" size="sm" data-action="allow-once" disabled={answered} onClick={() => answer(onAllow)}>
          {labels.allowOnce}
        </Button>
      </div>
    </section>
  )
}
