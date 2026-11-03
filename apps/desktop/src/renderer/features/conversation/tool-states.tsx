import type { MessageKey } from '@coko/i18n'
import { useI18n } from '../../app/i18n.tsx'
import type { TimelineItem } from './timeline.ts'

type ToolItem = Extract<TimelineItem, { kind: 'tool' }>

type SandboxModeKey = 'read-only' | 'workspace-write' | 'danger-full-access'

/** bash 结果 details 中的沙箱拒绝（BashToolDetails.sandbox）。 */
function sandboxDenial(item: ToolItem): SandboxModeKey | undefined {
  const sandbox = (item.result?.details as { sandbox?: { mode?: unknown; denied?: unknown } } | undefined)?.sandbox
  return sandbox?.denied === true && (sandbox.mode === 'read-only' || sandbox.mode === 'workspace-write' || sandbox.mode === 'danger-full-access')
    ? sandbox.mode
    : undefined
}

/** 外部 Hook 拦下的调用（toolResult details.hostBlock { by: hook }，运行时写入，工具自身不能声明）。 */
export function hookBlock(item: ToolItem): { command: string } | undefined {
  const mark = (item.result?.details as { hostBlock?: { by?: unknown; command?: unknown } } | undefined)?.hostBlock
  return mark?.by === 'hook' && typeof mark.command === 'string' ? { command: mark.command } : undefined
}

/** 标题行的元信息：Hook 拦截、沙箱拒绝与已结束审批的决定。 */
export function ToolStateMeta({ item }: { item: ToolItem }) {
  const { t } = useI18n()
  const denied = sandboxDenial(item)
  const hook = hookBlock(item)
  return (
    <>
      {hook && (
        <span
          data-hook-blocked
          className="max-w-60 shrink truncate text-ui-small text-destructive"
          title={t('hooks.blockedCommand', { command: hook.command })}
        >
          {t('hooks.blockedBy')}
        </span>
      )}
      {denied && (
        <span data-sandbox-denied={denied} className="max-w-60 shrink truncate text-ui-small text-destructive">
          {t('sandbox.denied', { mode: t(`sandbox.shortModes.${denied}`) })}
        </span>
      )}
      <ApprovalMeta item={item} />
      {item.confirmation && item.confirmation.answer !== null ? (
        <span data-confirmation-outcome={item.confirmation.answer} className="text-ui-small text-warning-text">
          {t(`confirmation.recorded.${item.confirmation.answer}`)}
        </span>
      ) : null}
    </>
  )
}

/** 已结束审批的决定，显示在工具卡标题行。 */
function ApprovalMeta({ item }: { item: ToolItem }) {
  const { t } = useI18n()
  const decision = item.approval?.decision
  if (!decision) return null
  const target = item.approval?.request.kind === 'escalation' ? item.approval.request.targetMode : undefined
  let label: string
  switch (decision.outcome) {
    case 'allowed':
      label =
        decision.by === 'hook'
          ? t('hooks.allowedBy')
          : target
            ? t('approval.allowedWithMode', { mode: t(`sandbox.shortModes.${target}`) })
            : decision.scope === 'session'
              ? t('approval.allowedSession')
              : decision.scope === 'workspace'
                ? t('approval.allowedWorkspace')
                : decision.scope === 'global'
                  ? t('approval.allowedGlobal')
                  : t('approval.allowedOnce')
      break
    case 'denied':
      label = decision.feedback ? t('approval.deniedWithFeedback', { feedback: decision.feedback }) : t('approval.denied')
      break
    default:
      label = t(`approval.${decision.outcome}`)
  }
  return (
    <span data-approval-outcome={decision.outcome} className="max-w-60 shrink truncate text-ui-small text-muted-foreground" title={label}>
      {label}
    </span>
  )
}

/** Critical facts remain readable while either outer disclosure is closed. */
export function ProcessToolStates({ members }: { members: TimelineItem[] }) {
  const { t } = useI18n()
  const states = new Set<MessageKey>()
  for (const item of members) {
    if (item.kind !== 'tool') continue
    if (item.confirmation) states.add(item.confirmation.answer === null ? 'confirmation.status' : `confirmation.recorded.${item.confirmation.answer}`)
    else if (item.status === 'pending' && item.result === null) states.add('tool.noRecordedResult')
    if (item.status === 'awaiting') states.add('tool.awaiting')
    const decision = item.approval?.decision
    if (decision && decision.outcome !== 'allowed') states.add(`approval.${decision.outcome}`)
    if (hookBlock(item)) states.add('hooks.blockedBy')
    if (sandboxDenial(item)) states.add('tool.sandboxDenied')
    if (
      item.status === 'error' &&
      (!decision || decision.outcome === 'allowed' || decision.outcome === 'superseded') &&
      !hookBlock(item) &&
      !sandboxDenial(item) &&
      !item.confirmation
    )
      states.add('tool.error')
  }
  if (states.size === 0) return null
  return (
    <span data-slot="process-tool-states" className="flex min-w-0 flex-wrap items-center gap-x-3 text-ui-small text-warning-text">
      {[...states].map((key) => (
        <span key={key}>{t(key)}</span>
      ))}
    </span>
  )
}

/** Full reasons stay in the tool body; inspecting these facts has no execution callback. */
export function ToolStateDetail({ item }: { item: ToolItem }) {
  const { t } = useI18n()
  const feedback = item.approval?.decision?.feedback
  return (
    <>
      {feedback && (
        <p data-approval-feedback data-user-content className="px-3 py-2 text-ui-small break-words text-destructive">
          {feedback}
        </p>
      )}
      {item.confirmation?.answer === null && <p className="px-3 py-2 text-ui-small break-words text-warning-text">{t('confirmation.description')}</p>}
      {!item.confirmation && item.status === 'pending' && item.result === null && (
        <p className="px-3 py-2 text-ui-small text-warning-text">{t('tool.noRecordedResult')}</p>
      )}
    </>
  )
}
