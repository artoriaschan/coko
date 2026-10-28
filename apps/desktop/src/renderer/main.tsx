import './styles.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/app.tsx'
import { createAppearanceStore, defaultAppearance } from './app/appearance-store.ts'
import { notifyFailure } from './app/chat-failure.ts'
import { createConnectionStore } from './app/connection-store.ts'
import { createApiClient } from './client/api.ts'
import { connect } from './client/connection.ts'
import { createChatStore } from './stores/chat-store.ts'

const root = document.getElementById('root')
if (!root) throw new Error('renderer: missing #root')

// 连接与 store 在 React 之外建立，StrictMode 的 effect 重放不会重复连接；window.coko 只在 coko-app://app 主窗口中存在。
const appearance = createAppearanceStore(defaultAppearance())
const connection = createConnectionStore()
const stream = connect({ bridge: window.coko, onState: connection.set })
const chat = createChatStore({
  api: createApiClient(),
  stream,
  onFailure: (failure) => notifyFailure(appearance.getSnapshot().locale, failure),
})
const pickDirectory = () => window.coko?.pickDirectory() ?? Promise.resolve(null)

createRoot(root).render(
  <StrictMode>
    <App store={appearance} connection={connection} chat={chat} pickDirectory={pickDirectory} />
  </StrictMode>,
)
