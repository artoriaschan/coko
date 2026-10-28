import { ConfirmationCard, ToolOutput, type ConfirmationAnswer } from '@coko/ui'
import { useI18n } from '../../app/i18n.tsx'
import type { PendingConfirmation } from '../../stores/chat-store.ts'

export interface ConfirmationPanelProps {
  confirmation: PendingConfirmation
  onAnswer: (answer: ConfirmationAnswer) => Promise<boolean>
  autoFocus?: boolean
  className?: string
}

const str = (value: unknown) => (typeof value === 'string' ? value : undefined)

/** 中断的调用的主体：命令或路径；其余工具原样显示参数。 */
function subjectOf(confirmation: PendingConfirmation): string {
  const args = confirmation.arguments && typeof confirmation.arguments === 'object' ? (confirmation.arguments as Record<string, unknown>) : {}
  if (confirmation.toolName === 'bash') return str(args.command) ?? ''
  const path = str(args.path)
  if (path !== undefined) return path
  try {
    return JSON.stringify(confirmation.arguments ?? {}, null, 2)
  } catch {
    return ''
  }
}

/** 结果确认卡（grilling E4）：恢复时结果不明的调用接管输入区，用户回答它是否已生效。 */
export function ConfirmationPanel({ confirmation, onAnswer, autoFocus, className }: ConfirmationPanelProps) {
  const { t } = useI18n()
  const accepted = async (sent: Promise<boolean>) => {
    if (!(await sent)) throw new Error('confirmation answer was not accepted')
  }
  const subject = subjectOf(confirmation)
  return (
    <ConfirmationCard
      className={className}
      {...(autoFocus ? { autoFocus } : {})}
      requestKey={confirmation.toolCallId}
      title={confirmation.toolName === 'bash' ? t('confirmation.titleBash') : t('confirmation.titleTool', { name: confirmation.toolName ?? '' })}
      description={t('confirmation.description')}
      labels={{
        status: t('confirmation.status'),
        detailLabel: t('confirmation.detail'),
        applied: t('confirmation.applied'),
        notApplied: t('confirmation.notApplied'),
        unknown: t('confirmation.unknown'),
      }}
      onAnswer={(answer) => accepted(onAnswer(answer))}
    >
      {subject !== '' && (
        <div data-user-content>
          <ToolOutput className="max-h-40 rounded-lg bg-code-block">{subject}</ToolOutput>
        </div>
      )}
    </ConfirmationCard>
  )
}
