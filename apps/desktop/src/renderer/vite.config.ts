import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { readFileSync } from 'node:fs'

// renderer 唯一的 Vite 配置：build/build.ts（Forge hooks、E2E globalSetup、pnpm run build）与 dev:renderer / build:renderer 脚本共用。
// renderer 由 main 经 coko-app:// 提供；相对 base 保证生产资源路径正确。
export default defineConfig({
  root: import.meta.dirname,
  base: './',
  plugins: [react(), tailwindcss()],
  // 应用版本注入 renderer（About）；vitest.browser.config.ts 同样注入。
  define: {
    __COKO_VERSION__: JSON.stringify((JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string }).version),
  },
  build: {
    outDir: fileURLToPath(new URL('../../dist/renderer', import.meta.url)),
    emptyOutDir: true,
  },
})
