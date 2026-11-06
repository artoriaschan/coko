import { PanelAttention, PanelStart, PanelTabs } from '@coko/ui'
import { HouseIcon, MaximizeIcon, MinimizeIcon, PanelRightIcon } from 'lucide-react'
import { useStore } from 'zustand'
import { useChat, useCurrentSession } from '../../app/chat.tsx'
import { useI18n } from '../../app/i18n.tsx'
import { useSettings } from '../../app/settings.tsx'
import { IconButton } from '../../app/icon-button.tsx'
import { closeOtherPages, closePage, closePagesToRight, getRightPanelLayout, movePage, openPage, rightPanelLayoutStore, selectPage } from './layout-store.ts'
import { RIGHT_PANEL_TABS, visibleRightPanelTabs, type RightPanelTabDefinition } from './tabs.ts'

/** 当前 Session 的单格面板；正文组件继续沿用各页面自己的状态与数据。 */
export function RightPanel({
  onClose,
  tabs = RIGHT_PANEL_TABS,
  fullscreen = false,
  onToggleFullscreen,
}: {
  onClose: () => void
  tabs?: readonly RightPanelTabDefinition[]
  fullscreen?: boolean
  onToggleFullscreen?: () => void
}) {
  const { t } = useI18n()
  const diagnostics = useSettings((state) => state.developer.sessionDiagnostics)
  const sessionId = useChat((s) => s.activeSessionId)
  const attention = useStore(rightPanelLayoutStore, (state) => (state.attention?.sessionId === sessionId ? state.attention.revision : null))
  const storedLayout = useStore(rightPanelLayoutStore, () => getRightPanelLayout(sessionId))
  const session = useCurrentSession()
  const visible = visibleRightPanelTabs(tabs, diagnostics, !!session?.directory && !session.projectId)
  if (sessionId === null) return null
  const kinds = storedLayout.tabs.filter((kind) => kind === 'start' || visible.some((tab) => tab.id === kind))
  const pageKinds: typeof kinds = kinds.length ? kinds : ['start']
  const layout = { ...storedLayout, tabs: pageKinds, active: pageKinds.find((kind) => kind === storedLayout.active) ?? pageKinds[0]! }
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
        closeTooltip: layout.active === kind ? t('rightPanel.closePageShortcut', { title }) : undefined,
        closeKeyShortcuts: layout.active === kind ? 'Meta+W Control+W' : undefined,
      },
    ]
  })
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {attention !== null && <PanelAttention key={attention} />}
      <PanelTabs
        tabs={panelTabs}
        active={layout.active}
        label={t('frame.rightPanel')}
        newTabLabel={t('rightPanel.newTab')}
        onSelect={(id) => selectPage(sessionId, id)}
        onClose={(id) => closePage(sessionId, id)}
        onMove={(id, index) => movePage(sessionId, id, index)}
        reorderHint={t('rightPanel.reorderHint')}
        dragLabels={{
          instructions: t('rightPanel.reorderHint'),
          start: t('rightPanel.dragStart'),
          over: (title) => t('rightPanel.dragOver', { title }),
          end: t('rightPanel.dragEnd'),
          cancel: t('rightPanel.dragCancel'),
        }}
        menuLabels={{ close: t('rightPanel.close'), closeOthers: t('rightPanel.closeOthers'), closeRight: t('rightPanel.closeRight') }}
        onCloseOthers={(id) => closeOtherPages(sessionId, id)}
        onCloseRight={(id) => closePagesToRight(sessionId, id)}
        onNewTab={layout.tabs.includes('start') ? undefined : () => openPage(sessionId, 'start')}
        controls={
          <>
            <IconButton
              size="icon-sm"
              label={t('frame.closeRightPanel')}
              tooltip={t('rightPanel.toggleShortcut')}
              onClick={onClose}
              aria-keyshortcuts="Meta+Alt+B Control+Alt+B"
            >
              <PanelRightIcon className="size-4" strokeWidth={1} />
            </IconButton>
            {onToggleFullscreen && (
              <IconButton
                size="icon-sm"
                label={t(fullscreen ? 'rightPanel.exitFullscreen' : 'rightPanel.fullscreen')}
                onClick={onToggleFullscreen}
                aria-keyshortcuts="Meta+Alt+Enter Control+Alt+Enter"
                tooltip={t(fullscreen ? 'rightPanel.exitFullscreenShortcut' : 'rightPanel.fullscreenShortcut')}
              >
                {fullscreen ? <MinimizeIcon /> : <MaximizeIcon />}
              </IconButton>
            )}
          </>
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
    </div>
  )
}
