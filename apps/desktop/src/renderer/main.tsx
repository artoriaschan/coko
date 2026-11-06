import './styles.css'
import { createTranslator, locales, type Locale } from '@coko/i18n'
import { toast } from '@coko/ui'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import * as React from 'react'
import { createAppearanceStore, defaultAppearance, type Theme } from './app/appearance-store.ts'
import { notifyFailure } from './app/chat-failure.ts'
import { createConnectionStore } from './app/connection-store.ts'
import { createPreferences, LOCALE_SETTING, THEME_SETTING } from './app/preferences.ts'
import { createSettingsPageStore } from './app/settings-page-store.ts'
import { createRendererLog } from './app/renderer-log.ts'
import { bindOpenSession } from './app/open-session.ts'
import { StartupScreen, STARTUP_AVATAR_URL } from './app/startup-screen.tsx'
import { createApiClient } from './client/api.ts'
import { connect } from './client/connection.ts'
import { createChatStore } from './stores/chat-store.ts'
import { contextStore, trackCompaction } from './stores/context-store.ts'
import { createSettingsStore } from './stores/settings-store.ts'
import type { FetchProviderModelsInput, SaveProviderInput } from '../shared/bridge.ts'

// 工作台及其 Markdown/CSS 依赖共同就绪后才显示正文，重型插件仍留在异步 chunk。
const App = React.lazy(() => import('./app/app.tsx').then((module) => ({ default: module.App })))

const root = document.getElementById('root')
if (!root) throw new Error('renderer: missing #root')

// 连接与 store 在 React 之外建立，StrictMode 的 effect 重放不会重复连接；window.coko 只在 coko-app://app 主窗口中存在。
const log = createRendererLog(window.coko)
log.installGlobalHandlers(window)
// Sidecar 就绪前使用系统主题与语言（ADR 0003），设置加载后应用已保存的值。
const appearance = createAppearanceStore(defaultAppearance())
const t = () => createTranslator(appearance.getSnapshot().locale)
const api = createApiClient()
const connection = createConnectionStore()
const stream = connect({
  bridge: window.coko,
  onState: (state) => {
    if (state.phase === 'failed')
      log.send({ level: 'error', category: ['connection'], message: 'connection failed', properties: { code: state.code, detail: state.message } })
    connection.set(state)
  },
})
const settingsPage = createSettingsPageStore()
const chat = createChatStore({
  api,
  stream,
  onFailure: (failure) => notifyFailure(appearance.getSnapshot().locale, failure, () => settingsPage.open('models')),
  // 分叉的标题按当前语言生成，Sidecar 原样保存。
  forkTitle: (title) => t()('sidebar.forkTitle', { title: title || t()('sidebar.untitled') }),
})
// 压缩进度：输入区上方的状态行与上下文环；失败时一次 Toast，连续自动失败（熔断）时提示 /compact。
trackCompaction(contextStore, stream, (failure) =>
  toast.error(
    failure.trigger !== 'manual' && failure.consecutiveFailures >= 3
      ? t()('context.compaction.pausedHint')
      : t()('context.compaction.failed', { message: failure.message }),
  ),
)
const bridge = window.coko
const settings = createSettingsStore({
  api,
  ...(bridge
    ? {
        saveProvider: (input: SaveProviderInput) => bridge.saveProvider(input),
        providerModels: {
          fetchProviderModels: (input: FetchProviderModelsInput) => bridge.fetchProviderModels(input),
          cancelProviderModels: (requestKey: string) => bridge.cancelProviderModels(requestKey),
        },
      }
    : {}),
  onFailure: () => toast.error(t()('settings.loadFailed')),
  // 删除 Provider 后引用它的 Session 模型字段已被清空：重新读取会话列表。
  onProviderDeleted: () => void chat.getState().load(),
})
const preferences = createPreferences({
  appearance,
  settings,
  onConflict: (retry) => toast.error(t()('settings.conflict'), { action: { label: t()('settings.retry'), onClick: retry } }),
  onFailure: (_error, retry) => toast.error(t()('settings.saveFailed'), { action: { label: t()('settings.retry'), onClick: retry } }),
})
// 点击桌面通知：main 经 preload 要求打开该会话。
bindOpenSession(bridge, { openSession: (sessionId) => chat.getState().openSession(sessionId), closeSettings: () => settingsPage.back() })
// 每次（重新）连接后读取设置与 Provider。
stream.onOpen(() => void settings.getState().load())
const pickDirectory = () => window.coko?.pickDirectory() ?? Promise.resolve(null)
const openLogs = bridge
  ? () =>
      void bridge.openLogs().then((ok) => {
        if (!ok) toast.error(t()('connection.openLogsFailed'))
      })
  : undefined

/** 等设置就绪并应用已保存的语言与主题后再渲染工作台，避免首帧语言闪烁。 */
function Bootstrap() {
  const [ready, setReady] = React.useState(false)
  React.useEffect(() => {
    let cancelled = false
    let finished = false
    const finish = () => {
      if (finished || cancelled) return
      finished = true
      const values = settings.getState().values
      const locale = values[LOCALE_SETTING]?.value
      if (locales.includes(locale as Locale)) appearance.setLocale(locale as Locale)
      const theme = values[THEME_SETTING]?.value
      if (theme === 'light' || theme === 'dark') appearance.setTheme(theme as Theme)
      void Promise.all([document.fonts.ready, decodeStartupAvatar(), new Promise((resolve) => setTimeout(resolve, 300))]).then(() => {
        if (!cancelled) setReady(true)
      })
    }
    const check = () => {
      const status = settings.getState().status
      if (status === 'ready' || status === 'error') finish()
    }
    check()
    const unsubscribeSettings = settings.subscribe(check)
    const unsubscribeConnection = connection.subscribe(() => {
      if (connection.getSnapshot().phase === 'failed') finish()
    })
    // Sidecar 启动失败时不要永久停在加载屏；交给工作台展示连接错误。
    const timeout = window.setTimeout(finish, 10_000)
    return () => {
      cancelled = true
      window.clearTimeout(timeout)
      unsubscribeSettings()
      unsubscribeConnection()
    }
  }, [])
  const loading = <StartupScreen label={createTranslator(appearance.getSnapshot().locale)('startup.loading')} />
  if (!ready) return loading
  return (
    <React.Suspense fallback={loading}>
      <App
        store={appearance}
        connection={connection}
        chat={chat}
        settings={settings}
        preferences={preferences}
        settingsPage={settingsPage}
        pickDirectory={pickDirectory}
        openLogs={openLogs}
      />
    </React.Suspense>
  )
}

function decodeStartupAvatar(): Promise<void> {
  const image = new Image()
  image.src = STARTUP_AVATAR_URL
  return image.decode().catch(() => undefined)
}

createRoot(root).render(
  <StrictMode>
    <Bootstrap />
  </StrictMode>,
)
