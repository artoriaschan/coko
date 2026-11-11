import { trackKeyboardFocus } from '../lib/focus-visible.ts'
import * as React from 'react'
import { Group, Panel, Separator, usePanelRef } from 'react-resizable-panels'
import { cn } from '../lib/utils.ts'
import {
  clampRightPanelWidth,
  clampSidebarWidth,
  computeFrameLayout,
  rightPanelMaxWidth,
  RIGHT_AUTO_FULLSCREEN_BELOW,
  RIGHT_MIN_WIDTH,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  CENTER_MIN_WIDTH,
  type FrameLayout,
} from './frame-layout.ts'

export interface AppFrameLabels {
  sidebar: string
  main: string
  rightPanel: string
  resizeSidebar: string
  resizeRightPanel: string
}

export interface AppFrameProps {
  /** 展开的侧栏内容（宽栏与窄窗口抽屉共用）。 */
  sidebar: React.ReactNode
  /** 收起后嵌入中栏标题的控制条。 */
  rail: React.ReactNode
  children: React.ReactNode
  rightPanel?: React.ReactNode
  rightOpen?: boolean
  onRightOpenChange?: (open: boolean) => void
  rightWidth?: number | undefined
  onRightWidthChange?: (width: number) => void
  /** 仅用户选择的全屏偏好；窄窗口的自动全屏由框架派生。 */
  rightFullscreen?: boolean
  onRightFullscreenChange?: (fullscreen: boolean) => void
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
  rightFullscreen: boolean
  toggleRightFullscreen: () => void
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
 * 应用框架：左侧栏（264–420px、窄窗口抽屉）、主内容、可拖宽与全屏的右栏。
 * react-resizable-panels 管理拖拽；测量帧宽与实际侧栏宽度以派生抽屉、全屏和右栏空间不足状态。
 */
export function AppFrame({
  sidebar,
  rail,
  children,
  rightPanel,
  rightOpen = false,
  onRightOpenChange,
  rightWidth,
  onRightWidthChange,
  rightFullscreen: manualRightFullscreen = false,
  onRightFullscreenChange,
  sidebarWidth = SIDEBAR_DEFAULT_WIDTH,
  onSidebarWidthChange,
  sidebarCollapsed = false,
  onSidebarCollapsedChange,
  labels,
  className,
}: AppFrameProps) {
  const rootRef = React.useRef<HTMLDivElement>(null)
  React.useLayoutEffect(() => trackKeyboardFocus(rootRef.current!.ownerDocument), [])
  const drawerRef = React.useRef<HTMLDivElement>(null)
  const peekRef = React.useRef<HTMLDivElement>(null)
  const returnFocusRef = React.useRef<HTMLElement | null>(null)
  const [frameWidth, setFrameWidth] = React.useState<number | null>(null)
  const [drawerOpen, setDrawerOpen] = React.useState(false)
  const [peekOpen, setPeekOpen] = React.useState(false)
  const sidebarPanel = usePanelRef()
  const rightPanelRef = usePanelRef()
  const rightResizeHandle = React.useRef<HTMLDivElement>(null)
  const [measuredSidebarWidth, setMeasuredSidebarWidth] = React.useState(sidebarWidth)
  const [measuredRightWidth, setMeasuredRightWidth] = React.useState(0)
  const [measuredWorkspaceWidth, setMeasuredWorkspaceWidth] = React.useState(0)
  const activeResize = React.useRef<'sidebar' | 'right' | null>(null)
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

  const measuredWidth = frameWidth ?? window.innerWidth
  const layout = computeFrameLayout({
    frameWidth: measuredWidth,
    sidebarWidth: measuredSidebarWidth || sidebarWidth,
    sidebarCollapsed,
    rightOpen,
    rightWidth,
    rightFullscreen: manualRightFullscreen,
  })
  const rightFullscreen = layout.right === 'fullscreen'
  const sidebarExpanded = layout.sidebar === 'expanded'
  const rightColumn = layout.rightColumn
  const workspaceWidth = measuredWidth - layout.sidebarColumn
  const initialSidebarWidth = React.useRef(sidebarExpanded ? sidebarWidth : 0)
  const initialRightWidth = React.useRef(rightColumn)
  const previousRight = React.useRef(layout.right)
  const [rightTransitionWidth, setRightTransitionWidth] = React.useState<number | null>(null)
  const rightTransitioning = rightTransitionWidth !== null
  React.useLayoutEffect(() => {
    const previous = previousRight.current
    previousRight.current = layout.right
    if (previous === layout.right) return
    const columnToggle = (previous === 'closed' && layout.right === 'column') || (previous === 'column' && layout.right === 'closed')
    setRightTransitionWidth(
      columnToggle && frameWidth !== null && !window.matchMedia('(prefers-reduced-motion: reduce)').matches ? rightColumn || measuredRightWidth : null,
    )
  }, [layout.right, frameWidth, rightColumn, measuredRightWidth])
  React.useLayoutEffect(() => setRightTransitionWidth(null), [frameWidth])
  // 外部偏好、收起与窗口尺寸变化通过 imperative API 应用，不重挂载正文，也不作为用户拖动提交。
  React.useEffect(() => {
    if (sidebarExpanded) sidebarPanel.current?.resize(clampSidebarWidth(sidebarWidth))
    else sidebarPanel.current?.collapse()
  }, [sidebarPanel, sidebarExpanded, sidebarWidth])
  React.useEffect(() => {
    // 嵌套 Group 要等外层提交新的像素宽度，避免用旧容器宽度把偏好换算为百分比。
    const frame = requestAnimationFrame(() => {
      if (rightResizeHandle.current?.dataset.separator === 'active') return
      if (rightColumn > 0) rightPanelRef.current?.resize(rightColumn)
      else rightPanelRef.current?.collapse()
    })
    return () => cancelAnimationFrame(frame)
  }, [rightPanelRef, rightColumn, measuredWorkspaceWidth])
  const toggleRightFullscreen = React.useCallback(() => {
    onRightFullscreenChange?.(!rightFullscreen)
    if (rightFullscreen && measuredWidth < RIGHT_AUTO_FULLSCREEN_BELOW) onRightOpenChange?.(false)
  }, [rightFullscreen, measuredWidth, onRightFullscreenChange, onRightOpenChange])
  React.useLayoutEffect(() => {
    if (frameWidth !== null && rightOpen && layout.right === 'closed') onRightOpenChange?.(false)
  }, [frameWidth, rightOpen, layout.right, onRightOpenChange])
  const drawerVisible = layout.narrow && drawerOpen && !rightFullscreen

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
  const peekVisible = peekOpen && peekAvailable && !rightFullscreen
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
      rightFullscreen,
      toggleRightFullscreen,
      sidebarVisible: layout.sidebar === 'expanded' || drawerVisible,
      toggleSidebar,
      closeSidebarDrawer,
      peekSidebar,
      leaveSidebarPeek,
      collapsedControls: rail,
    }),
    [layout, rightFullscreen, toggleRightFullscreen, drawerVisible, toggleSidebar, closeSidebarDrawer, peekSidebar, leaveSidebarPeek, rail],
  )

  const resizeTo = (width: number) => onSidebarWidthChange?.(clampSidebarWidth(width))
  const resizeRightTo = (width: number) => onRightWidthChange?.(clampRightPanelWidth(width, measuredWidth, layout.sidebarColumn))

  const onRightResizeKeyDown = (event: React.KeyboardEvent) => {
    // 开合由工作台按钮管理，避免库的 Enter 折叠绕过应用状态。
    if (event.key === 'Enter') return event.preventDefault()
    const next =
      event.key === 'ArrowLeft'
        ? layout.rightColumn + RESIZE_STEP
        : event.key === 'ArrowRight'
          ? layout.rightColumn - RESIZE_STEP
          : event.key === 'Home'
            ? RIGHT_MIN_WIDTH
            : event.key === 'End'
              ? rightPanelMaxWidth(measuredWidth, layout.sidebarColumn)
              : null
    if (next === null) return
    event.preventDefault()
    resizeRightTo(next)
  }

  const onResizeKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter') return event.preventDefault()
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

  const frameStyle = {
    // 主内容标题栏的左侧起点：控制条在收起时作为标题栏的第一个子项，标题紧随其后。
    '--local-header-leading': layout.sidebar === 'expanded' ? '16px' : '0px',
  } as React.CSSProperties

  return (
    <AppFrameContext.Provider value={context}>
      <Group
        elementRef={rootRef}
        data-slot="app-frame"
        data-sidebar={layout.sidebar}
        data-narrow={layout.narrow || undefined}
        data-right={layout.right}
        data-right-transitioning={rightTransitioning || undefined}
        style={frameStyle}
        resizeTargetMinimumSize={{ fine: 8, coarse: 20 }}
        disabled={rightFullscreen || !sidebarExpanded}
        onLayoutChanged={(sizes, { isUserInteraction }) => {
          if (isUserInteraction && sidebarExpanded && activeResize.current === 'sidebar') {
            activeResize.current = null
            resizeTo((sizes.sidebar! / 100) * measuredWidth)
          }
        }}
        className={cn(
          'app-frame relative h-full w-full min-w-0 overflow-hidden rounded-panel [clip-path:border-box] bg-sidebar text-foreground',
          "after:pointer-events-none after:absolute after:inset-0 after:z-30 after:rounded-panel after:border-hairline after:border-sidebar-border after:content-['']",
          className,
        )}
      >
        <Panel
          id="sidebar"
          panelRef={sidebarPanel}
          defaultSize={initialSidebarWidth.current}
          collapsible
          collapsedThreshold={SIDEBAR_MIN_WIDTH}
          minSize={SIDEBAR_MIN_WIDTH}
          maxSize={SIDEBAR_MAX_WIDTH}
          groupResizeBehavior="preserve-pixel-size"
          onResize={({ inPixels }) => setMeasuredSidebarWidth(inPixels)}
          className="h-full min-w-0"
        >
          {sidebarExpanded && (
            <aside
              inert={rightFullscreen || undefined}
              data-slot="app-frame-sidebar"
              aria-label={labels.sidebar}
              className="sidebar-surface relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden text-sidebar-foreground"
            >
              {sidebar}
            </aside>
          )}
        </Panel>

        {peekVisible && (
          <div
            ref={peekRef}
            data-slot="app-frame-peek"
            className="sidebar-surface absolute inset-y-0 left-0 z-50 flex flex-col overflow-hidden rounded-panel text-sidebar-foreground shadow-prominent"
            style={{ width: clampSidebarWidth(sidebarWidth) }}
          >
            {sidebar}
          </div>
        )}

        {layout.sidebar === 'expanded' && (
          <Separator
            disableDoubleClick
            inert={rightFullscreen || undefined}
            aria-label={labels.resizeSidebar}
            data-slot="app-frame-resize-handle"
            onKeyDownCapture={onResizeKeyDown}
            onPointerDownCapture={() => {
              setRightTransitionWidth(null)
              activeResize.current = 'sidebar'
            }}
            data-window-no-drag
            className="absolute inset-y-0 z-20 w-2 -translate-x-1/2 cursor-col-resize touch-none focus-ring"
            style={{ left: layout.sidebarColumn }}
          />
        )}

        <Panel id="workspace" onResize={({ inPixels }) => setMeasuredWorkspaceWidth(inPixels)} className="h-full min-w-0" style={{ overflow: 'visible' }}>
          <Group
            disabled={layout.right !== 'column'}
            style={{ overflow: 'visible' }}
            resizeTargetMinimumSize={{ fine: 8, coarse: 20 }}
            onLayoutChanged={(sizes, { isUserInteraction }) => {
              if (isUserInteraction && layout.right === 'column' && activeResize.current === 'right') {
                activeResize.current = null
                resizeRightTo((sizes.right! / 100) * measuredWorkspaceWidth)
              }
            }}
          >
            <Panel
              id="main"
              data-slot="app-frame-main-column"
              minSize={Math.min(CENTER_MIN_WIDTH, Math.max(0, workspaceWidth - rightColumn))}
              className="h-full min-w-0"
            >
              <main
                inert={rightFullscreen || undefined}
                data-slot="app-frame-main"
                aria-label={labels.main}
                className="@container/main relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background before:pointer-events-none before:absolute before:inset-y-0 before:left-0 before:z-10 before:w-hairline before:bg-sidebar-border before:content-['']"
              >
                {children}
              </main>
            </Panel>

            {layout.right === 'column' && (
              <Separator
                elementRef={rightResizeHandle}
                disableDoubleClick
                aria-label={labels.resizeRightPanel}
                data-slot="app-frame-right-resize-handle"
                data-window-no-drag
                onKeyDownCapture={onRightResizeKeyDown}
                onPointerDownCapture={() => {
                  setRightTransitionWidth(null)
                  activeResize.current = 'right'
                }}
                className="absolute inset-y-0 z-20 w-2 translate-x-1/2 cursor-col-resize touch-none focus-ring"
                style={{ right: measuredRightWidth }}
              />
            )}

            <Panel
              id="right"
              data-slot="app-frame-right-column"
              panelRef={rightPanelRef}
              defaultSize={initialRightWidth.current}
              collapsible
              collapsedThreshold={RIGHT_MIN_WIDTH}
              minSize={rightColumn > 0 ? RIGHT_MIN_WIDTH : 0}
              maxSize={rightColumn > 0 ? Math.max(RIGHT_MIN_WIDTH, rightPanelMaxWidth(measuredWidth, layout.sidebarColumn)) : 0}
              groupResizeBehavior="preserve-pixel-size"
              onResize={({ inPixels }) => setMeasuredRightWidth(inPixels)}
              className="h-full min-w-0"
              style={{ overflow: rightFullscreen ? 'visible' : 'hidden' }}
              onTransitionEnd={(event) => {
                if (event.target === event.currentTarget && event.propertyName === 'flex-grow') setRightTransitionWidth(null)
              }}
            >
              <section
                data-slot="app-frame-right"
                aria-label={labels.rightPanel}
                hidden={layout.right === 'closed' && !rightTransitioning}
                inert={layout.right === 'closed' || undefined}
                style={rightTransitioning ? { width: rightTransitionWidth } : undefined}
                className={cn(
                  'h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background',
                  (layout.right !== 'closed' || rightTransitioning) && 'flex',
                  (layout.right === 'column' || rightTransitioning) && 'border-l-hairline',
                  rightFullscreen && 'absolute inset-0 z-40 [&_[data-slot=panel-tab-strip]]:ps-[max(10px,calc(var(--frame-leading-clearance)_+_12px))]',
                )}
              >
                {rightPanel}
              </section>
            </Panel>
          </Group>
        </Panel>

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
              className="sidebar-surface absolute inset-y-0 left-0 z-50 flex max-w-full flex-col overflow-hidden rounded-panel text-sidebar-foreground shadow-prominent outline-none"
              style={{ width: clampSidebarWidth(sidebarWidth) }}
            >
              {sidebar}
            </div>
          </>
        )}
      </Group>
    </AppFrameContext.Provider>
  )
}
