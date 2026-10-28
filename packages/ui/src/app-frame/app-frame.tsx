import * as React from 'react'
import { cn } from '../lib/utils.ts'
import { clampSidebarWidth, computeFrameLayout, SIDEBAR_DEFAULT_WIDTH, SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH, type FrameLayout } from './frame-layout.ts'

export interface AppFrameLabels {
  sidebar: string
  main: string
  rightPanel: string
  resizeSidebar: string
}

export interface AppFrameProps {
  /** 展开的侧栏内容（宽栏与窄窗口抽屉共用）。 */
  sidebar: React.ReactNode
  /** 收起后的 56px rail 内容；主要操作在此保持可达。 */
  rail: React.ReactNode
  children: React.ReactNode
  rightPanel?: React.ReactNode
  rightOpen?: boolean
  sidebarWidth?: number
  onSidebarWidthChange?: (width: number) => void
  sidebarCollapsed?: boolean
  onSidebarCollapsedChange?: (collapsed: boolean) => void
  /** 已本地化的无障碍名称。 */
  labels: AppFrameLabels
  className?: string
}

export interface AppFrameContextValue {
  layout: FrameLayout
  /** 侧栏内容是否可见（宽栏展开或窄窗口抽屉打开）。 */
  sidebarVisible: boolean
  toggleSidebar: () => void
  closeSidebarDrawer: () => void
}

const AppFrameContext = React.createContext<AppFrameContextValue | null>(null)

export function useAppFrame(): AppFrameContextValue {
  const value = React.useContext(AppFrameContext)
  if (!value) throw new Error('useAppFrame must be used inside <AppFrame>')
  return value
}

const RESIZE_STEP = 16

/**
 * 三栏应用框架：侧栏（可拖动 264–420，收起为 56px rail，帧宽 <1024 自动收起）、中栏、右栏。
 * 帧宽通过 ResizeObserver 测量：收起与右栏让位依赖实际像素宽度和侧栏状态，CSS 断点无法表达。
 */
