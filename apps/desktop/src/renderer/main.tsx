import './styles.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/app.tsx'
import { createAppearanceStore, defaultAppearance } from './app/appearance-store.ts'
import { createConnectionStore } from './app/connection-store.ts'
import { connect } from './client/connection.ts'

const root = document.getElementById('root')
if (!root) throw new Error('renderer: missing #root')

// 连接在 React 之外建立，StrictMode 的 effect 重放不会重复连接；window.coko 只在 coko-app://app 主窗口中存在。
const connection = createConnectionStore()
connect(window.coko, connection.set)

createRoot(root).render(
  <StrictMode>
    <App store={createAppearanceStore(defaultAppearance())} connection={connection} />
  </StrictMode>,
)
