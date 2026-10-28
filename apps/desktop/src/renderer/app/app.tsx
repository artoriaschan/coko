import { createTranslator, type Locale } from '@coko/i18n'
import { AppFrame, SIDEBAR_DEFAULT_WIDTH, Toaster, TooltipProvider, toast } from '@coko/ui'
import * as React from 'react'
import type { AppearanceStore } from './appearance-store.ts'
import type { ConnectionStore } from './connection-store.ts'
import { AppearanceMenu } from '../features/appearance/appearance-menu.tsx'
import { ConversationPane } from '../features/conversation/conversation-pane.tsx'
import { RightPanel } from '../features/right-panel/right-panel.tsx'
import { Sidebar } from '../features/sidebar/sidebar.tsx'
import { SidebarRail } from '../features/sidebar/sidebar-rail.tsx'
import { messages, workspaces } from './fixtures.ts'
import { I18nProvider, useI18n } from './i18n.tsx'

const allSessions = workspaces.flatMap((w) => w.sessions)

export function App({ store, connection }: { store: AppearanceStore; connection: ConnectionStore }) {
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
  const [activeSessionId, setActiveSessionId] = React.useState<string | null>(allSessions[0]?.id ?? null)

  const onLocaleChange = (next: Locale) => {
    if (next === locale) return
    store.setLocale(next)
    toast.success(createTranslator(next)('appearance.localeChanged'))
  }

  const appearanceMenu = <AppearanceMenu theme={theme} onThemeChange={store.setTheme} onLocaleChange={onLocaleChange} />
  const active = allSessions.find((s) => s.id === activeSessionId)

  return (
    <I18nProvider locale={locale}>
      <TooltipProvider>
        <Frame
          sidebarWidth={sidebarWidth}
          onSidebarWidthChange={setSidebarWidth}
          sidebarCollapsed={sidebarCollapsed}
          onSidebarCollapsedChange={setSidebarCollapsed}
          rightOpen={rightOpen}
          sidebar={<Sidebar workspaces={workspaces} activeSessionId={activeSessionId} onSelectSession={setActiveSessionId} footer={appearanceMenu} />}
          rail={<SidebarRail footer={appearanceMenu} />}
          rightPanel={<RightPanel onClose={() => setRightOpen(false)} />}
        >
          <ConversationPane
            title={active?.title ?? ''}
            messages={messages}
            theme={theme}
            rightOpen={rightOpen}
            onToggleRight={() => setRightOpen((open) => !open)}
            connection={connectionState}
          />
        </Frame>
        <Toaster theme={theme} containerAriaLabel={createTranslator(locale)('toast.region')} />
      </TooltipProvider>
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
