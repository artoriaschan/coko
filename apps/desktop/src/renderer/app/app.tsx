import { createTranslator } from '@coko/i18n'
import { AppFrame, SIDEBAR_DEFAULT_WIDTH, Toaster, TooltipProvider } from '@coko/ui'
import * as React from 'react'
import type { ChatStore } from '../stores/chat-store.ts'
import type { SettingsStore } from '../stores/settings-store.ts'
import type { AppearanceStore } from './appearance-store.ts'
import { ChatStoreProvider } from './chat.tsx'
import type { ConnectionStore } from './connection-store.ts'
import { ConversationPane } from '../features/conversation/conversation-pane.tsx'
import { RightPanel } from '../features/right-panel/right-panel.tsx'
import { SettingsDialog } from '../features/settings/settings-dialog.tsx'
import { Sidebar } from '../features/sidebar/sidebar.tsx'
import { SidebarRail } from '../features/sidebar/sidebar-rail.tsx'
import { I18nProvider, useI18n } from './i18n.tsx'
import type { Preferences } from './preferences.ts'
import type { SettingsDialogStore } from './settings-dialog-store.ts'
import { SettingsProvider } from './settings.tsx'

export interface AppProps {
  store: AppearanceStore
  connection: ConnectionStore
  chat: ChatStore
  settings: SettingsStore
  preferences: Preferences
  settingsDialog: SettingsDialogStore
  /** 目录选择（preload 提供）；取消时为 null。 */
  pickDirectory: () => Promise<string | null>
}

export function App({ store, connection, chat, settings, preferences, settingsDialog, pickDirectory }: AppProps) {
  const { theme, locale } = React.useSyncExternalStore(store.subscribe, store.getSnapshot)
  const connectionState = React.useSyncExternalStore(connection.subscribe, connection.getSnapshot)

  // 主题类与文档语言属于 document 级外部状态，在绘制前同步。
  React.useLayoutEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en'
  }, [theme, locale])

  // ⌘, / Ctrl+, 打开设置（输入法组合期间不响应）。
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.key !== ',' || !(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return
      event.preventDefault()
      settingsDialog.show()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [settingsDialog])

  const [sidebarWidth, setSidebarWidth] = React.useState(SIDEBAR_DEFAULT_WIDTH)
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false)
  const [rightOpen, setRightOpen] = React.useState(false)

  const onAddWorkspace = () => void chat.getState().addWorkspace(pickDirectory)

  return (
    <I18nProvider locale={locale}>
      <ChatStoreProvider store={chat}>
        <SettingsProvider store={settings} dialog={settingsDialog} preferences={preferences}>
          <TooltipProvider>
            <Frame
              sidebarWidth={sidebarWidth}
              onSidebarWidthChange={setSidebarWidth}
              sidebarCollapsed={sidebarCollapsed}
              onSidebarCollapsedChange={setSidebarCollapsed}
              rightOpen={rightOpen}
              sidebar={<Sidebar onAddWorkspace={onAddWorkspace} />}
              rail={<SidebarRail onAddWorkspace={onAddWorkspace} />}
              rightPanel={<RightPanel onClose={() => setRightOpen(false)} />}
            >
              <ConversationPane
                theme={theme}
                rightOpen={rightOpen}
                onToggleRight={() => setRightOpen((open) => !open)}
                connection={connectionState}
                onAddWorkspace={onAddWorkspace}
              />
            </Frame>
            <SettingsDialog theme={theme} />
            <Toaster theme={theme} containerAriaLabel={createTranslator(locale)('toast.region')} />
          </TooltipProvider>
        </SettingsProvider>
      </ChatStoreProvider>
    </I18nProvider>
  )
}

/** 注入已本地化的框架无障碍名称。 */
function Frame(props: Omit<React.ComponentProps<typeof AppFrame>, 'labels'>) {
  const { t } = useI18n()
  const labels = React.useMemo(
    () => ({ sidebar: t('sidebar.label'), main: t('frame.main'), rightPanel: t('frame.rightPanel'), resizeSidebar: t('sidebar.resize') }),
    [t],
  )
  return <AppFrame {...props} labels={labels} />
}
