import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { playwright } from '@vitest/browser-playwright'
import { defineProject } from 'vitest/config'
import { readFileSync } from 'node:fs'

// renderer 的 Vitest Browser Mode 项目；renderer 源码由 src/renderer/tsconfig.json 单独类型检查。
export default defineProject({
  plugins: [react(), tailwindcss()],
  // 与 src/renderer/vite.config.ts 一致：应用版本注入 renderer。
  define: { __COKO_VERSION__: JSON.stringify((JSON.parse(readFileSync(new URL('package.json', import.meta.url), 'utf8')) as { version: string }).version) },
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
