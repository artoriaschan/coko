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
  portHeight: number
}

/** One scrollport owns its follow intent and visible content; nested ports never share it. */
export function useReadingScroll(
  sessionId: string | null | undefined,
  revision: unknown,
  {
    enabled = true,
    initialFollow = true,
    tolerance = 32,
    focusTarget,
  }: { enabled?: boolean; initialFollow?: boolean; tolerance?: number; focusTarget?: HTMLElement | null } = {},
) {
  const targetRef = React.useRef(focusTarget)
  targetRef.current = focusTarget
  const [element, ref] = React.useState<HTMLDivElement | null>(null)
  const [state, setState] = React.useState({ following: initialFollow, up: false, down: false })
  const control = React.useRef<{ sync: () => void; bottom: () => void; top: () => void } | null>(null)
  React.useLayoutEffect(() => {
    if (!element || !enabled) return
    let revealing = false
    let following = initialFollow
    let writtenTop = element.scrollTop
    let sampledHeight = element.clientHeight
    let sampledContent = element.scrollHeight
    let pendingGesture = false
    let protectFocus = targetRef.current !== undefined && targetRef.current !== null
    let touchY: number | undefined
    let anchors: Anchor[] = []
    let focusPosition: { target: HTMLElement; group: HTMLElement; top: number } | undefined
    const originalAnchoring = element.style.overflowAnchor
    element.style.overflowAnchor = 'none'
    const visible = (row: HTMLElement) => row.isConnected && row.closest('[hidden]') === null && row.getBoundingClientRect().height > 0
    const captureFocus = () => {
      const target = document.activeElement
      if (!(target instanceof HTMLElement) || !element.contains(target)) return
      const group = target.closest<HTMLElement>('[data-slot="process-group-body"]')
      if (!group || group === element || (!group.hasAttribute('data-running') && !group.hasAttribute('data-flow-motion'))) return
      const viewport = element.getBoundingClientRect()
      const rect = target.getBoundingClientRect()
      if (rect.bottom <= viewport.top || rect.top >= viewport.bottom) return
      if (group.hasAttribute('data-running') || focusPosition?.target !== target) focusPosition = { target, group, top: rect.top - viewport.top }
    }
    const capture = () => {
      const viewport = element.getBoundingClientRect()
      const rows = [...element.querySelectorAll<HTMLElement>(ANCHORS)].filter(
        (row) => visible(row) && row.getBoundingClientRect().bottom > viewport.top && row.getBoundingClientRect().top < viewport.bottom,
      )
      const target = protectFocus ? targetRef.current?.closest<HTMLElement>(ANCHORS) : null
      if (target && element.contains(target) && visible(target) && !rows.includes(target)) rows.push(target)
      anchors = rows.map((row) => {
        const group = row.closest<HTMLElement>('[data-slot="process-group-body"]')
        return {
          element: row,
          top: row.getBoundingClientRect().top - viewport.top,
          group: group === element ? null : group,
          innerTop: group ? row.getBoundingClientRect().top - group.getBoundingClientRect().top : 0,
          portHeight: element.clientHeight,
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
      captureFocus()
    }
    const sync = () => {
      if (revealing) {
        publish()
        return
      }
      const floor = Math.max(0, element.scrollHeight - element.clientHeight)
      if (pendingGesture && Math.abs(element.scrollTop - Math.min(writtenTop, floor)) > 0.5) {
        following = floor - element.scrollTop <= tolerance
        pendingGesture = false
        capture()
      }
      const heldFocus =
        focusPosition &&
        !focusPosition.group.hasAttribute('data-running') &&
        visible(focusPosition.target) &&
        (focusPosition.group.contains(document.activeElement) || focusPosition.group.closest('[data-reading-focus-locked]') !== null)
      if (heldFocus && focusPosition) {
        following = false
        element.scrollTop += focusPosition.target.getBoundingClientRect().top - element.getBoundingClientRect().top - focusPosition.top
      } else if (following) element.scrollTop = element.scrollHeight
      else {
        const focus = protectFocus ? anchors.find((item) => targetRef.current && item.element.contains(targetRef.current) && visible(item.element)) : undefined
        const shrinking = focus !== undefined && element.clientHeight < focus.portHeight - 0.5
        const anchor = shrinking ? focus : anchors.find((item) => visible(item.element))
        if (anchor) {
          // New earlier members inside a capped group first consume that group's actual range.
          const { group, element: row } = anchor
          if (group && group.contains(row) && group.closest('[hidden]') === null && !group.hasAttribute('data-reading-focus-held')) {
            group.scrollTop += row.getBoundingClientRect().top - group.getBoundingClientRect().top - anchor.innerTop
          }
          const target = shrinking ? targetRef.current : undefined
          const inset = target ? target.getBoundingClientRect().top - row.getBoundingClientRect().top : 0
          const top = target
            ? Math.min(Math.max(anchor.top, -inset), element.clientHeight - Math.min(target.getBoundingClientRect().height, element.clientHeight) - inset)
            : anchor.top
          element.scrollTop += row.getBoundingClientRect().top - element.getBoundingClientRect().top - top
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
        focusPosition = undefined
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
      focusPosition = undefined
      for (let inner = target instanceof HTMLElement ? target : target?.parentElement; inner && inner !== element; inner = inner.parentElement) {
        if (!['auto', 'scroll'].includes(getComputedStyle(inner).overflowY) || inner.scrollHeight <= inner.clientHeight + 1) continue
        if (!(event instanceof WheelEvent) || (event.deltaY < 0 ? inner.scrollTop > 0 : inner.scrollTop + inner.clientHeight < inner.scrollHeight - 1)) return
      }
      const editing = target?.closest('button, [role="button"], input, textarea, [contenteditable="true"]')
      if (event instanceof KeyboardEvent && editing && event.key === ' ') return
      if (event.type !== 'touchstart') protectFocus = false
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
    const focus = (event: FocusEvent) => {
      protectFocus = true
      if (focusPosition?.target !== event.target) focusPosition = undefined
      capture()
      captureFocus()
    }
    const reveal = (event: Event) => {
      revealing = (event as CustomEvent<boolean>).detail
      following = false
      protectFocus = false
      focusPosition = undefined
      anchors = []
      pendingGesture = false
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
    element.addEventListener('coko-reveal-reading', reveal)
    element.addEventListener('focusin', focus)
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
        focusPosition = undefined
        anchors = []
        sync()
      },
      top: () => {
        protectFocus = false
        focusPosition = undefined
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
      element.removeEventListener('coko-reveal-reading', reveal)
      element.removeEventListener('focusin', focus)
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
