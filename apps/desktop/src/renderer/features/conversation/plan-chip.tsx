import { planPhaseOf } from '@coko/agent/entries'
import { PlanModePill } from '@coko/ui'
import * as React from 'react'
import { useChat, useChatActions } from '../../app/chat.tsx'
import { useI18n } from '../../app/i18n.tsx'

/**
 * 输入区底栏的 Plan chip：会话的计划阶段（由条目派生，ADR 0028）为规划中时显示“计划”，执行中时显示“执行中”（样式相同）；hover 时变为 ×，
 * 点击调用计划接口的退出动作（不改变 Permission Mode）：规划中为退出规划，执行中为放弃计划（不弹确认）。
 * 等待响应期间禁用；失败时保留显示并经失败通道提示；成功后 chip 随 plan_phase 条目消失。草稿不显示。
 */
export function PlanChip({ sessionId, onExit }: { sessionId: string | null; onExit?: () => void }) {
  const { t } = useI18n()
  const [exiting, setExiting] = React.useState(false)
  const { exitPlan } = useChatActions()
  const phase = useChat((s) => {
    const conversation = sessionId === null ? undefined : s.conversations[sessionId]
    return conversation === undefined ? 'none' : planPhaseOf(conversation.entries).phase
  })
  if (phase === 'none' || sessionId === null) return null
  return (
    <PlanModePill
      label={t(phase === 'executing' ? 'plan.chipExecuting' : 'plan.chip')}
      closeLabel={t(phase === 'executing' ? 'plan.abandon' : 'plan.exit')}
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
