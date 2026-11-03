import * as React from 'react'

/** Stable mounted content changes its real flow geometry; the owning reader observes the same frames. */
export function useFlowBox(
  ref: React.RefObject<HTMLDivElement | null>,
  hidden: boolean,
  layoutKey?: unknown,
  { seatGap = false, scrollable = false }: { seatGap?: boolean; scrollable?: boolean } = {},
): boolean {
  const [displayHidden, setDisplayHidden] = React.useState(hidden)
  const previous = React.useRef({ hidden, layoutKey, height: 0, marginTop: 0, marginBottom: 0, opacity: 1 })
  const active = React.useRef(false)
  React.useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const measure = () => {
      if (active.current) return
      previous.current.height = element.getBoundingClientRect().height
      previous.current.marginTop = Number.parseFloat(getComputedStyle(element).marginTop) || 0
      previous.current.marginBottom = Number.parseFloat(getComputedStyle(element).marginBottom) || 0
      previous.current.opacity = Number.parseFloat(getComputedStyle(element).opacity)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    measure()
    return () => observer.disconnect()
  }, [ref])
  React.useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    if (!hidden && displayHidden) {
      setDisplayHidden(false)
      return
    }
    const before = previous.current
    const changed = before.hidden !== hidden || before.layoutKey !== layoutKey
    const from = displayHidden ? 0 : before.height
    const marginTop = Number.parseFloat(getComputedStyle(element).marginTop) || 0
    const target = hidden ? 0 : element.getBoundingClientRect().height
    const fromMargin = before.hidden ? 0 : before.marginTop
    previous.current = { hidden, layoutKey, height: target, marginTop: hidden ? 0 : marginTop, marginBottom: 0, opacity: hidden ? 0 : 1 }
    if (!changed || (hidden && displayHidden)) return
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced || (from === 0 && target === 0) || element.parentElement?.closest('[hidden]')) {
      element.hidden = hidden
      setDisplayHidden(hidden)
      element.dispatchEvent(new Event('coko-flow-layout', { bubbles: true }))
      return
    }
    const overflow = element.style.overflow
    const maxHeight = element.style.maxHeight
    element.style.overflow = scrollable ? 'hidden' : 'clip'
    element.style.maxHeight = 'none'
    element.dataset.flowMotion = hidden ? 'collapse' : 'reveal'
    active.current = true
    const closing = hidden
    const opening = before.hidden && from === 0
    const ending = { height: `${target}px`, marginTop: `${hidden ? 0 : marginTop}px`, marginBottom: `${hidden && seatGap ? -4 : 0}px`, opacity: hidden ? 0 : 1 }
    const animation = element.animate(
      [
        {
          height: `${from}px`,
          marginTop: `${fromMargin}px`,
          marginBottom: `${opening && seatGap ? -4 : before.marginBottom}px`,
          opacity: opening ? 0 : before.opacity,
        },
        ...(closing
          ? [
              { height: `${from}px`, marginTop: `${fromMargin}px`, marginBottom: '0px', offset: 50 / 160, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' },
              { opacity: 0, offset: 70 / 160 },
            ]
          : []),
        ending,
      ],
      { duration: 160, easing: closing ? 'linear' : 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'both' },
    )
    const restore = () => {
      active.current = false
      element.style.overflow = overflow
      element.style.maxHeight = maxHeight
      delete element.dataset.flowMotion
    }
    animation.onfinish = () => {
      // Commit hidden and final geometry together, before the reader receives the final resize.
      element.hidden = hidden
      setDisplayHidden(hidden)
      animation.cancel()
      restore()
      previous.current.height = element.getBoundingClientRect().height
      element.dispatchEvent(new Event('coko-flow-layout', { bubbles: true }))
    }
    return () => {
      if (active.current) {
        previous.current.height = element.getBoundingClientRect().height
        previous.current.marginTop = Number.parseFloat(getComputedStyle(element).marginTop) || 0
        previous.current.marginBottom = Number.parseFloat(getComputedStyle(element).marginBottom) || 0
        previous.current.opacity = Number.parseFloat(getComputedStyle(element).opacity)
      }
      animation.onfinish = null
      animation.cancel()
      restore()
    }
  }, [ref, hidden, displayHidden, layoutKey, seatGap, scrollable])
  return displayHidden
}
