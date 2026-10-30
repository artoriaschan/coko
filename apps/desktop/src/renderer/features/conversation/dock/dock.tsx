import { DOCK_SLOTS, visibleDockSlots, type DockSlotDefinition } from './dock-slots.ts'

/**
 * 输入区上方的 dock：按注册表顺序挂载已交付的卡片。没有已交付的卡片时不渲染；卡片都没有内容（返回 null）时容器为空，
 * 由 empty:hidden 隐藏，不留间距。
 */
export function Dock({ sessionId, className, slots = DOCK_SLOTS }: { sessionId: string | null; className?: string; slots?: readonly DockSlotDefinition[] }) {
  const visible = visibleDockSlots(slots)
  if (sessionId === null || visible.length === 0) return null
  return (
    <div data-slot="dock" className={`${className ?? ''} mb-2 flex flex-col gap-2 empty:hidden`}>
      {visible.map(({ id, Component }) => (
        <Component key={id} sessionId={sessionId} />
      ))}
    </div>
  )
}
