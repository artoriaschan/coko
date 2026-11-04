import { XIcon } from 'lucide-react'
import { useStore } from 'zustand'
import { useChat } from '../../app/chat.tsx'
import { useI18n } from '../../app/i18n.tsx'
import { IconButton } from '../../app/icon-button.tsx'
import { RIGHT_PANEL_TABS, rightPanelTabStore, selectRightPanelTab, visibleRightPanelTabs, type RightPanelTabDefinition } from './tabs.ts'

/** 右栏：没有已交付的 tab 时显示空状态；有时标题下为 tab 列表，选中项不可见时显示第一个。 */
export function RightPanel({ onClose, tabs = RIGHT_PANEL_TABS }: { onClose: () => void; tabs?: readonly RightPanelTabDefinition[] }) {
  const { t } = useI18n()
  const sessionId = useChat((s) => s.activeSessionId)
  const selected = useStore(rightPanelTabStore, (s) => s.selected)
  const visible = visibleRightPanelTabs(tabs)
  const current = visible.find((tab) => tab.id === selected) ?? visible[0]
  return (
    <>
      <header data-window-drag className="flex h-(--frame-top-clearance) shrink-0 items-center gap-2 ps-4 pe-2">
        <h2 className="min-w-0 flex-1 truncate text-ui-body-lg font-medium">{t('rightPanel.title')}</h2>
        <IconButton label={t('frame.closeRightPanel')} tooltip={t('frame.collapseSidebar')} onClick={onClose}>
          <XIcon />
        </IconButton>
      </header>
      {current ? (
        <>
          <div role="tablist" aria-label={t('rightPanel.title')} className="flex shrink-0 gap-1 px-2 pb-2">
            {visible.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                id={`right-panel-tab-${tab.id}`}
                aria-selected={tab === current}
                aria-controls="right-panel-tabpanel"
                data-tab={tab.id}
                className="min-w-0 truncate rounded-md px-2 py-1 text-ui-body text-muted-foreground focus-ring aria-selected:bg-accent aria-selected:text-foreground [@media(hover:hover)]:hover:text-foreground"
                onClick={() => selectRightPanelTab(tab.id)}
              >
                {t(tab.label)}
              </button>
            ))}
          </div>
          <div role="tabpanel" id="right-panel-tabpanel" aria-labelledby={`right-panel-tab-${current.id}`} className="flex min-h-0 flex-1 flex-col">
            <current.Component sessionId={sessionId} />
          </div>
        </>
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center text-ui-body text-muted-foreground">{t('rightPanel.empty')}</div>
      )}
    </>
  )
}
