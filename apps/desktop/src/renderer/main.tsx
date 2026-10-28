import './styles.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/app.tsx'
import { createAppearanceStore, defaultAppearance } from './app/appearance-store.ts'

const root = document.getElementById('root')
if (!root) throw new Error('renderer: missing #root')

createRoot(root).render(
  <StrictMode>
    <App store={createAppearanceStore(defaultAppearance())} />
  </StrictMode>,
)
