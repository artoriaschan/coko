import { mainTimelineRoot, revealTimeline } from '../conversation/timeline-reveal.tsx'
import type { DiagnosticTarget } from './grouping-model.ts'
import { diagnosticMotion } from './diagnostic-motion.ts'
import { locateCandidate } from './timeline-matching.ts'

const IDENTITIES = '[data-timeline-identity], [data-process-group-id]'
export function elementTarget(element: HTMLElement): DiagnosticTarget {
  const seq = element.dataset.entrySeq
  return {
    ...(element.dataset.timelineIdentity === undefined ? {} : { identity: element.dataset.timelineIdentity }),
    ...(element.dataset.processGroupId === undefined ? {} : { groupId: element.dataset.processGroupId }),
    ...(element.dataset.runId === undefined ? {} : { runId: element.dataset.runId }),
    ...(seq === undefined ? {} : { seq: Number(seq) }),
    ...(element.dataset.toolCallId === undefined ? {} : { toolCallId: element.dataset.toolCallId }),
  }
}
export function timelinePort(root: HTMLElement) {
  return root.closest<HTMLElement>('[data-main-timeline-session]')
}
export function availableTimeline(sessionId: string | null) {
  if (sessionId === null) return undefined
  const root =
    mainTimelineRoot(sessionId) ??
    [...document.querySelectorAll<HTMLElement>('[data-main-timeline-session]')].find((port) => port.dataset.mainTimelineSession === sessionId)
  if (!root?.isConnected || root.closest('[hidden], [inert]')) return undefined
  const port = timelinePort(root)
  if (!port || port.getBoundingClientRect().width <= 0 || port.getBoundingClientRect().height <= 0) return undefined
  const rect = port.getBoundingClientRect()
  const top = document
    .elementsFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
    .find((node) => !node.matches('[data-slot="timeline-mask"], [data-slot="timeline-highlight"]'))
  return top && port.contains(top) ? { root, port } : undefined
}
/** Clip body-layer paint through every nested scrollport and the actual message viewport. */
export function clippedRect(element: HTMLElement, port: HTMLElement): DOMRect | undefined {
  let { top, right, bottom, left } = element.getBoundingClientRect()
  top = Math.max(0, top)
  left = Math.max(0, left)
  right = Math.min(window.innerWidth, right)
  bottom = Math.min(window.innerHeight, bottom)
  for (let parent: HTMLElement | null = element === port ? port : element.parentElement; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent)
    if (parent === port || /(auto|scroll|hidden|clip)/.test(style.overflow + style.overflowX + style.overflowY)) {
      const rect = parent.getBoundingClientRect()
      top = Math.max(top, rect.top)
      left = Math.max(left, rect.left)
      right = Math.min(right, rect.right)
      bottom = Math.min(bottom, rect.bottom)
    }
    if (parent === port) break
  }
  return bottom > top && right > left ? new DOMRect(left, top, right - left, bottom - top) : undefined
}
export function positionOverlay(overlay: HTMLElement, rect: DOMRect | undefined) {
  overlay.hidden = !rect
  if (rect) Object.assign(overlay.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` })
}
export function timelineOverlay(kind: 'highlight' | 'mask') {
  const node = document.createElement('div')
  node.dataset.slot = `timeline-${kind}`
  node.className = `diagnostic-timeline-${kind} diagnostic-motion`
  node.setAttribute('aria-hidden', 'true')
  document.body.append(node)
  return node
}
function portsFor(element: HTMLElement, port: HTMLElement) {
  const ports: HTMLElement[] = []
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    if (parent === port || ['auto', 'scroll'].includes(getComputedStyle(parent).overflowY)) ports.push(parent)
    if (parent === port) break
  }
  return ports
}
/** A cancellable request owns its listeners, animation frame and body paint. */
export function locateTimeline(sessionId: string | null, target: DiagnosticTarget) {
  const timeline = availableTimeline(sessionId)
  if (!timeline || sessionId === null) return () => {}
  const { root, port } = timeline
  let candidates = [...root.querySelectorAll<HTMLElement>(IDENTITIES)].map((element) => ({ ...elementTarget(element), element }))
  let candidate = locateCandidate(target, candidates)
  let element = candidate?.element ?? port
  let frame = 0,
    timer = 0,
    animation: Animation | undefined,
    paint: HTMLElement | undefined
  let disposed = false,
    previous = '',
    stable = 0,
    scrolled = false
  const held = new Set<HTMLElement>()
  const hold = () => {
    for (const scroll of element === port ? [port] : portsFor(element, port)) {
      held.add(scroll)
      scroll.dispatchEvent(new CustomEvent('coko-reveal-reading', { detail: true }))
    }
  }
  const release = () => {
    for (const scroll of held) scroll.dispatchEvent(new CustomEvent('coko-reveal-reading', { detail: false }))
    held.clear()
  }
  const cleanup = () => {
    disposed = true
    cancelAnimationFrame(frame)
    window.clearTimeout(timer)
    animation?.cancel()
    paint?.remove()
    release()
    window.removeEventListener('blur', cleanup)
  }
  window.addEventListener('blur', cleanup)
  const openCandidate = () => {
    if (!candidate) return
    hold()
    const groupId = element.closest<HTMLElement>('[data-process-group-id]')?.dataset.processGroupId
    revealTimeline(sessionId, { ...candidate, ...(groupId ? { groupId } : {}) })
    for (let parent: HTMLElement | null = element; parent && parent !== port; parent = parent.parentElement)
      if (parent instanceof HTMLDetailsElement) parent.open = true
    // Open the selected row's own native disclosure, without opening unrelated history.
    if (element instanceof HTMLDetailsElement) element.open = true
    const command = element.querySelector<HTMLDetailsElement>('details[data-slot="command-message"]')
    if (command) command.open = true
  }
  openCandidate()
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const updatePaint = () => {
    if (paint) positionOverlay(paint, clippedRect(element, port))
  }
  const finish = () => {
    release()
    if (reduced) {
      cleanup()
      return
    }
    paint = timelineOverlay('highlight')
    updatePaint()
    const motion = diagnosticMotion(paint)
    animation = paint.animate([{ opacity: 1 }, { opacity: 0 }], motion)
    timer = window.setTimeout(cleanup, motion.duration)
    const track = () => {
      if (!disposed) {
        updatePaint()
        frame = requestAnimationFrame(track)
      }
    }
    frame = requestAnimationFrame(track)
  }
  const settle = () => {
    if (disposed) return
    if (!element.isConnected || !availableTimeline(sessionId)) {
      cleanup()
      return
    }
    const rect = element.getBoundingClientRect()
    const geometry = `${rect.top}:${portsFor(element, port)
      .map((scroll) => scroll.scrollTop)
      .join(':')}`
    stable = geometry === previous ? stable + 1 : 0
    previous = geometry
    let ancestorMotion = false
    for (let node: HTMLElement | null = element; node && node !== port; node = node.parentElement)
      if (node.hasAttribute('data-flow-motion')) ancestorMotion = true
    if (ancestorMotion || element.querySelector('[data-flow-motion]') || stable < 2) {
      frame = requestAnimationFrame(settle)
      return
    }
    // A committed but unpresentable candidate must not hold reading intent forever.
    if (element.closest('[hidden]') || rect.height === 0) {
      release()
      candidates = candidates.filter((row) => row.element !== element)
      candidate = locateCandidate(target, candidates)
      element = candidate?.element ?? port
      previous = ''
      stable = 0
      scrolled = false
      openCandidate()
      frame = requestAnimationFrame(settle)
      return
    }
    if (!scrolled && candidate) {
      hold()
      let moved = false
      for (const scroll of portsFor(element, port)) {
        const row = element.getBoundingClientRect(),
          viewport = scroll.getBoundingClientRect()
        const height = Math.min(row.height, viewport.height)
        const delta = row.top < viewport.top ? row.top - viewport.top : row.top + height > viewport.bottom ? row.top + height - viewport.bottom : 0
        const destination = Math.max(0, Math.min(scroll.scrollHeight - scroll.clientHeight, scroll.scrollTop + delta))
        if (Math.abs(destination - scroll.scrollTop) > 1) {
          scroll.scrollTo({ top: destination, behavior: reduced ? 'instant' : 'smooth' })
          moved = true
          break
        }
      }
      if (moved) {
        stable = 0
        frame = requestAnimationFrame(settle)
        return
      }
      scrolled = true
    }
    finish()
  }
  frame = requestAnimationFrame(settle)
  return cleanup
}
