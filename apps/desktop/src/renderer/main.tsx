import './styles.css'
import { createTranslator } from '@coko/i18n'
import { toast } from '@coko/ui'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/app.tsx'
import { createAppearanceStore, defaultAppearance } from './app/appearance-store.ts'
import { notifyFailure } from './app/chat-failure.ts'
import { createConnectionStore } from './app/connection-store.ts'
import { createPreferences } from './app/preferences.ts'
import { createSettingsPageStore } from './app/settings-page-store.ts'
import { createRendererLog } from './app/renderer-log.ts'
import { bindOpenSession } from './app/open-session.ts'
import { createApiClient } from './client/api.ts'
import { connect } from './client/connection.ts'
import { createChatStore } from './stores/chat-store.ts'
import { contextStore, trackCompaction } from './stores/context-store.ts'
import { createSettingsStore } from './stores/settings-store.ts'
import type { FetchProviderModelsInput, SaveProviderInput } from '../shared/bridge.ts'

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

createRoot(root).render(
  <StrictMode>
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
  </StrictMode>,
)
