import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { playwright } from '@vitest/browser-playwright'
import { defineProject } from 'vitest/config'

export default defineProject({
  plugins: [react(), tailwindcss()],
  // 深层导入（包名/子路径）运行中才被发现会触发 Vite 重新预构建并重载测试页面，整组用例失败。
  // 新增深层导入时加到这里；scripts/browser-deps.test.ts 检查两个 Browser Mode 配置都没有遗漏。
  optimizeDeps: {
    include: [
      'radix-ui/internal',
      'sonner',
      '@lexical/react/LexicalComposer',
      '@lexical/react/LexicalComposerContext',
      '@lexical/react/LexicalContentEditable',
      '@lexical/react/LexicalErrorBoundary',
      '@lexical/react/LexicalHistoryPlugin',
      '@lexical/react/LexicalPlainTextPlugin',
      '@lexical/react/LexicalTypeaheadMenuPlugin',
    ],
  },
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
