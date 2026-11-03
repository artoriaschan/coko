import * as React from 'react'
import { cn } from '../lib/utils.ts'
import './fading-title.css'

/** 悬停自动滚动的速度（px/s）：慢到便于阅读，完整滚到最右后停止。 */
const AUTO_SCROLL_SPEED = 40

export interface FadingTitleHandle {
  /** 由所在行的键盘入口转交方向键，不引入嵌套可聚焦元素。 */
  handleKeyDown(event: React.KeyboardEvent): void
}

/** 单行标题的用户可控滚动；只遮罩文字，不包含行尾操作。 */
export function FadingTitle({
  children,
  className,
  ref,
  autoScroll = false,
}: {
  children: string
  className?: string
  ref?: React.Ref<FadingTitleHandle>
  /** 行悬停时从最左缓慢滚到最右并停止；离开后停止并回到最左。 */
  autoScroll?: boolean
}) {
  const root = React.useRef<HTMLSpanElement>(null)
  const content = React.useRef<HTMLSpanElement>(null)
  const [fade, setFade] = React.useState<'none' | 'left' | 'right' | 'both'>('none')
  const offset = React.useRef(0)
  const max = React.useRef(0)
  const animation = React.useRef<Animation | null>(null)
  /** 当前自动动画的起始偏移，用于中途接管时还原实际位置。 */
  const autoFrom = React.useRef(0)
  /** 用户滚轮、拖动或键盘接管后，本次悬停不再启动自动滚动。 */
  const paused = React.useRef(false)
  const drag = React.useRef<{ id: number; x: number; offset: number } | null>(null)
  const dragged = React.useRef(false)

  /** 把文本偏移固定到 value，并更新渐隐方向与供测试/调试读取的数据属性。 */
  const write = React.useCallback((value: number) => {
    const next = Math.max(0, Math.min(max.current, value))
    offset.current = next
    const inner = content.current
    if (inner) inner.style.transform = next === 0 ? '' : `translate3d(${-next}px, 0, 0)`
    const element = root.current
    if (!element) return
    element.dataset.offset = String(Math.round(next))
    const left = next > 1
    const right = next < max.current - 1
    setFade(max.current <= 1 ? 'none' : left && right ? 'both' : left ? 'left' : 'right')
  }, [])

  const measure = React.useCallback(() => {
    const element = root.current
    const inner = content.current
    if (!element || !inner) return
    max.current = Math.max(0, inner.scrollWidth - element.clientWidth)
    element.dataset.max = String(Math.round(max.current))
    write(offset.current)
  }, [write])

  /** 取消自动动画并停在当前进度，交给手动交互继续。 */
  const stopAuto = React.useCallback(() => {
    const current = animation.current
    if (!current) return
    const progress = current.effect?.getComputedTiming().progress
    const from = autoFrom.current
    animation.current = null
    current.cancel()
    write(typeof progress === 'number' ? from + progress * (max.current - from) : max.current)
  }, [write])

  const startAuto = React.useCallback(
    (from: number) => {
      const inner = content.current
      const remaining = max.current - from
      if (!inner || remaining <= 1) return
      autoFrom.current = from
      const running = inner.animate([{ transform: `translate3d(${-from}px, 0, 0)` }, { transform: `translate3d(${-max.current}px, 0, 0)` }], {
        duration: (remaining / AUTO_SCROLL_SPEED) * 1000,
        easing: 'linear',
        fill: 'forwards',
      })
      animation.current = running
      let frame = 0
      const tick = () => {
        const progress = running.effect?.getComputedTiming().progress
        if (typeof progress === 'number') {
          const value = from + progress * remaining
          offset.current = value
          const element = root.current
          if (element) {
            element.dataset.offset = String(Math.round(value))
            const left = value > 1
            const right = value < max.current - 1
            setFade(max.current <= 1 ? 'none' : left && right ? 'both' : left ? 'left' : 'right')
          }
        }
        if (running.playState === 'running') frame = requestAnimationFrame(tick)
      }
      frame = requestAnimationFrame(tick)
      running.addEventListener('cancel', () => cancelAnimationFrame(frame))
      running.addEventListener('finish', () => {
        cancelAnimationFrame(frame)
        animation.current = null
        // 结束的动画仍会保留 forwards 填充；取消后用内联位移固定终点，离开悬停时才能归零。
        running.cancel()
        write(max.current)
      })
    },
    [write],
  )

  React.useEffect(() => {
    const inner = content.current
    if (!inner) return
    if (!autoScroll) {
      paused.current = false
      stopAuto()
      write(0)
      return
    }
    paused.current = false
    // 手动滚动过的位置继续向前，不从最左重新开始。
    startAuto(offset.current)
    return () => {
      animation.current?.cancel()
      animation.current = null
    }
  }, [autoScroll, stopAuto, startAuto, write, children])

  React.useLayoutEffect(() => {
    const element = root.current!
    const inner = content.current!
    measure()
    const resize = new ResizeObserver(() => {
      const wasAuto = autoScroll && !paused.current && animation.current !== null
      // 先按旧终点固定当前进度，再用新宽度重新计算并继续。
      if (wasAuto) stopAuto()
      measure()
      if (wasAuto) startAuto(offset.current)
    })
    resize.observe(element)
    resize.observe(inner)
    const wheel = (event: WheelEvent) => {
      paused.current = true
      stopAuto()
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
      const step = event.deltaMode === 1 ? delta * 20 : event.deltaMode === 2 ? delta * element.clientWidth : delta
      const before = offset.current
      write(before + step)
      if (offset.current !== before) event.preventDefault()
    }
    element.addEventListener('wheel', wheel, { passive: false })
    return () => {
      resize.disconnect()
      element.removeEventListener('wheel', wheel)
    }
  }, [measure, autoScroll, startAuto, stopAuto, write])

  React.useImperativeHandle(
    ref,
    () => ({
      handleKeyDown(event) {
        if (max.current <= 1) return
        const next =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? max.current
              : event.key === 'ArrowLeft'
                ? offset.current - 48
                : event.key === 'ArrowRight'
                  ? offset.current + 48
                  : null
        if (next === null) return
        event.preventDefault()
        paused.current = true
        stopAuto()
        write(next)
      },
    }),
    [stopAuto, write],
  )

  return (
    <span
      ref={root}
      data-user-content
      data-scrollable-title
      data-fade={fade}
      className={cn('fading-title block min-w-0 flex-1 overflow-hidden whitespace-nowrap select-none', className)}
      onPointerDown={(event) => {
        dragged.current = false
        if (event.button !== 0 || event.pointerType === 'touch' || max.current <= 1) return
        event.preventDefault()
        paused.current = true
        stopAuto()
        drag.current = { id: event.pointerId, x: event.clientX, offset: offset.current }
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={(event) => {
        const current = drag.current
        if (!current || current.id !== event.pointerId) return
        if (Math.abs(current.x - event.clientX) > 3) dragged.current = true
        write(current.offset + current.x - event.clientX)
      }}
      onPointerUp={() => {
        drag.current = null
      }}
      onPointerCancel={() => {
        drag.current = null
        dragged.current = false
      }}
      onClickCapture={(event) => {
        if (dragged.current) {
          event.preventDefault()
          event.stopPropagation()
          dragged.current = false
        }
      }}
    >
      <span ref={content} className="inline-block whitespace-nowrap">
        {children}
      </span>
    </span>
  )
}