export function AppFrame({
  sidebar,
  rail,
  children,
  rightPanel,
  rightOpen = false,
  sidebarWidth = SIDEBAR_DEFAULT_WIDTH,
  onSidebarWidthChange,
  sidebarCollapsed = false,
  onSidebarCollapsedChange,
  labels,
  className,
}: AppFrameProps) {
  const rootRef = React.useRef<HTMLDivElement>(null)
  const drawerRef = React.useRef<HTMLDivElement>(null)
  const returnFocusRef = React.useRef<HTMLElement | null>(null)
  const [frameWidth, setFrameWidth] = React.useState<number | null>(null)
  const [drawerOpen, setDrawerOpen] = React.useState(false)
  const [dragging, setDragging] = React.useState(false)

  React.useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    setFrameWidth(root.getBoundingClientRect().width)
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) setFrameWidth(entry.contentRect.width)
    })
    observer.observe(root)
    return () => observer.disconnect()
  }, [])

  const layout = computeFrameLayout({ frameWidth: frameWidth ?? Number.POSITIVE_INFINITY, sidebarWidth, sidebarCollapsed, rightOpen })
  const drawerVisible = layout.narrow && drawerOpen

  // 帧变宽后抽屉不再适用；派生而非同步状态：渲染时按 narrow 判断，离开窄窗口时重置。
  if (!layout.narrow && drawerOpen) setDrawerOpen(false)

  const closeSidebarDrawer = React.useCallback(() => setDrawerOpen(false), [])
  const toggleSidebar = React.useCallback(() => {
    if (layout.narrow) {
      returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      setDrawerOpen((open) => !open)
    } else {
      onSidebarCollapsedChange?.(!sidebarCollapsed)
    }
  }, [layout.narrow, onSidebarCollapsedChange, sidebarCollapsed])

  React.useEffect(() => {
    if (!drawerVisible) return
    drawerRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) setDrawerOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      returnFocusRef.current?.focus()
    }
  }, [drawerVisible])

  const context = React.useMemo<AppFrameContextValue>(
    () => ({ layout, sidebarVisible: layout.sidebar === 'expanded' || drawerVisible, toggleSidebar, closeSidebarDrawer }),
    [layout, drawerVisible, toggleSidebar, closeSidebarDrawer],
  )

  const resizeTo = (width: number) => onSidebarWidthChange?.(clampSidebarWidth(width))

  const onResizeKeyDown = (event: React.KeyboardEvent) => {
    const next =
      event.key === 'ArrowRight'
        ? sidebarWidth + RESIZE_STEP
        : event.key === 'ArrowLeft'
          ? sidebarWidth - RESIZE_STEP
          : event.key === 'Home'
            ? SIDEBAR_MIN_WIDTH
            : event.key === 'End'
              ? SIDEBAR_MAX_WIDTH
              : null
    if (next === null) return
    event.preventDefault()
    resizeTo(next)
  }

  const onResizePointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0) return
    // 阻止拖动时选中文字；保留键盘焦点，按下后可继续用方向键微调。
    event.preventDefault()
    ;(event.currentTarget as HTMLElement).focus()
    const startX = event.clientX
    const startWidth = layout.sidebarColumn
    setDragging(true)
    const onMove = (move: PointerEvent) => resizeTo(startWidth + move.clientX - startX)
    const onUp = () => {
      setDragging(false)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  const rightColumn = layout.right === 'column' ? layout.rightColumn : 0
  const frameStyle = {
    '--local-sidebar-column': `${layout.sidebarColumn}px`,
    '--local-right-column': `${rightColumn}px`,
    '--local-right-overlay': `${layout.rightColumn}px`,
  } as React.CSSProperties

  return (
    <AppFrameContext.Provider value={context}>
      <div
        ref={rootRef}
        data-slot="app-frame"
        data-sidebar={layout.sidebar}
        data-narrow={layout.narrow || undefined}
        data-right={layout.right}
        style={frameStyle}
        className={cn(
          'relative grid h-full w-full min-w-0 overflow-hidden bg-background text-foreground',
          'grid-cols-[var(--local-sidebar-column)_minmax(0,1fr)_var(--local-right-column)]',
          !dragging && frameWidth !== null && 'transition-[grid-template-columns] duration-300 motion-reduce:transition-none',
          className,
        )}
      >
        <aside
          data-slot="app-frame-sidebar"
          aria-label={labels.sidebar}
          className="relative flex min-h-0 min-w-0 flex-col overflow-hidden border-r-hairline border-sidebar-border bg-sidebar text-sidebar-foreground"
        >
          {layout.sidebar === 'expanded' ? sidebar : rail}
        </aside>

        {layout.sidebar === 'expanded' && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={labels.resizeSidebar}
            aria-valuemin={SIDEBAR_MIN_WIDTH}
            aria-valuemax={SIDEBAR_MAX_WIDTH}
            aria-valuenow={layout.sidebarColumn}
            tabIndex={0}
            data-slot="app-frame-resize-handle"
            onKeyDown={onResizeKeyDown}
            onPointerDown={onResizePointerDown}
            className="absolute inset-y-0 z-20 w-2 -translate-x-1/2 cursor-col-resize touch-none after:absolute after:inset-y-0 after:left-1/2 after:w-hairline after:content-[''] hover:after:bg-ring focus-visible:after:bg-ring"
            style={{ left: 'var(--local-sidebar-column)' }}
          />
        )}

        <main data-slot="app-frame-main" aria-label={labels.main} className="@container/main relative flex min-h-0 min-w-0 flex-col overflow-hidden">
          {children}
        </main>

        <section
          data-slot="app-frame-right"
          aria-label={labels.rightPanel}
          hidden={layout.right === 'closed'}
          className={cn(
            'min-h-0 min-w-0 flex-col overflow-hidden bg-background',
            layout.right !== 'closed' && 'flex',
            layout.right === 'column' && 'border-l-hairline',
            layout.right === 'overlay' && 'absolute inset-y-0 right-0 z-30 w-(--local-right-overlay) shadow-prominent',
          )}
        >
          {rightPanel}
        </section>

        {drawerVisible && (
          <>
            <div data-slot="app-frame-scrim" aria-hidden className="absolute inset-0 z-40 bg-overlay" onPointerDown={closeSidebarDrawer} />
            <div
              ref={drawerRef}
              role="dialog"
              aria-modal="true"
              aria-label={labels.sidebar}
              tabIndex={-1}
              data-slot="app-frame-drawer"
              className="absolute inset-y-0 left-0 z-50 flex max-w-[calc(100%-var(--local-sidebar-column))] flex-col bg-sidebar text-sidebar-foreground shadow-prominent outline-none"
              style={{ width: clampSidebarWidth(sidebarWidth) }}
            >
              {sidebar}
            </div>
          </>
        )}
      </div>
    </AppFrameContext.Provider>
  )
}
