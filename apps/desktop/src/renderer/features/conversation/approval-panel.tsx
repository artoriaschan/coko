import type { ApprovalRequestPayload } from '@coko/protocol'
import { ApprovalCard, DiffBlock, ToolOutput } from '@coko/ui'
import { useI18n } from '../../app/i18n.tsx'
import type { ToolCallBlock } from './timeline.ts'

export interface ApprovalPanelProps {
  request: ApprovalRequestPayload
  /** 对应的工具调用（参数来自 assistant 消息）；中途订阅时可能尚未到达。 */
  call: ToolCallBlock | undefined
  onAllow: () => Promise<boolean>
  onReject: (feedback?: string) => Promise<boolean>
  autoFocus?: boolean
  className?: string
}

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

/** 审批请求的明细：命令、路径、写入内容或 edit 的 diff 摘要；未知工具原样显示参数。 */
function Detail({ request, call }: { request: ApprovalRequestPayload; call: ToolCallBlock | undefined }) {
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
export function ApprovalPanel({ request, call, onAllow, onReject, autoFocus, className }: ApprovalPanelProps) {
  const { t } = useI18n()
  const key = TITLE[request.toolName as keyof typeof TITLE]
  const accepted = async (sent: Promise<boolean>) => {
    if (!(await sent)) throw new Error('approval answer was not accepted')
  }
  return (
    <ApprovalCard
      className={className}
      {...(autoFocus ? { autoFocus } : {})}
      requestKey={request.requestId}
      title={key ? t(key) : t('approval.titleTool', { name: request.toolName })}
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
