import { PlanModePill } from '@coko/ui'
import * as React from 'react'
import { useChat, useChatActions, useChatStoreApi } from '../../app/chat.tsx'
import { useI18n } from '../../app/i18n.tsx'
import { sessionPermissionMode } from '../../stores/chat-store.ts'
import { restoredMode } from './plan-review-panel.tsx'

/** 输入区底栏的 Plan chip：当前会话（或草稿）处于 plan 模式时显示；hover 时变为 ×，点击回到进入前的模式。 */
export function PlanChip({ sessionId, onExit }: { sessionId: string | null; onExit?: () => void }) {
  const { t } = useI18n()
  const store = useChatStoreApi()
  const [exiting, setExiting] = React.useState(false)
  const { setPermissionMode } = useChatActions()
  const conversation = useChat((s) => (sessionId === null ? undefined : s.conversations[sessionId]))
  const draftMode = useChat((s) => s.draftPermissionMode)
  const mode = conversation ? (conversation.pendingMode ?? sessionPermissionMode(conversation.entries)) : sessionId === null ? draftMode : undefined
  if (mode !== 'plan') return null
  const back = conversation ? restoredMode(conversation.entries) : 'default'
  const restore = back === 'plan' ? 'default' : back
  return (
    <PlanModePill
      label={t('plan.chip')}
      closeLabel={t('plan.exit')}
      disabled={exiting}
      onClose={async () => {
        setExiting(true)
        try {
          await setPermissionMode(restore)
          const current = sessionId === null ? undefined : store.getState().conversations[sessionId]
          if ((current ? (current.pendingMode ?? sessionPermissionMode(current.entries)) : store.getState().draftPermissionMode) !== 'plan') onExit?.()
        } finally {
          setExiting(false)
        }
      }}
    />
  )
}
