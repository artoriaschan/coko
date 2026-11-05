import * as React from 'react'
import type { ChatStore } from '../stores/chat-store.ts'
import { closePage, getRightPanelLayout, setRightPanelExpanded } from '../features/right-panel/layout-store.ts'

/** 只计入仍可交互的浮层；composer 空的 typeahead 容器不算菜单。 */
function hasOpenLayer() {
  return [
    ...document.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [data-slot="popover-content"]'),
  ].some(
    (layer) =>
      !layer.closest('[inert], [aria-hidden="true"]') &&
      layer.getBoundingClientRect().width > 0 &&
      layer.getBoundingClientRect().height > 0 &&
      getComputedStyle(layer).visibility !== 'hidden',
  )
}

/** 框架内的快捷键沿用当前 Session，窄窗口全屏由 AppFrame 决定。 */
export function useRightPanelCommands({ chat, enabled, toggleFullscreen }: { chat: ChatStore; enabled: boolean; toggleFullscreen: () => void }) {
  const current = React.useRef({ enabled, toggleFullscreen })
  current.current = { enabled, toggleFullscreen }
  React.useEffect(() => {
    let composing = false
    let focusFrame: number | undefined
    const onCompositionStart = () => {
      composing = true
    }
    const onCompositionEnd = () => {
      composing = false
    }
    const focusPanel = (sessionId: string) => {
      const page = getRightPanelLayout(sessionId).active
      if (focusFrame !== undefined) cancelAnimationFrame(focusFrame)
      focusFrame = requestAnimationFrame(() => {
        if (!current.current.enabled || chat.getState().activeSessionId !== sessionId || getRightPanelLayout(sessionId).active !== page || hasOpenLayer())
          return
        const panel = document.querySelector<HTMLElement>('[data-slot="app-frame-right"] [role="tabpanel"]')
        if (panel?.getClientRects().length && !panel.closest('[inert]')) panel.focus()
      })
    }
    const onMenuClose = () => {
      if (composing) return
      // Escape 经过浮层现有的捕获与拒绝规则；无论它是否关闭，命令都不会继续穿透。
      if (hasOpenLayer()) {
        const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true, composed: true })
        // React/Radix 先处理，再在 document 冒泡阶段截住，避免落到窗口级“停止 Run”。
        const stopBehind = (event: KeyboardEvent) => {
          if (event === escape) event.stopPropagation()
        }
        document.addEventListener('keydown', stopBehind)
        try {
          ;(document.activeElement ?? document).dispatchEvent(escape)
        } finally {
          document.removeEventListener('keydown', stopBehind)
        }
        return
      }
      const sessionId = chat.getState().activeSessionId
      const section = document.activeElement?.closest<HTMLElement>('[data-slot="app-frame-right"]')
      if (current.current.enabled && sessionId !== null && section?.getClientRects().length && !section.closest('[inert]')) {
        const layout = getRightPanelLayout(sessionId)
        if (layout.tabs.length === 1 && layout.active === 'start') setRightPanelExpanded(sessionId, false)
        else if (layout.active !== null) closePage(sessionId, layout.active)
        if (getRightPanelLayout(sessionId).expanded) focusPanel(sessionId)
        return
      }
      window.coko?.requestCloseWindow()
    }
    const unsubscribeMenuClose = window.coko?.onMenuClose(onMenuClose)
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        !current.current.enabled ||
        event.defaultPrevented ||
        composing ||
        event.isComposing ||
        event.shiftKey ||
        !(event.metaKey || event.ctrlKey) ||
        !event.altKey
      )
        return
      const sessionId = chat.getState().activeSessionId
      if (sessionId === null || hasOpenLayer()) return
      if (event.code === 'KeyB' || event.key.toLowerCase() === 'b') {
        event.preventDefault()
        const expanded = !getRightPanelLayout(sessionId).expanded
        setRightPanelExpanded(sessionId, expanded)
        if (expanded) focusPanel(sessionId)
      } else if (event.key === 'Enter' && document.activeElement?.closest('[data-slot="app-frame-right"]')) {
        event.preventDefault()
        current.current.toggleFullscreen()
        focusPanel(sessionId)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    document.addEventListener('compositionstart', onCompositionStart, true)
    document.addEventListener('compositionend', onCompositionEnd, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('compositionstart', onCompositionStart, true)
      document.removeEventListener('compositionend', onCompositionEnd, true)
      unsubscribeMenuClose?.()
      if (focusFrame !== undefined) cancelAnimationFrame(focusFrame)
    }
  }, [chat])
}
