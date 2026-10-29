import * as React from 'react'
import { cn } from '../lib/utils.ts'

export type ContextRingLevel = 'normal' | 'warning' | 'critical'

export interface ContextRingProps extends Omit<React.ComponentProps<'button'>, 'children'> {
  /** 0–100；undefined 时只画轨道（没有窗口或尚未取得用量）。 */
  percent: number | undefined
  /** warning：越过预警线（warning 色）；critical：达到自动压缩阈值（destructive 色）。 */
  level: ContextRingLevel
  /** 已本地化的无障碍名称（例如"上下文已使用 42%"）。 */
  label: string
}

const SIZE = 16
const STROKE = 2
const RADIUS = (SIZE - STROKE) / 2
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

const LEVEL_CLASS: Record<ContextRingLevel, string> = {
  normal: 'text-muted-foreground',
  warning: 'text-warning',
  critical: 'text-destructive',
}

/**
 * 上下文用量环：小号环形进度与百分比数字，作为按钮（HoverCard 的触发器）。颜色只由 level 决定；数字使用等宽数字，
 * 宽度随百分比变化很小，不推动相邻控件。
 */
function ContextRing({ percent, level, label, className, ...props }: ContextRingProps) {
  const value = percent === undefined ? 0 : Math.max(0, Math.min(100, percent))
  return (
    <button
      type="button"
      data-slot="context-ring"
      // 作为 Radix 触发器（asChild）时 data-slot 被覆盖；data-context-ring 保持稳定。
      data-context-ring=""
      data-level={level}
      aria-label={label}
      className={cn(
        'inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-ui-small tabular-nums outline-hidden transition-colors focus-visible:focus-ring [@media(hover:hover)]:hover:bg-accent',
        LEVEL_CLASS[level],
        className,
      )}
      {...props}
    >
      <svg aria-hidden width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="shrink-0 -rotate-90">
        <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" stroke="currentColor" strokeOpacity={0.25} strokeWidth={STROKE} />
        <circle
          data-slot="context-ring-value"
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke="currentColor"
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - value / 100)}
        />
      </svg>
      {percent !== undefined && <span aria-hidden>{value}%</span>}
    </button>
  )
}

export { ContextRing }
