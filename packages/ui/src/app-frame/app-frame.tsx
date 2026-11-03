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
  /** rail 展开按钮悬停时浮出侧栏卡片；仅宽窗口的收起状态生效。 */
  peekSidebar: () => void
  /** 指针离开收起控制条时取消尚未完成的浮出。 */
  leaveSidebarPeek: () => void
  /** 收起后主内容标题栏左侧的展开 / 历史 / 新对话控制条。 */
  collapsedControls: React.ReactNode
}

const AppFrameContext = React.createContext<AppFrameContextValue | null>(null)

export function useAppFrame(): AppFrameContextValue {
  const value = React.useContext(AppFrameContext)
  if (!value) throw new Error('useAppFrame must be used inside <AppFrame>')
  return value
}

/**
 * 侧栏收起时嵌在主内容标题栏内的控制条。放在标题栏内部是为了沿用标题栏的
 * 窗口拖拽区排除规则，按钮不会落入原生标题栏的拖拽命中范围。
 */
export function AppFrameCollapsedControls() {
  const { layout, collapsedControls } = useAppFrame()
  if (layout.sidebar !== 'hidden') return null
  return (
    <div
      data-slot="app-frame-collapsed-controls"
      className="flex h-full shrink-0 items-start pe-2 pt-[11px] ps-[max(8px,calc(var(--frame-leading-clearance)_+_12px))]"
    >
      {collapsedControls}
    </div>
  )
}

const RESIZE_STEP = 16

