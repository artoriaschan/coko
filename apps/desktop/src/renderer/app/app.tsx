import { createTranslator } from '@coko/i18n'
import { AppFrame, applyTheme, cn, SIDEBAR_DEFAULT_WIDTH, Toaster, TooltipProvider } from '@coko/ui'
import * as React from 'react'
import type { ChatStore } from '../stores/chat-store.ts'
import type { SettingsStore } from '../stores/settings-store.ts'
import type { AppearanceStore } from './appearance-store.ts'
import { ChatStoreProvider } from './chat.tsx'
import type { ConnectionStore } from './connection-store.ts'
import type { ComposerHandle } from '../features/conversation/composer.tsx'
import { ConversationPane } from '../features/conversation/conversation-pane.tsx'
import { RightPanel } from '../features/right-panel/right-panel.tsx'
import { SettingsPage } from '../features/settings/settings-page.tsx'
import { ConversationSearch } from '../features/sidebar/conversation-search.tsx'
import { Sidebar } from '../features/sidebar/sidebar.tsx'
import { SidebarRail } from '../features/sidebar/sidebar-rail.tsx'
import { ProjectDialogsProvider, useCreateProject } from '../features/projects/project-dialogs.tsx'
import { I18nProvider, useI18n } from './i18n.tsx'
import type { Preferences } from './preferences.ts'
import type { SettingsPageStore } from './settings-page-store.ts'
import { SettingsProvider } from './settings.tsx'
import { createWorkbenchNavigation } from './workbench-navigation.ts'
import { WorkbenchNavigationContext, WorkbenchPage } from './workbench.tsx'

export interface AppProps {
  store: AppearanceStore
  connection: ConnectionStore
  chat: ChatStore
  settings: SettingsStore
  preferences: Preferences
  settingsPage: SettingsPageStore
  /** 目录选择（preload 提供）；取消时为 null。 */
  pickDirectory: () => Promise<string | null>
  /** 打开日志文件夹（preload 提供）；桥接不可用时为 undefined。 */
  openLogs?: (() => void) | undefined
}

