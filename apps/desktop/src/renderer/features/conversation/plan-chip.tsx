import { XIcon, ClipboardListIcon } from 'lucide-react'
import { useChat, useChatActions } from '../../app/chat.tsx'
import { useI18n } from '../../app/i18n.tsx'
import { sessionPermissionMode } from '../../stores/chat-store.ts'
import { restoredMode, useModeLabel } from './plan-review-panel.tsx'

/** 输入区底栏的 Plan chip：当前会话（或草稿）处于 plan 模式时显示；hover 时变为 ×，点击回到进入前的模式。 */
export function PlanChip({ sessionId }: { sessionId: string | null }) {
  const { t } = useI18n()
  const modeLabel = useModeLabel()
  const { setPermissionMode } = useChatActions()
  const conversation = useChat((s) => (sessionId === null ? undefined : s.conversations[sessionId]))
  const draftMode = useChat((s) => s.draftPermissionMode)
  const mode = conversation ? (conversation.pendingMode ?? sessionPermissionMode(conversation.entries)) : sessionId === null ? draftMode : undefined
  if (mode !== 'plan') return null
  const back = conversation ? restoredMode(conversation.entries) : 'default'
  const restore = back === 'plan' ? 'default' : back
  return (
    <button
      type="button"
      data-slot="plan-chip"
      aria-label={`${t('plan.exit')}（${t('plan.exitHint', { mode: modeLabel(restore) })}）`}
      title={t('plan.exitHint', { mode: modeLabel(restore) })}
      className="group inline-flex h-7 shrink-0 items-center gap-1.5 rounded-sm bg-link/12 px-2 text-ui-body font-medium text-link focus-ring [@media(hover:hover)]:hover:bg-link/20"
      onClick={() => void setPermissionMode(restore)}
    >
      <ClipboardListIcon aria-hidden className="size-4 group-hover:hidden group-focus-visible:hidden" />
      <XIcon aria-hidden className="hidden size-4 group-hover:block group-focus-visible:block" />
      {t('plan.chip')}
    </button>
  )
}
