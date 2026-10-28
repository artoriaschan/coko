import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// renderer 的 Vite 入口：开发服务器（pnpm --filter @coko/desktop dev:renderer）与生产构建共用。
export default defineConfig({
  root: import.meta.dirname,
  base: './',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
  },
})