export function App({ store, connection, chat, settings, preferences, settingsPage, pickDirectory, openLogs }: AppProps) {
  const { theme, locale } = React.useSyncExternalStore(store.subscribe, store.getSnapshot)
  const connectionState = React.useSyncExternalStore(connection.subscribe, connection.getSnapshot)

  // 主题类与文档语言属于 document 级外部状态，在绘制前同步。
  React.useLayoutEffect(() => {
    applyTheme(theme)
    document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en'
  }, [theme, locale])

  const navigation = React.useMemo(() => createWorkbenchNavigation(chat), [chat])
  React.useEffect(() => navigation.connect(), [navigation])
  const { location, focusRevision } = React.useSyncExternalStore(navigation.subscribe, navigation.getSnapshot)
  const contentPage = location.kind === 'plugins' || location.kind === 'schedules' ? location.kind : null

  const composer = React.useRef<ComposerHandle>(null)
  const { visible: settingsVisible } = React.useSyncExternalStore(settingsPage.subscribe, settingsPage.getSnapshot)
  React.useEffect(() => {
    if (location.kind === 'new-chat' && !settingsVisible) composer.current?.focus()
  }, [location.kind, focusRevision, settingsVisible])

  // 打开设置前记下焦点所在（store 通知先于渲染，应用尚未 inert），返回应用后焦点回到那里。
  const returnFocus = React.useRef<HTMLElement | null>(null)
  React.useEffect(() => {
    let wasVisible = settingsPage.getSnapshot().visible
    return settingsPage.subscribe(() => {
      const { visible } = settingsPage.getSnapshot()
      if (visible && !wasVisible) returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      wasVisible = visible
    })
  }, [settingsPage])
  React.useLayoutEffect(() => {
    if (settingsVisible) return
    const target = returnFocus.current
    returnFocus.current = null
    if (target?.isConnected) target.focus()
  }, [settingsVisible])

  // 全局快捷键（输入法组合期间不响应）：⌘, / Ctrl+, 打开或关闭设置；⌘N / Ctrl+N 新建会话；Escape 返回应用或停止 Run。
  // Escape 已被弹窗、菜单或 composer 处理（defaultPrevented）或有弹层打开时只关闭弹层；设置打开时 Escape 返回应用，不停止 Run。
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing) return
      const command = (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey
      if (command && event.key === ',') {
        event.preventDefault()
        settingsPage.toggle()
      } else if (command && event.key.toLowerCase() === 'n') {
        event.preventDefault()
        settingsPage.back()
        navigation.newChat()
        // 草稿渲染后再聚焦。
        requestAnimationFrame(() => composer.current?.focus())
      } else if (event.key === 'Escape' && !command && !event.defaultPrevented) {
        // 应用隐藏（inert）时其中的抽屉等不算打开的弹层。
        const layers = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"], [role="menu"]')]
        if (layers.some((layer) => !layer.closest('[inert]'))) return
        if (settingsPage.getSnapshot().visible) return settingsPage.back()
        const { activeSessionId, conversations } = chat.getState()
        if (activeSessionId !== null && conversations[activeSessionId]?.running) void chat.getState().stop()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [settingsPage, chat, pickDirectory, navigation])

  const [sidebarWidth, setSidebarWidth] = React.useState(SIDEBAR_DEFAULT_WIDTH)
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false)
  const [rightOpen, setRightOpen] = React.useState(false)
  const [search, setSearch] = React.useState<string | null>(null)

  return (
    <I18nProvider locale={locale}>
      <ChatStoreProvider store={chat}>
        <SettingsProvider store={settings} page={settingsPage} preferences={preferences}>
          <WorkbenchNavigationContext.Provider value={navigation}>
            <TooltipProvider>
              <ProjectDialogsProvider pickDirectory={pickDirectory}>
                <div className="relative h-full w-full overflow-hidden rounded-panel [clip-path:border-box]">
                  {/* 设置打开时应用隐藏但不卸载：草稿、滚动位置与进行中的 Run 保持；inert 使其不能聚焦或点击。 */}
                  <div className={cn('h-full w-full', settingsVisible && 'invisible')} inert={settingsVisible || undefined}>
                    <Frame
                      sidebarWidth={sidebarWidth}
                      onSidebarWidthChange={setSidebarWidth}
                      sidebarCollapsed={sidebarCollapsed}
                      onSidebarCollapsedChange={setSidebarCollapsed}
                      rightOpen={rightOpen && contentPage === null}
                      sidebar={<ProjectSidebar search={search} onSearchChange={setSearch} />}
                      rail={<ProjectRail onSearch={() => setSearch((current) => current ?? '')} />}
                      rightPanel={<RightPanel onClose={() => setRightOpen(false)} />}
                    >
                      <div
                        hidden={contentPage !== null}
                        inert={contentPage !== null || undefined}
                        className={cn('min-h-0 flex-1 flex-col', contentPage === null ? 'flex' : 'hidden')}
                      >
                        <ConversationPane
                          theme={theme}
                          rightOpen={rightOpen && contentPage === null}
                          onToggleRight={() => setRightOpen((open) => !open)}
                          connection={connectionState}
                          onAddWorkspace={() => {}}
                          onOpenLogs={openLogs}
                          composerRef={composer}
                        />
                      </div>
                      {contentPage && <WorkbenchPage section={contentPage} theme={theme} />}
                    </Frame>
                  </div>
                  <ConversationSearch open={search !== null} onOpenChange={(open) => setSearch(open ? '' : null)} />
                  <SettingsPage theme={theme} />
                </div>
                <Toaster theme={theme} containerAriaLabel={createTranslator(locale)('toast.region')} />
              </ProjectDialogsProvider>
            </TooltipProvider>
          </WorkbenchNavigationContext.Provider>
        </SettingsProvider>
      </ChatStoreProvider>
    </I18nProvider>
  )
}

function ProjectSidebar(props: Omit<React.ComponentProps<typeof Sidebar>, 'onAddWorkspace'>) {
  const createProject = useCreateProject()
  return <Sidebar {...props} onAddWorkspace={() => createProject?.()} />
}
function ProjectRail({ onSearch }: { onSearch: () => void }) {
  const createProject = useCreateProject()
  return <SidebarRail onAddWorkspace={() => createProject?.()} onSearch={onSearch} />
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
