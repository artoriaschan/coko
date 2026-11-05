import { PanelStart, PanelTabs } from '@coko/ui'
import { HouseIcon, PanelRightCloseIcon } from 'lucide-react'
import { useStore } from 'zustand'
import { useChat } from '../../app/chat.tsx'
import { useI18n } from '../../app/i18n.tsx'
import { IconButton } from '../../app/icon-button.tsx'
import { closePage, getRightPanelLayout, openPage, rightPanelLayoutStore, selectPage } from './layout-store.ts'
import { RIGHT_PANEL_TABS, visibleRightPanelTabs, type RightPanelTabDefinition } from './tabs.ts'

/** 当前 Session 的单格面板；正文组件继续沿用各页面自己的状态与数据。 */
export function RightPanel({ onClose, tabs = RIGHT_PANEL_TABS }: { onClose: () => void; tabs?: readonly RightPanelTabDefinition[] }) {
  const { t } = useI18n()
  const sessionId = useChat((s) => s.activeSessionId)
  const layout = useStore(rightPanelLayoutStore, () => getRightPanelLayout(sessionId))
  if (sessionId === null) return null
  const visible = visibleRightPanelTabs(tabs)
  const current = visible.find((tab) => tab.id === layout.active)
  const pages = visible.map((tab) => ({ id: tab.id, title: t(tab.label), icon: <tab.icon aria-hidden className="size-5 shrink-0" /> }))
  const panelTabs = layout.tabs.flatMap((kind) => {
    const definition = visible.find((tab) => tab.id === kind)
    if (kind !== 'start' && !definition) return []
    const title = definition ? t(definition.label) : t('rightPanel.start')
    return [
      {
        id: kind,
        title,
        icon: definition ? <definition.icon aria-hidden className="size-3.5 shrink-0" /> : <HouseIcon aria-hidden className="size-3.5 shrink-0" />,
        closeLabel: kind === 'start' && layout.tabs.length === 1 ? undefined : t('rightPanel.closePage', { title }),
      },
    ]
  })
  return (
    <>
      <PanelTabs
        tabs={panelTabs}
        active={layout.active}
        label={t('frame.rightPanel')}
        newTabLabel={t('rightPanel.newTab')}
        onSelect={(id) => selectPage(sessionId, id)}
        onClose={(id) => closePage(sessionId, id)}
        onNewTab={layout.tabs.includes('start') ? undefined : () => openPage(sessionId, 'start')}
        controls={
          <IconButton label={t('frame.closeRightPanel')} tooltip={t('frame.collapseSidebar')} onClick={onClose}>
            <PanelRightCloseIcon />
          </IconButton>
        }
      />
      <div
        role="tabpanel"
        id="right-panel-tabpanel"
        aria-labelledby={`right-panel-tab-${layout.active}`}
        tabIndex={-1}
        className="flex min-h-0 flex-1 flex-col focus:outline-none"
      >
        {layout.active === 'start' ? (
          <PanelStart pages={pages} onOpen={(id) => openPage(sessionId, id)} />
        ) : (
          current && <current.Component sessionId={sessionId} />
        )}
      </div>
    </>
  )
}
