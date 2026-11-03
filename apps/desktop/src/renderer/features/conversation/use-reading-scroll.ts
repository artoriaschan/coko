import * as React from 'react'

const ANCHORS =
  '[data-reading-anchor], [data-slot="tool-card"], .conversation-reasoning, [data-slot="process-timeline"] > :not([data-slot="process-seat"]):not([data-slot="run-process-control"]):not([role="status"])'
const RESET_READING = 'coko-reset-reading'
const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '])
interface Anchor {
  element: HTMLElement
  top: number
  group: HTMLElement | null
  innerTop: number
}

/** One scrollport owns its follow intent and visible content; nested ports never share it. */
export function useReadingScroll(
  sessionId: string | null | undefined,
  revision: unknown,
  { enabled = true, initialFollow = true, tolerance = 32 }: { enabled?: boolean; initialFollow?: boolean; tolerance?: number } = {},
) {
  const [element, ref] = React.useState<HTMLDivElement | null>(null)
  const [state, setState] = React.useState({ following: initialFollow, up: false, down: false })
  const control = React.useRef<{ sync: () => void; bottom: () => void; top: () => void } | null>(null)
  React.useLayoutEffect(() => {
    if (!element || !enabled) return
    let following = initialFollow
    let writtenTop = element.scrollTop
    let sampledHeight = element.clientHeight
    let sampledContent = element.scrollHeight
    let pendingGesture = false
    let touchY: number | undefined
    let anchors: Anchor[] = []
    const originalAnchoring = element.style.overflowAnchor
    element.style.overflowAnchor = 'none'
    const visible = (row: HTMLElement) => row.isConnected && row.closest('[hidden]') === null && row.getBoundingClientRect().height > 0
    const capture = () => {
      const viewport = element.getBoundingClientRect()
      anchors = [...element.querySelectorAll<HTMLElement>(ANCHORS)]
        .filter((row) => visible(row) && row.getBoundingClientRect().bottom > viewport.top && row.getBoundingClientRect().top < viewport.bottom)
        .map((row) => {
          const group = row.closest<HTMLElement>('[data-slot="process-group-body"]')
          return {
            element: row,
            top: row.getBoundingClientRect().top - viewport.top,
            group: group === element ? null : group,
            innerTop: group ? row.getBoundingClientRect().top - group.getBoundingClientRect().top : 0,
          }
        })
    }
    const publish = (retain = false) => {
      writtenTop = element.scrollTop
      sampledHeight = element.clientHeight
      sampledContent = element.scrollHeight
      const up = writtenTop > 1
      const down = writtenTop + element.clientHeight < element.scrollHeight - 1
      setState((old) => (old.following === following && old.up === up && old.down === down ? old : { following, up, down }))
      if (!retain || following || anchors.length === 0) capture()
    }
    const sync = () => {
      const floor = Math.max(0, element.scrollHeight - element.clientHeight)
      if (pendingGesture && Math.abs(element.scrollTop - Math.min(writtenTop, floor)) > 0.5) {
        following = floor - element.scrollTop <= tolerance
        pendingGesture = false
        capture()
      }
      if (following) element.scrollTop = element.scrollHeight
      else {
        const anchor = anchors.find((item) => visible(item.element))
        if (anchor) {
          // New earlier members inside a capped group first consume that group's actual range.
          const { group, element: row } = anchor
          if (group && group.contains(row) && group.closest('[hidden]') === null) {
            group.scrollTop += row.getBoundingClientRect().top - group.getBoundingClientRect().top - anchor.innerTop
          }
          element.scrollTop += row.getBoundingClientRect().top - element.getBoundingClientRect().top - anchor.top
        }
      }
      publish(true)
    }
    const scroll = (event: Event) => {
      if (event.target !== element) return
      // Layout clamps are not reading gestures; our own positions have already been acknowledged.
      const floor = Math.max(0, element.scrollHeight - element.clientHeight)
      const changed = Math.abs(element.scrollTop - writtenTop) > 0.5
      if (!changed) return
      const resized = sampledHeight !== element.clientHeight || sampledContent !== element.scrollHeight
      const folding = element.querySelector('[data-flow-motion]') !== null
      if (changed && ((!resized && !folding) || pendingGesture || !event.isTrusted)) {
        following = floor - element.scrollTop <= tolerance
      } else if (changed) {
        // Native range changes can deliver scroll before ResizeObserver; they retain reading ownership.
        sync()
        return
      }
      pendingGesture = false
      publish()
    }
    const intent = (event: Event) => {
      if (event instanceof KeyboardEvent && (event.defaultPrevented || !SCROLL_KEYS.has(event.key))) return
      if (event instanceof WheelEvent && event.deltaY === 0) return
      const target = event.target instanceof Element ? event.target : null
      for (let inner = target instanceof HTMLElement ? target : target?.parentElement; inner && inner !== element; inner = inner.parentElement) {
        if (!['auto', 'scroll'].includes(getComputedStyle(inner).overflowY) || inner.scrollHeight <= inner.clientHeight + 1) continue
        if (!(event instanceof WheelEvent) || (event.deltaY < 0 ? inner.scrollTop > 0 : inner.scrollTop + inner.clientHeight < inner.scrollHeight - 1)) return
      }
      const editing = target?.closest('button, [role="button"], input, textarea, [contenteditable="true"]')
      if (event instanceof KeyboardEvent && editing && event.key === ' ') return
      const previousTouchY = touchY
      if (event instanceof TouchEvent) touchY = event.touches[0]?.clientY
      const upward =
        event instanceof WheelEvent
          ? event.deltaY < 0
          : event instanceof KeyboardEvent
            ? ['ArrowUp', 'PageUp', 'Home'].includes(event.key) || (event.key === ' ' && event.shiftKey)
            : event.type === 'touchmove' && touchY !== undefined && previousTouchY !== undefined && touchY > previousTouchY
      if (upward) following = false
      pendingGesture = true
      // A gesture cancels a pending old reading position before the browser applies its movement.
      capture()
      publish()
    }
    const reset = (event: Event) => {
      if (event.target instanceof Element) {
        const target = event.target
        anchors = anchors.filter((anchor) => !target.contains(anchor.element))
      }
    }
    const observer = new ResizeObserver(sync)
    const observe = () => {
      observer.disconnect()
      observer.observe(element)
      for (const child of element.children) observer.observe(child)
    }
    const mutations = new MutationObserver(() => {
      observe()
      sync()
    })
    mutations.observe(element, { childList: true, subtree: false })
    observe()
    element.addEventListener('coko-flow-layout', sync)
    element.addEventListener(RESET_READING, reset)
    element.addEventListener('scroll', scroll)
    element.addEventListener('wheel', intent, { passive: true })
    element.addEventListener('touchstart', intent, { passive: true })
    element.addEventListener('touchmove', intent, { passive: true })
    element.addEventListener('keydown', intent)
    control.current = {
      sync,
      bottom: () => {
        element.focus({ preventScroll: true })
        following = true
        anchors = []
        sync()
      },
      top: () => {
        following = false
        anchors = []
        element.dispatchEvent(new Event(RESET_READING, { bubbles: true }))
        element.scrollTop = 0
        publish()
      },
    }
    sync()
    return () => {
      observer.disconnect()
      mutations.disconnect()
      element.removeEventListener('coko-flow-layout', sync)
      element.removeEventListener(RESET_READING, reset)
      element.removeEventListener('scroll', scroll)
      element.removeEventListener('wheel', intent)
      element.removeEventListener('touchstart', intent)
      element.removeEventListener('touchmove', intent)
      element.removeEventListener('keydown', intent)
      element.style.overflowAnchor = originalAnchoring
      control.current = null
    }
  }, [element, sessionId, enabled, initialFollow, tolerance])
  React.useLayoutEffect(() => {
    control.current?.sync()
  }, [revision])
  return { ref, ...state, toBottom: () => control.current?.bottom(), toTop: () => control.current?.top() }
}
