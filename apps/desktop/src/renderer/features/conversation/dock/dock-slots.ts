import type * as React from 'react'
import { GoalCard } from './goal-card.tsx'
import { QueueCard } from './queue-card.tsx'
import { TodoCard } from './todo-card.tsx'

/** dock 的卡片 id，按 DOCK_SLOTS 的顺序（Todo → Goal → Queue）显示在输入区上方。 */
export type DockSlotId = 'todo' | 'goal' | 'queue'

export interface DockCardProps {
  sessionId: string
}

export interface DockSlotDefinition {
  id: DockSlotId
  /** 卡片自己决定是否有内容：没有内容时返回 null，不占位。折叠状态由卡片保存在 renderer 内存中，不入记录。 */
  Component: React.ComponentType<DockCardProps>
  /** false：功能尚未交付，不挂载。交付该卡的票只把自己的一行改为 true。 */
  available: boolean
}

export const DOCK_SLOTS: readonly DockSlotDefinition[] = [
  { id: 'todo', Component: TodoCard, available: false },
  { id: 'goal', Component: GoalCard, available: false },
  { id: 'queue', Component: QueueCard, available: false },
]

export const visibleDockSlots = (slots: readonly DockSlotDefinition[] = DOCK_SLOTS) => slots.filter((slot) => slot.available)
