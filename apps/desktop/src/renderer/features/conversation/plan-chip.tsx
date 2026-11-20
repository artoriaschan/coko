import { planPhaseOf } from '@coko/agent/entries'
import { PlanModePill } from '@coko/ui'
import * as React from 'react'
import { useChat, useChatActions } from '../../app/chat.tsx'
import { useI18n } from '../../app/i18n.tsx'

/**
 * 输入区底栏的 Plan chip：会话的计划阶段（由条目派生，ADR 0028）为规划中时显示；hover 时变为 ×，点击退出规划（不改变 Permission Mode）。
 * 等待响应期间禁用；失败时保留显示并经失败通道提示；成功后 chip 随 plan_phase 条目消失。草稿不显示。
 */
export function PlanChip({ sessionId, onExit }: { sessionId: string | null; onExit?: () => void }) {
  const { t } = useI18n()
  const [exiting, setExiting] = React.useState(false)
  const { exitPlan } = useChatActions()
  const planning = useChat((s) => {
    const conversation = sessionId === null ? undefined : s.conversations[sessionId]
    return conversation !== undefined && planPhaseOf(conversation.entries).phase === 'planning'
  })
  if (!planning || sessionId === null) return null
  return (
    <PlanModePill
      label={t('plan.chip')}
      closeLabel={t('plan.exit')}
      disabled={exiting}
      onClose={async () => {
        setExiting(true)
        try {
          if (await exitPlan(sessionId)) onExit?.()
        } finally {
          setExiting(false)
        }
      }}
    />
  )
}
