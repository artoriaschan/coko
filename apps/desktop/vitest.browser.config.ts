import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { playwright } from '@vitest/browser-playwright'
import { defineProject } from 'vitest/config'
import { readFileSync } from 'node:fs'

// renderer 的 Vitest Browser Mode 项目；renderer 源码由 src/renderer/tsconfig.json 单独类型检查。
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
      // CommonJS（后台任务输出的 SGR 解析），首次在 Jobs tab 中被发现。
      'anser',
    ],
  },
  // 与 src/renderer/vite.config.ts 一致：应用版本注入 renderer。
  define: { __COKO_VERSION__: JSON.stringify((JSON.parse(readFileSync(new URL('package.json', import.meta.url), 'utf8')) as { version: string }).version) },
  test: {
    name: 'desktop-renderer',
    include: ['src/renderer/**/*.browser.test.{ts,tsx}'],
    // 恢复 localStorage、卸载组件并断言没有遗留的模态层（aria-hidden、pointer-events）。
    setupFiles: ['src/renderer/testing/browser-setup.ts'],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' }],
    },
  },
})
