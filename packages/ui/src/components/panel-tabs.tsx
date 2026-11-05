import type * as React from 'react'
import { PlusIcon, XIcon } from 'lucide-react'
import { Button } from './button.tsx'
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip.tsx'

export interface PanelTab<Kind extends string = string> {
  id: Kind
  title: string
  icon: React.ReactNode
  closeLabel?: string
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
  controls,
}: {
  tabs: readonly PanelTab<Kind>[]
  active: Kind | null
  label: string
  newTabLabel: string
  onSelect: (id: Kind) => void
  onClose: (id: Kind) => void
  onNewTab?: (() => void) | undefined
  controls: React.ReactNode
}) {
  return (
    <div data-window-drag data-slot="panel-tab-strip" className="flex h-[38px] shrink-0 items-center gap-1 pt-2.5 pr-1.5 pl-2.5">
      <div role="tablist" aria-label={label} className="flex min-w-0 shrink items-center gap-1 overflow-hidden" data-window-no-drag>
        {tabs.map((tab) => (
          <div key={tab.id} className="relative flex h-7 min-w-20 max-w-[170px] shrink-0 items-center rounded-sm has-aria-selected:bg-accent">
            <button
              type="button"
              role="tab"
              id={`right-panel-tab-${tab.id}`}
              data-tab={tab.id}
              aria-selected={active === tab.id}
              aria-controls="right-panel-tabpanel"
              className="flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-sm px-2.5 text-ui-body text-muted-foreground focus-ring aria-selected:text-foreground hover:text-foreground"
              onClick={() => onSelect(tab.id)}
            >
              {tab.icon}
              <span className="min-w-0 truncate">{tab.title}</span>
            </button>
            {tab.closeLabel && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label={tab.closeLabel}
                    className="me-1 flex size-5 shrink-0 items-center justify-center rounded-xs text-muted-foreground focus-ring hover:bg-muted hover:text-foreground"
                    onClick={() => onClose(tab.id)}
                  >
                    <XIcon aria-hidden className="size-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>{tab.closeLabel}</TooltipContent>
              </Tooltip>
            )}
          </div>
        ))}
      </div>
      {onNewTab && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="toolbar" size="icon" aria-label={newTabLabel} onClick={onNewTab}>
              <PlusIcon aria-hidden />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{newTabLabel}</TooltipContent>
        </Tooltip>
      )}
      <div className="min-w-0 flex-1" />
      <div className="flex shrink-0 items-center gap-2" data-window-no-drag>
        {controls}
      </div>
    </div>
  )
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