/**
 * 应用框架：侧栏（可拖动 264–420，收起为 56px rail，帧宽 <1024 自动收起）、主内容和可选右栏。
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
  const peekRef = React.useRef<HTMLDivElement>(null)
  const returnFocusRef = React.useRef<HTMLElement | null>(null)
  const [frameWidth, setFrameWidth] = React.useState<number | null>(null)
  const [drawerOpen, setDrawerOpen] = React.useState(false)
  const [peekOpen, setPeekOpen] = React.useState(false)
  const [dragging, setDragging] = React.useState(false)
  const peekOpenTimer = React.useRef<number | null>(null)
  const peekCloseTimer = React.useRef<number | null>(null)
  // 指针在展开按钮上时，200ms 后浮出侧栏卡片；离开控制条或进入其他按钮时取消。
  const peekHover = React.useRef(false)
  const peekAvailableRef = React.useRef(false)

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

  const closeSidebarDrawer = React.useCallback(() => {
    setDrawerOpen(false)
    setPeekOpen(false)
  }, [])
  const toggleSidebar = React.useCallback(() => {
    setPeekOpen(false)
    peekHover.current = false
    if (layout.narrow) {
      returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      setDrawerOpen((open) => !open)
    } else {
      onSidebarCollapsedChange?.(!sidebarCollapsed)
    }
  }, [layout.narrow, onSidebarCollapsedChange, sidebarCollapsed])

  // 侧栏整列收起后，悬停左上角展开按钮延迟浮出侧栏卡片；指针进入卡片或停留展开按钮时保持。
  const peekAvailable = layout.sidebar === 'hidden' && !layout.narrow
  const peekVisible = peekOpen && peekAvailable
  peekAvailableRef.current = peekAvailable
  const schedulePeekOpen = () => {
    if (!peekAvailable || !peekHover.current) return
    if (peekCloseTimer.current !== null) window.clearTimeout(peekCloseTimer.current)
    peekCloseTimer.current = null
    if (peekVisible || peekOpenTimer.current !== null) return
    peekOpenTimer.current = window.setTimeout(() => {
      peekOpenTimer.current = null
      if (peekHover.current && peekAvailableRef.current) setPeekOpen(true)
    }, 200)
  }
  const leavePeek = () => {
    peekHover.current = false
    if (peekOpenTimer.current !== null) window.clearTimeout(peekOpenTimer.current)
    peekOpenTimer.current = null
  }
  const schedulePeekClose = () => {
    if (peekOpenTimer.current !== null) window.clearTimeout(peekOpenTimer.current)
    peekOpenTimer.current = null
    if (peekCloseTimer.current !== null) return
    peekCloseTimer.current = window.setTimeout(() => {
      peekCloseTimer.current = null
      if (peekRef.current?.contains(document.activeElement) && document.activeElement?.matches(':focus-visible')) return
      setPeekOpen(false)
    }, 180)
  }
  const cancelPeekClose = () => {
    if (peekCloseTimer.current !== null) window.clearTimeout(peekCloseTimer.current)
    peekCloseTimer.current = null
  }
  const peekSidebarRef = React.useRef(schedulePeekOpen)
  peekSidebarRef.current = schedulePeekOpen
  const peekSidebar = React.useCallback(() => {
    peekHover.current = true
    peekSidebarRef.current()
  }, [])
  const leaveSidebarPeekRef = React.useRef(leavePeek)
  leaveSidebarPeekRef.current = leavePeek
  const leaveSidebarPeek = React.useCallback(() => leaveSidebarPeekRef.current(), [])
  React.useEffect(
    () => () => {
      if (peekOpenTimer.current !== null) window.clearTimeout(peekOpenTimer.current)
      if (peekCloseTimer.current !== null) window.clearTimeout(peekCloseTimer.current)
    },
    [],
  )
  // 卡片浮出会盖住 rail，不能用 hover 判定；指针移动到卡片或展开按钮之外才开始收回。
  // 收起动作后的抑制期内，指针继续在展开按钮上移动也会重新安排浮出。
  React.useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null
      if (target?.closest('[data-sidebar-expand]')) {
        if (peekVisible) cancelPeekClose()
        else schedulePeekOpen()
        return
      }
      if (!peekVisible) return
      if (target?.closest('[data-slot="app-frame-peek"]')) {
        cancelPeekClose()
        return
      }
      schedulePeekClose()
    }
    window.addEventListener('pointermove', onPointerMove)
    return () => window.removeEventListener('pointermove', onPointerMove)
  }, [peekVisible])
  React.useEffect(() => {
    if (!peekVisible) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      setPeekOpen(false)
      rootRef.current?.querySelector<HTMLElement>('[data-sidebar-expand]')?.focus()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [peekVisible])

  React.useEffect(() => {
    if (!drawerVisible) return
    // 内容已自行聚焦（例如打开即聚焦的搜索框）时保留，否则聚焦抽屉本身。
    if (!drawerRef.current?.contains(document.activeElement)) drawerRef.current?.focus()
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
    () => ({
      layout,
      sidebarVisible: layout.sidebar === 'expanded' || drawerVisible,
      toggleSidebar,
      closeSidebarDrawer,
      peekSidebar,
      leaveSidebarPeek,
      collapsedControls: rail,
    }),
    [layout, drawerVisible, toggleSidebar, closeSidebarDrawer, peekSidebar, leaveSidebarPeek, rail],
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
    // 主内容标题栏的左侧起点：控制条在收起时作为标题栏的第一个子项，标题紧随其后。
    '--local-header-leading': layout.sidebar === 'expanded' ? '16px' : '0px',
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
          'relative grid h-full w-full min-w-0 overflow-hidden rounded-panel [clip-path:border-box] bg-transparent text-foreground',
          'grid-cols-[var(--local-sidebar-column)_minmax(0,1fr)_var(--local-right-column)]',
          !dragging && frameWidth !== null && 'transition-[grid-template-columns] duration-300 motion-reduce:transition-none',
          className,
        )}
      >
        {layout.sidebar === 'expanded' && (
          <aside
            data-slot="app-frame-sidebar"
            aria-label={labels.sidebar}
            className="sidebar-glass isolate relative flex min-h-0 min-w-0 flex-col overflow-hidden text-sidebar-foreground"
          >
            {sidebar}
          </aside>
        )}

        {peekVisible && (
          <div
            ref={peekRef}
            data-slot="app-frame-peek"
            className="absolute inset-y-0 left-0 z-50 flex flex-col overflow-hidden rounded-panel bg-popover text-sidebar-foreground shadow-prominent"
            style={{ width: clampSidebarWidth(sidebarWidth) }}
          >
            {sidebar}
          </div>
        )}

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
            className="absolute inset-y-0 z-20 w-2 -translate-x-1/2 cursor-col-resize touch-none focus-ring"
            style={{ left: 'var(--local-sidebar-column)' }}
          />
        )}

        <main
          data-slot="app-frame-main"
          aria-label={labels.main}
          className="@container/main relative col-start-2 flex min-h-0 min-w-0 flex-col overflow-hidden bg-background before:pointer-events-none before:absolute before:inset-y-0 before:left-0 before:z-10 before:w-hairline before:bg-sidebar-border before:content-['']"
        >
          {children}
        </main>

        <section
          data-slot="app-frame-right"
          aria-label={labels.rightPanel}
          hidden={layout.right === 'closed'}
          className={cn(
            'col-start-3 min-h-0 min-w-0 flex-col overflow-hidden bg-background',
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
              className="absolute inset-y-0 left-0 z-50 flex max-w-[calc(100%-var(--local-sidebar-column))] flex-col overflow-hidden rounded-panel bg-popover text-sidebar-foreground shadow-prominent outline-none"
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
