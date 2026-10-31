import { formatPermissionRule, type ApprovalRequestPayload, type SessionEntry, type SessionEntryOf } from '@coko/protocol'
import { ApprovalCard, DiffBlock, ToolOutput } from '@coko/ui'
import * as React from 'react'
import { useChat, useChatActions } from '../../app/chat.tsx'
import { useI18n } from '../../app/i18n.tsx'
import { isAgentRunning } from '../../stores/agents-store.ts'
import { pendingApprovals } from '../../stores/chat-store.ts'
import { useSessionAgents } from './agents-button.tsx'
import { PlanReviewPanel } from './plan-review-panel.tsx'
import type { ToolCallBlock } from './timeline.ts'

/** 父会话输入区接管的子代理审批：子 Session、来源（类型与描述）与对应的工具调用。 */
export interface ChildApproval {
  entry: SessionEntryOf<'approval_request'>
  sessionId: string
  agentType: string
  description: string
  call: ToolCallBlock | undefined
}

const EMPTY: SessionEntry[] = []

/** 条目中按 id 找到的工具调用（assistant 消息的 toolCall 块）。 */
function findCall(entries: readonly SessionEntry[], toolCallId: string): ToolCallBlock | undefined {
  for (const entry of entries) {
    if (entry.kind !== 'message' || entry.payload.role !== 'assistant') continue
    for (const block of entry.payload.content as { type: string; id?: unknown; name?: unknown; arguments?: unknown }[])
      if (block.type === 'toolCall' && block.id === toolCallId) return { id: toolCallId, name: String(block.name), arguments: block.arguments }
  }
  return undefined
}

/**
 * 父会话的 running 子代理中最早的待审批请求（docs/subsystems/subagents.md#界面）：订阅这些子 Session 的条目（不切换当前会话），
 * 按请求条目的 createdAt 取最早的一个。子 Session 的审批照常在子 Session 中等待，回答经子 Session 的接口发出。
 */
export function useChildApproval(parentSessionId: string | null): ChildApproval | undefined {
  const agents = useSessionAgents(parentSessionId)
  const running = (agents?.agents ?? []).filter(isAgentRunning)
  const ids = running.map((a) => a.agentId).join('\n')
  const { subscribeSession } = useChatActions()
  React.useEffect(() => {
    for (const id of ids === '' ? [] : ids.split('\n')) void subscribeSession(id)
  }, [ids, subscribeSession])
  const entry = useChat((s) => {
    let earliest: SessionEntryOf<'approval_request'> | undefined
    for (const id of ids === '' ? [] : ids.split('\n')) {
      const first = pendingApprovals(s.conversations[id]?.entries ?? EMPTY)[0]
      if (first && (!earliest || first.createdAt < earliest.createdAt)) earliest = first
    }
    return earliest
  })
  const childEntries = useChat((s) => (entry ? (s.conversations[entry.sessionId]?.entries ?? EMPTY) : EMPTY))
  const call = React.useMemo(() => (entry ? findCall(childEntries, entry.payload.toolCallId) : undefined), [childEntries, entry])
  if (!entry) return undefined
  const agent = running.find((a) => a.agentId === entry.sessionId)
  return { entry, sessionId: entry.sessionId, agentType: agent?.agentType ?? '', description: agent?.description ?? '', call }
}

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
  /** 请求来自父会话的子代理：卡片标出"来自子代理 <类型> · <描述>"。 */
  source?: { agentType: string; description: string }
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
  // 计划审阅只属于当前会话（子 Session 没有 exit_plan_mode）。
  if (props.request.kind === 'plan' && !props.source) return <PlanApproval {...props} />
  return <ToolApproval {...props} />
}

function ToolApproval({ request, call, onAllow, onAllowAlways, onReject, autoFocus, className, source }: ApprovalPanelProps) {
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
      {...(source ? { description: t('agents.approvalSource', { type: source.agentType, description: source.description }) } : {})}
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
