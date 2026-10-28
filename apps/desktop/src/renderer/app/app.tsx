import { createTranslator } from '@coko/i18n'
import { AppFrame, SIDEBAR_DEFAULT_WIDTH, Toaster, TooltipProvider } from '@coko/ui'
import * as React from 'react'
import type { ChatStore } from '../stores/chat-store.ts'
import type { SettingsStore } from '../stores/settings-store.ts'
import type { AppearanceStore } from './appearance-store.ts'
import { ChatStoreProvider } from './chat.tsx'
import type { ConnectionStore } from './connection-store.ts'
import type { ComposerHandle } from '../features/conversation/composer.tsx'
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
  /** 打开日志文件夹（preload 提供）；桥接不可用时为 undefined。 */
  openLogs?: (() => void) | undefined
}

export function App({ store, connection, chat, settings, preferences, settingsDialog, pickDirectory, openLogs }: AppProps) {
  const { theme, locale } = React.useSyncExternalStore(store.subscribe, store.getSnapshot)
  const connectionState = React.useSyncExternalStore(connection.subscribe, connection.getSnapshot)

  // 主题类与文档语言属于 document 级外部状态，在绘制前同步。
  React.useLayoutEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en'
  }, [theme, locale])

  const composer = React.useRef<ComposerHandle>(null)

  // 全局快捷键（输入法组合期间不响应）：⌘, / Ctrl+, 打开设置；⌘N / Ctrl+N 新建会话；Run 进行中 Escape 停止。
  // Escape 已被对话框、菜单或 composer 处理（defaultPrevented）或有弹层打开时不停止：对话框打开时 Escape 只关闭对话框。
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing) return
      const command = (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey
      if (command && event.key === ',') {
        event.preventDefault()
        settingsDialog.show()
      } else if (command && event.key.toLowerCase() === 'n') {
        event.preventDefault()
        if (chat.getState().workspaces.length === 0) {
          void chat.getState().addWorkspace(pickDirectory)
          return
        }
        settingsDialog.close()
        chat.getState().startDraft()
        // 草稿渲染后再聚焦。
        requestAnimationFrame(() => composer.current?.focus())
      } else if (event.key === 'Escape' && !command && !event.defaultPrevented) {
        if (document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]')) return
        const { activeSessionId, conversations } = chat.getState()
        if (activeSessionId !== null && conversations[activeSessionId]?.running) void chat.getState().stop()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [settingsDialog, chat, pickDirectory])

  const [sidebarWidth, setSidebarWidth] = React.useState(SIDEBAR_DEFAULT_WIDTH)
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false)
  const [rightOpen, setRightOpen] = React.useState(false)
  const [search, setSearch] = React.useState<string | null>(null)

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
              sidebar={<Sidebar onAddWorkspace={onAddWorkspace} search={search} onSearchChange={setSearch} />}
              rail={<SidebarRail onAddWorkspace={onAddWorkspace} onSearch={() => setSearch((current) => current ?? '')} />}
              rightPanel={<RightPanel onClose={() => setRightOpen(false)} />}
            >
              <ConversationPane
                theme={theme}
                rightOpen={rightOpen}
                onToggleRight={() => setRightOpen((open) => !open)}
                connection={connectionState}
                onAddWorkspace={onAddWorkspace}
                onOpenLogs={openLogs}
                composerRef={composer}
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
