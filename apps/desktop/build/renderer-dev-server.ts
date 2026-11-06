import { createServer as createHttpServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer as createViteServer, type ViteDevServer } from 'vite'

export interface RendererDevServer {
  /** http://127.0.0.1:<port>，经环境变量 COKO_RENDERER_DEV_URL 交给 main。 */
  readonly url: string
  close(): Promise<void>
}

/** 开发服务器：先在端口 0 监听拿到实际端口，再以 middleware 模式挂载 Vite，HMR 复用同一端口。 */
export async function createRendererDevServer(configFile: string, define: Record<string, string>): Promise<RendererDevServer> {
  // Vite atomically replaces its optimizer cache. A second dev process must never
  // delete chunks referenced by a still-open renderer in the first process.
  const cacheDir = await mkdtemp(join(tmpdir(), 'coko-renderer-'))
  const http = createHttpServer()
  let vite: ViteDevServer | undefined
  const close = async () => {
    try {
      await vite?.close()
    } finally {
      http.closeAllConnections()
      try {
        if (http.listening) await new Promise<void>((resolve) => http.close(() => resolve()))
      } finally {
        await rm(cacheDir, { recursive: true, force: true })
      }
    }
  }
  try {
    await new Promise<void>((resolve, reject) => {
      http.once('error', reject)
      http.listen(0, '127.0.0.1', () => {
        http.off('error', reject)
        resolve()
      })
    })
    const address = http.address()
    if (address === null || typeof address === 'string') throw new Error('Unexpected dev server address')
    vite = await createViteServer({
      configFile,
      define,
      cacheDir,
      appType: 'spa',
      server: { middlewareMode: true, hmr: { server: http, host: '127.0.0.1', clientPort: address.port, protocol: 'ws' } },
    })
    http.on('request', vite.middlewares)
    return { url: `http://127.0.0.1:${address.port}`, close }
  } catch (error) {
    await close()
    throw error
  }
}
