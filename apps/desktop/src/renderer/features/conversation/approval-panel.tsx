import { formatPermissionRule, type ApprovalRequestPayload } from '@coko/protocol'
import { ApprovalCard, DiffBlock, ToolOutput } from '@coko/ui'
import { useChat, useChatActions } from '../../app/chat.tsx'
import { useI18n } from '../../app/i18n.tsx'
import { PlanReviewPanel } from './plan-review-panel.tsx'
import type { ToolCallBlock } from './timeline.ts'

export interface ApprovalPanelProps {
  request: ApprovalRequestPayload
  /** 对应的工具调用（参数来自 assistant 消息）；中途订阅时可能尚未到达。 */
  call: ToolCallBlock | undefined
  onAllow: () => Promise<boolean>
  /** 保存建议规则并允许。请求没有建议规则（越界写入、受保护路径、提权等）时不显示。 */
  onAllowAlways?: (scope: AllowScope) => Promise<boolean>
  onReject: (feedback?: string) => Promise<boolean>
  autoFocus?: boolean
  className?: string
  /** kind plan 的请求：打开右栏的 Plan tab（审阅卡的"在右栏查看"与新计划自动打开）。 */
  onOpenPlan?: () => void
}

export type AllowScope = 'session' | 'workspace' | 'global'

const str = (value: unknown) => (typeof value === 'string' ? value : undefined)

/** edit 的 diff 摘要：每处替换的旧文本以 "-"、新文本以 "+" 开头。 */
function editDiff(args: Record<string, unknown>): string {
  const edits = Array.isArray(args.edits) ? args.edits : []
  return edits
    .flatMap((edit: unknown) => {
      const e = (edit ?? {}) as Record<string, unknown>
      return [...(str(e.oldText) ?? '').split('\n').map((line) => `-${line}`), ...(str(e.newText) ?? '').split('\n').map((line) => `+${line}`)]
    })
    .join('\n')
}

function json(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? ''
  } catch {
    return String(value)
  }
}

/** 提权请求的明细：命令、目标档位与模型给出的理由（ADR 0005）。 */
function EscalationDetail({ request }: { request: ApprovalRequestPayload }) {
  const { t } = useI18n()
  return (
    <>
      <p data-user-content className="font-mono text-ui-body break-all">
        {request.subject}
      </p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-ui-body">
        <dt className="text-muted-foreground">{t('approval.escalationTarget')}</dt>
        <dd data-escalation-target className="font-medium">
          {request.targetMode ? t(`sandbox.modes.${request.targetMode}`) : ''}
        </dd>
        {request.justification !== undefined && (
          <>
            <dt className="text-muted-foreground">{t('approval.escalationJustification')}</dt>
            <dd data-escalation-justification data-user-content className="break-words">
              {request.justification}
            </dd>
          </>
        )}
      </dl>
    </>
  )
}

/** 审批请求的明细：命令、路径、写入内容或 edit 的 diff 摘要；未知工具原样显示参数。 */
function Detail({ request, call }: { request: ApprovalRequestPayload; call: ToolCallBlock | undefined }) {
  if (request.kind === 'escalation') return <EscalationDetail request={request} />
  const args = call?.arguments && typeof call.arguments === 'object' ? (call.arguments as Record<string, unknown>) : {}
  const subject = request.subject !== '' && (
    <p data-user-content className="font-mono text-ui-body break-all">
      {request.subject}
    </p>
  )
  switch (request.toolName) {
    case 'bash':
      return subject || null
    case 'write':
      return (
        <>
          {subject}
          <ToolOutput className="max-h-40 rounded-lg bg-code-block">{str(args.content) ?? ''}</ToolOutput>
        </>
      )
    case 'edit':
      return (
        <>
          {subject}
          <DiffBlock className="max-h-40 rounded-lg bg-code-block" diff={editDiff(args)} />
        </>
      )
    case 'read':
    case 'grep':
    case 'find':
    case 'ls':
      return subject || null
    default:
      return <ToolOutput className="max-h-40 rounded-lg bg-code-block">{json(call?.arguments)}</ToolOutput>
  }
}

const TITLE = {
  bash: 'approval.titleBash',
  write: 'approval.titleWrite',
  edit: 'approval.titleEdit',
  read: 'approval.titleRead',
  grep: 'approval.titleRead',
  find: 'approval.titleRead',
  ls: 'approval.titleRead',
} as const

/** 接管输入区的审批卡：一次只显示一个待审批请求（最早的）。 */
/** kind plan：计划审阅接管输入区（读取当前会话的条目与回答接口）。 */
function PlanApproval({ request, autoFocus, className, onOpenPlan }: Pick<ApprovalPanelProps, 'request' | 'autoFocus' | 'className' | 'onOpenPlan'>) {
  const sessionId = useChat((s) => s.activeSessionId)
  const entries = useChat((s) => (s.activeSessionId === null ? undefined : s.conversations[s.activeSessionId]?.entries))
  const { answerApproval } = useChatActions()
  if (sessionId === null || !entries) return null
  return (
    <PlanReviewPanel
      sessionId={sessionId}
      request={request}
      entries={entries}
      answer={(answer) => answerApproval(request.requestId, answer)}
      onOpenPanel={onOpenPlan}
      {...(autoFocus ? { autoFocus } : {})}
      {...(className ? { className } : {})}
    />
  )
}

export function ApprovalPanel(props: ApprovalPanelProps) {
  if (props.request.kind === 'plan') return <PlanApproval {...props} />
  return <ToolApproval {...props} />
}

function ToolApproval({ request, call, onAllow, onAllowAlways, onReject, autoFocus, className }: ApprovalPanelProps) {
  const { t } = useI18n()
  const key = TITLE[request.toolName as keyof typeof TITLE]
  const accepted = async (sent: Promise<boolean>) => {
    if (!(await sent)) throw new Error('approval answer was not accepted')
  }
  const canSave = onAllowAlways !== undefined && request.kind === 'tool' && request.suggestions.length > 0
  const allowAlways = canSave
    ? {
        label: t('approval.allowAlways'),
        menuLabel: t('approval.allowAlwaysMenu'),
        description: t('approval.allowAlwaysRule', { rule: request.suggestions.map(formatPermissionRule).join(', ') }),
        options: [
          { scope: 'session' as const, label: t('approval.scopeSession') },
          { scope: 'workspace' as const, label: t('approval.scopeWorkspace') },
          { scope: 'global' as const, label: t('approval.scopeGlobal') },
        ],
        onSelect: (scope: string) => accepted(onAllowAlways(scope as AllowScope)),
      }
    : undefined
  return (
    <ApprovalCard
      className={className}
      {...(autoFocus ? { autoFocus } : {})}
      {...(allowAlways ? { allowAlways } : {})}
      requestKey={request.requestId}
      title={request.kind === 'escalation' ? t('approval.titleEscalation') : key ? t(key) : t('approval.titleTool', { name: request.toolName })}
      labels={{
        status: t('approval.status'),
        detailLabel: t('approval.detail'),
        allowOnce: t('approval.allowOnce'),
        reject: t('approval.reject'),
        rejectWithReason: t('approval.rejectWithReason'),
        feedbackLabel: t('approval.feedbackLabel'),
        feedbackPlaceholder: t('approval.feedbackPlaceholder'),
      }}
      onAllow={() => accepted(onAllow())}
      onReject={(feedback) => accepted(onReject(feedback))}
    >
      <Detail request={request} call={call} />
    </ApprovalCard>
  )
}
