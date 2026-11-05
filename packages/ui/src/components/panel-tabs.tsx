import { DndContext, PointerSensor, pointerWithin, useDraggable, useDroppable, useSensor, useSensors, type DraggableSyntheticListeners } from '@dnd-kit/core'
import * as React from 'react'
import { PlusIcon, XIcon } from 'lucide-react'
import { Button } from './button.tsx'
import { DropdownMenuItem } from './dropdown-menu.tsx'
import { RowMenu, type RowMenuPoint } from './row-menu.tsx'
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip.tsx'
import './panel-tabs.css'

export interface PanelTab<Kind extends string = string> {
  id: Kind
  title: string
  icon: React.ReactNode
  closeLabel?: string
  closeTooltip?: string
  closeKeyShortcuts?: string
}

/** 单格面板上沿；只有标签胶囊收缩，末端控件保持完整点击区。 */
export function PanelTabs<Kind extends string>({
  tabs,
  active,
  label,
  newTabLabel,
  onSelect,
  onClose,
  onNewTab,
  onMove,
  reorderHint,
  menuLabels,
  dragLabels,
  onCloseOthers,
  onCloseRight,
  controls,
}: {
  tabs: readonly PanelTab<Kind>[]
  active: Kind | null
  label: string
  newTabLabel: string
  onSelect: (id: Kind) => void
  onClose: (id: Kind) => void
  onNewTab?: (() => void) | undefined
  onMove: (id: Kind, index: number) => void
  dragLabels: { instructions: string; start: string; over: (title: string) => string; end: string; cancel: string }
  menuLabels: { close: string; closeOthers: string; closeRight: string }
  onCloseOthers: (id: Kind) => void
  onCloseRight: (id: Kind) => void
  reorderHint: string
  controls: React.ReactNode
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  const listRef = React.useRef<HTMLDivElement>(null)
  const [fade, setFade] = React.useState<'none' | 'left' | 'right' | 'both'>('none')
  const [menu, setMenu] = React.useState<{ id: Kind; point: RowMenuPoint } | null>(null)
  const [focused, setFocused] = React.useState<Kind | null>(null)
  const focusable = tabs.some((tab) => tab.id === focused) ? focused : active
  const measureEdges = React.useCallback(() => {
    const list = listRef.current
    if (!list) return
    const left = list.scrollLeft > 1
    const right = list.scrollWidth - list.clientWidth - list.scrollLeft > 1
    setFade(left && right ? 'both' : left ? 'left' : right ? 'right' : 'none')
  }, [])
  React.useLayoutEffect(() => {
    const list = listRef.current
    if (!list) return
    measureEdges()
    const observer = new ResizeObserver(measureEdges)
    observer.observe(list)
    for (const child of list.children) observer.observe(child)
    return () => observer.disconnect()
  }, [tabs, measureEdges])
  React.useLayoutEffect(() => {
    const button = [...(listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [])].find((element) => element.dataset.tab === active)
    button?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    measureEdges()
  }, [active, measureEdges])
  const onTabKeyDown = (event: React.KeyboardEvent, id: Kind) => {
    if (event.nativeEvent.isComposing) return
    const index = tabs.findIndex((tab) => tab.id === id)
    if ((event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) && tabs[index]?.closeLabel) {
      event.preventDefault()
      const bounds = event.currentTarget.getBoundingClientRect()
      setMenu({ id, point: { x: bounds.left, y: bounds.bottom } })
      return
    }
    if ((event.metaKey || event.ctrlKey) && event.shiftKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      event.preventDefault()
      onMove(id, Math.max(0, Math.min(tabs.length - 1, index + (event.key === 'ArrowLeft' ? -1 : 1))))
      return
    }
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
    const next =
      event.key === 'ArrowLeft'
        ? (index - 1 + tabs.length) % tabs.length
        : event.key === 'ArrowRight'
          ? (index + 1) % tabs.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? tabs.length - 1
              : null
    if (next === null) return
    event.preventDefault()
    const button = listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]
    button?.focus({ preventScroll: true })
    button?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }
  return (
    <div data-window-drag data-slot="panel-tab-strip" className="flex h-[38px] shrink-0 items-center gap-1 pt-2.5 pr-1.5 pl-2.5">
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        accessibility={{
          screenReaderInstructions: { draggable: dragLabels.instructions },
          announcements: {
            onDragStart: () => dragLabels.start,
            onDragOver: ({ over }) => {
              const tab = tabs.find((item) => item.id === over?.id)
              return tab ? dragLabels.over(tab.title) : undefined
            },
            onDragEnd: () => dragLabels.end,
            onDragCancel: () => dragLabels.cancel,
          },
        }}
        onDragEnd={({ active: dragged, over }) => {
          const source = tabs.find((tab) => tab.id === dragged.id)
          const index = tabs.findIndex((tab) => tab.id === over?.id)
          if (source && index >= 0) onMove(source.id, index)
        }}
      >
        <div
          ref={listRef}
          role="tablist"
          aria-label={label}
          data-fade={fade}
          onScroll={measureEdges}
          onBlurCapture={(event) => {
            if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setFocused(null)
          }}
          className="panel-tab-scroll flex min-w-0 shrink items-center gap-1 overflow-x-auto overflow-y-hidden"
          data-window-no-drag
        >
          {tabs.map((tab) => (
            <PanelTabSlot
              key={tab.id}
              id={tab.id}
              onAuxClick={(event) => {
                if (event.button === 1) {
                  event.preventDefault()
                  if (tab.closeLabel) onClose(tab.id)
                }
              }}
              onContextMenu={(event) => {
                event.preventDefault()
                if (tab.closeLabel) setMenu({ id: tab.id, point: { x: event.clientX, y: event.clientY } })
              }}
            >
              {(listeners, dragRef) => (
                <>
                  <PanelTabTooltip title={tab.title}>
                    <button
                      ref={dragRef}
                      {...listeners}
                      type="button"
                      role="tab"
                      id={`right-panel-tab-${tab.id}`}
                      data-tab={tab.id}
                      aria-selected={active === tab.id}
                      tabIndex={focusable === tab.id ? 0 : -1}
                      aria-keyshortcuts="Control+Shift+ArrowLeft Control+Shift+ArrowRight Meta+Shift+ArrowLeft Meta+Shift+ArrowRight"
                      aria-description={reorderHint}
                      onFocus={() => setFocused(tab.id)}
                      onKeyDown={(event) => onTabKeyDown(event, tab.id)}
                      aria-controls="right-panel-tabpanel"
                      className="flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-sm px-2.5 text-ui-body text-muted-foreground focus-ring aria-selected:text-foreground hover:text-foreground"
                      onClick={() => onSelect(tab.id)}
                    >
                      {tab.icon}
                      <span data-panel-tab-title className="min-w-0 truncate">
                        {tab.title}
                      </span>
                    </button>
                  </PanelTabTooltip>
                  {tab.closeLabel && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          aria-label={tab.closeLabel}
                          aria-keyshortcuts={tab.closeKeyShortcuts}
                          className="me-1 flex size-5 shrink-0 items-center justify-center rounded-xs text-muted-foreground focus-ring hover:bg-muted hover:text-foreground"
                          onClick={() => onClose(tab.id)}
                        >
                          <XIcon aria-hidden className="size-3.5" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>{tab.closeTooltip ?? tab.closeLabel}</TooltipContent>
                    </Tooltip>
                  )}
                </>
              )}
            </PanelTabSlot>
          ))}
        </div>
      </DndContext>
      {onNewTab && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="toolbar" size="icon-sm" aria-label={newTabLabel} onClick={onNewTab}>
              <PlusIcon aria-hidden />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{newTabLabel}</TooltipContent>
        </Tooltip>
      )}
      <RowMenu
        open={menu !== null}
        onOpenChange={(open) => {
          if (!open) setMenu(null)
        }}
        point={menu?.point ?? null}
        label={label}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          const buttons = [...(listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [])]
          const button =
            buttons.find((element) => element.dataset.tab === menu?.id) ?? buttons.find((element) => element.getAttribute('aria-selected') === 'true')
          button?.focus({ preventScroll: true })
        }}
      >
        <DropdownMenuItem
          onSelect={() => {
            if (menu) onClose(menu.id)
          }}
        >
          {menuLabels.close}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            if (menu) onCloseOthers(menu.id)
          }}
        >
          {menuLabels.closeOthers}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            if (menu) onCloseRight(menu.id)
          }}
        >
          {menuLabels.closeRight}
        </DropdownMenuItem>
      </RowMenu>
      <div className="min-w-0 flex-1" />
      <div className="flex shrink-0 items-center gap-2" data-window-no-drag>
        {controls}
      </div>
    </div>
  )
}

