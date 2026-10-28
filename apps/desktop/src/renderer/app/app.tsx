import { createTranslator, type Locale } from '@coko/i18n'
import { AppFrame, SIDEBAR_DEFAULT_WIDTH, Toaster, TooltipProvider, toast } from '@coko/ui'
import * as React from 'react'
import type { ChatStore } from '../stores/chat-store.ts'
import type { AppearanceStore } from './appearance-store.ts'
import { ChatStoreProvider } from './chat.tsx'
import type { ConnectionStore } from './connection-store.ts'
import { AppearanceMenu } from '../features/appearance/appearance-menu.tsx'
import { ConversationPane } from '../features/conversation/conversation-pane.tsx'
import { RightPanel } from '../features/right-panel/right-panel.tsx'
import { Sidebar } from '../features/sidebar/sidebar.tsx'
import { SidebarRail } from '../features/sidebar/sidebar-rail.tsx'
import { I18nProvider, useI18n } from './i18n.tsx'

export interface AppProps {
  store: AppearanceStore
  connection: ConnectionStore
  chat: ChatStore
  /** 目录选择（preload 提供）；取消时为 null。 */
  pickDirectory: () => Promise<string | null>
}

export function App({ store, connection, chat, pickDirectory }: AppProps) {
  const { theme, locale } = React.useSyncExternalStore(store.subscribe, store.getSnapshot)
  const connectionState = React.useSyncExternalStore(connection.subscribe, connection.getSnapshot)

  // 主题类与文档语言属于 document 级外部状态，在绘制前同步。
  React.useLayoutEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en'
  }, [theme, locale])

  const [sidebarWidth, setSidebarWidth] = React.useState(SIDEBAR_DEFAULT_WIDTH)
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false)
  const [rightOpen, setRightOpen] = React.useState(false)

  const onLocaleChange = (next: Locale) => {
    if (next === locale) return
    store.setLocale(next)
    toast.success(createTranslator(next)('appearance.localeChanged'))
  }
  const onAddWorkspace = () => void chat.getState().addWorkspace(pickDirectory)

  const appearanceMenu = <AppearanceMenu theme={theme} onThemeChange={store.setTheme} onLocaleChange={onLocaleChange} />

  return (
    <I18nProvider locale={locale}>
      <ChatStoreProvider store={chat}>
        <TooltipProvider>
          <Frame
            sidebarWidth={sidebarWidth}
            onSidebarWidthChange={setSidebarWidth}
            sidebarCollapsed={sidebarCollapsed}
            onSidebarCollapsedChange={setSidebarCollapsed}
            rightOpen={rightOpen}
            sidebar={<Sidebar onAddWorkspace={onAddWorkspace} footer={appearanceMenu} />}
            rail={<SidebarRail onAddWorkspace={onAddWorkspace} footer={appearanceMenu} />}
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
          <Toaster theme={theme} containerAriaLabel={createTranslator(locale)('toast.region')} />
        </TooltipProvider>
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
