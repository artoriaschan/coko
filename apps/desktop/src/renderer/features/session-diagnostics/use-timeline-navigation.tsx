import * as React from 'react'
import { IconButton } from '../../app/icon-button.tsx'
import { CrosshairIcon } from 'lucide-react'
import { useI18n } from '../../app/i18n.tsx'
import type { DiagnosticTarget } from './grouping-model.ts'
import type { DiagnosticTableRevealRequest } from './diagnostic-table.tsx'
import { availableTimeline, clippedRect, elementTarget, locateTimeline, positionOverlay, timelineOverlay } from './timeline-navigation.ts'
import { pickRecord } from './timeline-matching.ts'

let activePicker: (() => void) | undefined
/** Every mount owns cancellation; a later picker cancels the previous one globally. */
export function useTimelineNavigation(sessionId: string | null, targets: ReadonlyMap<string, DiagnosticTarget>, enabled = true) {
  const { t } = useI18n()
  const button = React.useRef<HTMLButtonElement>(null)
  const [picking, setPicking] = React.useState(false)
  const [message, setMessage] = React.useState(false)
  const [revealRequest, setReveal] = React.useState<DiagnosticTableRevealRequest>()
  const locateCleanup = React.useRef<() => void>(() => {})
  const current = React.useRef(targets)
  current.current = targets
  const select = (key: string | null) => {
    locateCleanup.current()
    if (key !== null) {
      const target = current.current.get(key)
      if (target) locateCleanup.current = locateTimeline(sessionId, target)
    }
  }
  React.useEffect(() => () => locateCleanup.current(), [sessionId, enabled])
  React.useEffect(() => {
    if (!picking || !enabled) return
    const timeline = availableTimeline(sessionId)
    if (!timeline) {
      setPicking(false)
      return
    }
    activePicker?.()
    const { root, port } = timeline
    const mask = timelineOverlay('mask'),
      preview = timelineOverlay('highlight')
    preview.dataset.preview = ''
    let frame = 0,
      stopped = false
    const stop = () => {
      if (stopped) return
      stopped = true
      cancelAnimationFrame(frame)
      mask.remove()
      preview.remove()
      for (const type of blocked) document.removeEventListener(type, intercept, true)
      document.removeEventListener('pointermove', move, true)
      document.removeEventListener('wheel', wheel, true)
      document.removeEventListener('keydown', key, true)
      window.removeEventListener('blur', stop)
      if (activePicker === stop) activePicker = undefined
      setPicking(false)
      setMessage(false)
    }
    activePicker = stop
    const inPort = (event: MouseEvent) => {
      const rect = clippedRect(port, port)
      return rect && event.clientX >= rect.left && event.clientX < rect.right && event.clientY >= rect.top && event.clientY < rect.bottom
    }
    const beneath = (event: MouseEvent) => document.elementsFromPoint(event.clientX, event.clientY).find((element) => element !== mask && element !== preview)
    const identities = (event: MouseEvent) => {
      const element = beneath(event)
      if (!element || !root.contains(element)) return []
      const result: HTMLElement[] = []
      for (let node: Element | null = element; node && root.contains(node); node = node.parentElement)
        if (node instanceof HTMLElement && node.matches('[data-timeline-identity], [data-process-group-id], [data-slot="run-process-control"]'))
          result.push(node)
      return result
    }
    let hovered: HTMLElement | undefined
    const move = (event: Event) => {
      if (!(event instanceof MouseEvent)) return
      hovered = inPort(event) ? identities(event)[0] : undefined
      positionOverlay(preview, hovered ? clippedRect(hovered, port) : undefined)
    }
    const intercept = (event: Event) => {
      if (!(event instanceof MouseEvent) || !inPort(event)) return
      event.preventDefault()
      event.stopImmediatePropagation()
      if (event.type !== 'click') return
      for (const element of identities(event)) {
        const found = pickRecord(elementTarget(element), current.current)
        if (found !== undefined) {
          setReveal({ key: found, nonce: {}, select: true })
          stop()
          return
        }
      }
      setMessage(true)
    }
    const blocked = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'auxclick', 'dblclick', 'contextmenu']
    const routed = new WeakSet<Event>()
    const wheel = (event: WheelEvent) => {
      if (routed.has(event) || !inPort(event)) return
      event.preventDefault()
      event.stopImmediatePropagation()
      let remainingX = event.deltaX,
        remainingY = event.deltaY
      const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? port.clientHeight : 1
      remainingX *= unit
      remainingY *= unit
      const target = beneath(event)
      for (let node = target instanceof HTMLElement ? target : target?.parentElement; node; node = node.parentElement) {
        if (node !== port && !root.contains(node)) continue
        if (node === port || /(auto|scroll)/.test(getComputedStyle(node).overflow + getComputedStyle(node).overflowY)) {
          const forwarded = new WheelEvent('wheel', { deltaY: remainingY, deltaX: remainingX, bubbles: false })
          routed.add(forwarded)
          node.dispatchEvent(forwarded)
          const x = node.scrollLeft,
            y = node.scrollTop
          node.scrollLeft += remainingX
          node.scrollTop += remainingY
          remainingX -= node.scrollLeft - x
          remainingY -= node.scrollTop - y
          node.dispatchEvent(new Event('scroll'))
        }
        if (node === port) break
      }
    }
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopImmediatePropagation()
        stop()
      }
    }
    for (const type of blocked) document.addEventListener(type, intercept, true)
    document.addEventListener('pointermove', move, true)
    document.addEventListener('wheel', wheel, { capture: true, passive: false })
    document.addEventListener('keydown', key, true)
    window.addEventListener('blur', stop)
    const track = () => {
      if (!availableTimeline(sessionId) || !enabled || !button.current?.isConnected || button.current.closest('[hidden], [inert]')) {
        stop()
        return
      }
      positionOverlay(mask, clippedRect(port, port))
      positionOverlay(preview, hovered?.isConnected ? clippedRect(hovered, port) : undefined)
      frame = requestAnimationFrame(track)
    }
    track()
    return stop
  }, [picking, enabled, sessionId])
  return {
    revealRequest,
    select,
    locate: (target: DiagnosticTarget | undefined) => {
      locateCleanup.current()
      if (target) locateCleanup.current = locateTimeline(sessionId, target)
    },
    picker: (
      <>
        <IconButton
          ref={button}
          variant="ghost"
          size="icon-sm"
          tooltipSide="bottom"
          label={t('diagnostics.pick')}
          aria-pressed={picking}
          onClick={() => {
            setMessage(false)
            setPicking((value) => !value)
          }}
        >
          <CrosshairIcon aria-hidden />
        </IconButton>
        {message && (
          <span role="status" className="text-ui-caption text-muted-foreground">
            {t('diagnostics.noPickMatch')}
          </span>
        )}
      </>
    ),
  }
}
