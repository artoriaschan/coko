import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { playwright } from '@vitest/browser-playwright'
import { defineProject } from 'vitest/config'

export default defineProject({
  plugins: [react(), tailwindcss()],
  // radix-ui/internal 与 sonner 只经深层导入出现，运行中才被发现会触发 Vite 重新预构建并重载测试页面。
  optimizeDeps: { include: ['radix-ui/internal', 'sonner'] },
  test: {
    name: 'ui-browser',
    include: ['src/**/*.browser.test.{ts,tsx}'],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' }],
    },
  },
})
