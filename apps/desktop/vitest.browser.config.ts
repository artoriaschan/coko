import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { playwright } from '@vitest/browser-playwright'
import { defineProject } from 'vitest/config'

// renderer 的 Vitest Browser Mode 项目；renderer 源码由 src/renderer/tsconfig.json 单独类型检查。
export default defineProject({
  plugins: [react(), tailwindcss()],
  test: {
    name: 'desktop-renderer',
    include: ['src/renderer/**/*.browser.test.{ts,tsx}'],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' }],
    },
  },
})
