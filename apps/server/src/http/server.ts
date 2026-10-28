import type { Server } from 'node:http'
import { createAdaptorServer, type HttpBindings } from '@hono/node-server'
import { WebSocketServer } from 'ws'
import type { Application } from '../application/index.ts'
import { createApp } from './app.ts'
import { createAccessAuth, type AccessAuth } from './auth.ts'

export interface HttpServer {
  readonly port: number
  readonly auth: AccessAuth
  /** 停止接受连接，以 1001 关闭 WebSocket，并等待服务器关闭。 */
  close(): Promise<void>
}

/** 只监听 127.0.0.1 的端口 0；listening 后用实际端口建立 authority 绑定的认证。 */
export async function startHttpServer(app: Application): Promise<HttpServer> {
  let handle: ((request: Request, env: HttpBindings) => Response | Promise<Response>) | undefined
  const wss = new WebSocketServer({ noServer: true })
  const sockets = new Set<{ close(code?: number, reason?: string): void }>()
  const server = createAdaptorServer({
    fetch: (request, env) => (handle ? handle(request, env as HttpBindings) : new Response(null, { status: 503 })),
    websocket: { server: wss },
  }) as Server
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Unexpected server address')
  const auth = createAccessAuth({ port: address.port })
  const hono = createApp({
    auth,
    app,
    sockets: {
      add(socket) {
        sockets.add(socket)
        return () => sockets.delete(socket)
      },
    },
  })
  handle = (request, env) => hono.fetch(request, env)

  let closing: Promise<void> | undefined
  return {
    port: address.port,
    auth,
    close: () =>
      (closing ??= new Promise<void>((resolve) => {
        for (const socket of sockets) socket.close(1001, 'Sidecar shutting down')
        server.close(() => resolve())
        server.closeAllConnections()
        wss.close()
      })),
  }
}