/** 只在实际截断时显示全文，随语言、控件和可用宽度一起重新测量。 */
function PanelTabTooltip({ title, children }: { title: string; children: React.ReactNode }) {
  const trigger = React.useRef<HTMLButtonElement>(null)
  const [truncated, setTruncated] = React.useState(false)
  const [open, setOpen] = React.useState(false)
  React.useLayoutEffect(() => {
    const button = trigger.current
    const text = button?.querySelector<HTMLElement>('[data-panel-tab-title]')
    if (!button || !text) return
    const measure = () => setTruncated(text.scrollWidth > text.clientWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(button)
    observer.observe(text)
    return () => observer.disconnect()
  }, [title])
  return (
    <Tooltip open={truncated && open} onOpenChange={setOpen}>
      <TooltipTrigger asChild ref={trigger}>
        {children}
      </TooltipTrigger>
      <TooltipContent>{title}</TooltipContent>
    </Tooltip>
  )
}

/** 胶囊是放置区，只有 tab 按钮接受拖动，关闭按钮不会启动排序。 */
function PanelTabSlot({
  id,
  children,
  ...events
}: {
  id: string
  children: (listeners: DraggableSyntheticListeners | undefined, ref: (node: HTMLElement | null) => void) => React.ReactNode
  onAuxClick: React.MouseEventHandler<HTMLDivElement>
  onContextMenu: React.MouseEventHandler<HTMLDivElement>
}) {
  const { setNodeRef: dropRef, isOver } = useDroppable({ id })
  const { setNodeRef: dragRef, listeners, isDragging, transform } = useDraggable({ id })
  return (
    <div
      ref={dropRef}
      data-panel-tab-dragging={isDragging || undefined}
      data-panel-tab-drop={isOver && !isDragging ? id : undefined}
      className="relative flex h-7 min-w-20 max-w-[170px] shrink-0 items-center rounded-sm has-aria-selected:bg-accent data-[panel-tab-dragging]:z-10 data-[panel-tab-dragging]:opacity-60 data-[panel-tab-drop]:ring-1 data-[panel-tab-drop]:ring-ring"
      style={transform ? { transform: `translate3d(${transform.x}px, 0, 0)` } : undefined}
      {...events}
    >
      {children(listeners, dragRef)}
    </div>
  )
}

/** 重复聚焦当前格时的短暂内发光；按请求身份重新挂载，不影响正文。 */
export function PanelAttention() {
  const element = React.useRef<HTMLDivElement>(null)
  const [finished, setFinished] = React.useState(false)
  React.useLayoutEffect(() => {
    const target = element.current
    if (!target) return
    const duration = Number.parseFloat(getComputedStyle(target).getPropertyValue('--local-panel-attention-duration'))
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    // WAAPI 保持 reduced-motion 的 600ms 静态提示，不被主题的全局 CSS 动画缩短规则清除。
    const animation = target.animate([{ opacity: 1 }, { opacity: reduced ? 1 : 0 }], { duration, easing: 'ease-out' })
    animation?.addEventListener('finish', () => setFinished(true))
    return () => animation?.cancel()
  }, [])
  return finished ? null : <div ref={element} aria-hidden data-slot="panel-attention" className="panel-attention pointer-events-none absolute inset-0 z-20" />
}

/** 开始页按登记顺序居中呈现入口，文案由宿主本地化。 */
export function PanelStart<Kind extends string>({
  pages,
  onOpen,
}: {
  pages: readonly { id: Kind; title: string; icon: React.ReactNode }[]
  onOpen: (id: Kind) => void
}) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-4" data-scroll-stable>
      <div className="grid w-full max-w-96 grid-cols-2 gap-3">
        {pages.map((page) => (
          <button
            key={page.id}
            type="button"
            onClick={() => onOpen(page.id)}
            className="flex min-h-24 min-w-0 flex-col items-center justify-center gap-2 rounded-xl bg-card p-3 text-ui-body text-foreground focus-ring hover:bg-accent"
          >
            {page.icon}
            <span className="max-w-full truncate">{page.title}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
