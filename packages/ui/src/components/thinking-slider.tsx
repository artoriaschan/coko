import * as React from 'react'
import { cn } from '../lib/utils.ts'

export type ThinkingSliderValue = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

const motion: Record<ThinkingSliderValue, readonly [number, number]> = {
  off: [0, 0],
  minimal: [3, 4000],
  low: [6, 3000],
  medium: [10, 2200],
  high: [15, 1600],
  xhigh: [21, 1100],
  max: [28, 750],
}

function Particle({ index, duration, playing }: { index: number; duration: number; playing: boolean }) {
  const ref = React.useRef<HTMLSpanElement>(null)
  const animation = React.useRef<Animation | null>(null)
  React.useEffect(() => {
    const instance = ref.current!.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(calc(-1 * var(--local-particle-span)))' }], {
      duration: 4000,
      iterations: Infinity,
      delay: -((index * 0.618034) % 1) * 4000,
    })
    animation.current = instance
    return () => {
      instance.cancel()
      animation.current = null
    }
  }, [index])
  React.useEffect(() => {
    const instance = animation.current
    if (!instance) return
    // updatePlaybackRate 保留当前相位；切档不会把已有光点重置到起点。
    instance.updatePlaybackRate(4000 / duration)
    if (playing) instance.play()
    else instance.pause()
  }, [duration, playing])
  return (
    <span
      ref={ref}
      data-slot="thinking-particle"
      className="absolute left-full size-0.5 rounded-round bg-primary-foreground opacity-60"
      style={{ top: `${22 + ((index * 23) % 56)}%` }}
    />
  )
}

/** 配置的离散档位；拖动时滑块跟手，释放后吸附，键盘只落在有效档位。 */
export function ThinkingSlider({
  levels,
  value,
  labels,
  label,
  active = true,
  onValueChange,
  onValueCommit,
}: {
  levels: readonly ThinkingSliderValue[]
  value: ThinkingSliderValue
  labels: Record<ThinkingSliderValue, string>
  label: string
  active?: boolean
  onValueChange: (value: ThinkingSliderValue) => void
  onValueCommit?: (value: ThinkingSliderValue) => void
}) {
  const root = React.useRef<HTMLDivElement>(null)
  const index = Math.max(0, levels.indexOf(value))
  const [drag, setDrag] = React.useState<number | null>(null)
  const [visible, setVisible] = React.useState(false)
  const [reduced, setReduced] = React.useState(false)
  const [pageVisible, setPageVisible] = React.useState(!document.hidden)
  const [span, setSpan] = React.useState(0)
  const dragging = React.useRef(false)
  const selected = React.useRef(value)
  React.useEffect(() => {
    const element = root.current!
    const observer = new IntersectionObserver(([entry]) => setVisible(entry?.isIntersecting ?? false))
    observer.observe(element)
    const resize = new ResizeObserver(() => setSpan(element.clientWidth))
    resize.observe(element)
    const media = matchMedia('(prefers-reduced-motion: reduce)')
    const updateReduced = () => setReduced(media.matches)
    const updateVisibility = () => setPageVisible(!document.hidden)
    updateReduced()
    media.addEventListener('change', updateReduced)
    document.addEventListener('visibilitychange', updateVisibility)
    return () => {
      observer.disconnect()
      resize.disconnect()
      media.removeEventListener('change', updateReduced)
      document.removeEventListener('visibilitychange', updateVisibility)
    }
  }, [])
  const ratio = drag ?? (levels.length < 2 ? 0 : index / (levels.length - 1))
  const point = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const next = Math.max(0, Math.min(1, (event.clientX - rect.left - 14) / Math.max(1, rect.width - 28)))
    setDrag(next)
    const option = levels[Math.round(next * (levels.length - 1))]
    if (option) selected.current = option
    if (option && option !== value) onValueChange(option)
  }
  const settle = () => {
    if (!dragging.current) return
    dragging.current = false
    setDrag(null)
    onValueCommit?.(selected.current)
  }
  const [count, duration] = motion[value]
  const playing = active && visible && pageVisible && !reduced
  return (
    <div
      ref={root}
      role="slider"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={Math.max(0, levels.length - 1)}
      aria-valuenow={index}
      aria-valuetext={labels[value]}
      aria-disabled={levels.length < 2}
      tabIndex={0}
      data-slot="thinking-slider"
      className="relative h-7 w-full touch-none rounded-round outline-hidden focus-ring select-none"
      onPointerDown={(event) => {
        if (event.button !== 0 || levels.length < 2) return
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        event.currentTarget.focus()
        dragging.current = true
        point(event)
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) point(event)
      }}
      onPointerUp={settle}
      onPointerCancel={settle}
      onLostPointerCapture={settle}
      onKeyDown={(event) => {
        if (levels.length < 2) return
        let next = index
        if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next++
        else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next--
        else if (event.key === 'Home') next = 0
        else if (event.key === 'End') next = levels.length - 1
        else return
        event.preventDefault()
        event.stopPropagation()
        const option = levels[Math.max(0, Math.min(levels.length - 1, next))]
        if (option) {
          onValueChange(option)
          onValueCommit?.(option)
        }
      }}
    >
      <div aria-hidden className="pointer-events-none absolute inset-x-0 inset-y-0.5 overflow-hidden rounded-round bg-accent">
        <div
          data-slot="thinking-fill"
          className={cn(
            'absolute inset-y-0 left-0 overflow-hidden rounded-round bg-link',
            value === 'off' && 'opacity-0',
            drag === null && 'transition-[width] motion-reduce:transition-none',
          )}
          style={{ width: `${span < 28 ? 0 : 14 + (span - 28) * ratio}px`, '--local-particle-span': `${14 + (span - 28) * ratio}px` } as React.CSSProperties}
        >
          {Array.from({ length: count }, (_, i) => (
            <Particle key={i} index={i} duration={duration} playing={playing} />
          ))}
        </div>
      </div>
      <div aria-hidden className="pointer-events-none absolute inset-x-3.5 top-3">
        {levels.map(
          (option, i) =>
            i > index && (
              <span
                key={option}
                data-slot="thinking-tick"
                className="absolute size-1 -translate-x-1/2 rounded-round bg-muted-foreground opacity-35"
                style={{ left: `${(i / (levels.length - 1)) * 100}%` }}
              />
            ),
        )}
      </div>
      <div
        aria-hidden
        data-slot="thinking-thumb"
        className={cn(
          'pointer-events-none absolute top-0 size-7 rounded-round bg-background shadow-panel',
          drag === null && 'transition-[left] motion-reduce:transition-none',
        )}
        style={{ left: `${(span - 28) * ratio}px` }}
      />
    </div>
  )
}
