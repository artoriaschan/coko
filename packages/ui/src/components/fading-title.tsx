import * as React from 'react'
import { cn } from '../lib/utils.ts'
import './fading-title.css'

export interface FadingTitleHandle {
  /** 由所在行的键盘入口转交方向键，不引入嵌套可聚焦元素。 */
  handleKeyDown(event: React.KeyboardEvent): void
}

/** 单行标题的用户可控滚动；只遮罩文字，不包含行尾操作。 */
export function FadingTitle({ children, className, ref }: { children: string; className?: string; ref?: React.Ref<FadingTitleHandle> }) {
  const root = React.useRef<HTMLSpanElement>(null)
  const [fade, setFade] = React.useState<'none' | 'left' | 'right' | 'both'>('none')
  const drag = React.useRef<{ id: number; x: number; scroll: number } | null>(null)
  const dragged = React.useRef(false)
  const measure = React.useCallback(() => {
    const element = root.current
    if (!element) return
    const max = element.scrollWidth - element.clientWidth
    const left = element.scrollLeft > 1
    const right = element.scrollLeft < max - 1
    setFade(max <= 1 ? 'none' : left && right ? 'both' : left ? 'left' : 'right')
  }, [])
  React.useLayoutEffect(() => {
    const element = root.current!
    measure()
    const resize = new ResizeObserver(measure)
    resize.observe(element)
    const wheel = (event: WheelEvent) => {
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
      const step = event.deltaMode === 1 ? delta * 20 : event.deltaMode === 2 ? delta * element.clientWidth : delta
      const before = element.scrollLeft
      element.scrollLeft += step
      if (element.scrollLeft !== before) event.preventDefault()
      measure()
    }
    element.addEventListener('wheel', wheel, { passive: false })
    return () => {
      resize.disconnect()
      element.removeEventListener('wheel', wheel)
    }
  }, [measure, children])
  React.useImperativeHandle(
    ref,
    () => ({
      handleKeyDown(event) {
        const element = root.current
        if (!element || element.scrollWidth <= element.clientWidth) return
        const next =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? element.scrollWidth
              : event.key === 'ArrowLeft'
                ? element.scrollLeft - 48
                : event.key === 'ArrowRight'
                  ? element.scrollLeft + 48
                  : null
        if (next === null) return
        event.preventDefault()
        element.scrollLeft = next
        measure()
      },
    }),
    [measure],
  )
  return (
    <span
      ref={root}
      data-user-content
      data-scrollable-title
      data-fade={fade}
      className={cn('fading-title block min-w-0 flex-1 overflow-x-auto whitespace-nowrap select-none', className)}
      onScroll={measure}
      onPointerDown={(event) => {
        dragged.current = false
        if (event.button !== 0 || event.pointerType === 'touch' || event.currentTarget.scrollWidth <= event.currentTarget.clientWidth) return
        event.preventDefault()
        drag.current = { id: event.pointerId, x: event.clientX, scroll: event.currentTarget.scrollLeft }
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={(event) => {
        const current = drag.current
        if (!current || current.id !== event.pointerId) return
        if (Math.abs(current.x - event.clientX) > 3) dragged.current = true
        event.currentTarget.scrollLeft = current.scroll + current.x - event.clientX
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
      {children}
    </span>
  )
}
