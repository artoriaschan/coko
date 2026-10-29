// streamable HTTP MCP 测试 Server（node:http，同进程启动）：POST 返回 application/json 的 JSON-RPC 响应，通知 202，GET 405（无服务端流）。
// 收到的请求头记入 headers，tools/call 的 params 记入 calls。
import { createServer, type IncomingHttpHeaders } from 'node:http'
import { handle } from './server-core.ts'

export interface HttpFixture {
  url: string
  calls: Record<string, unknown>[]
  headers: IncomingHttpHeaders[]
  close(): Promise<void>
}

export async function startHttpFixture(options: { name?: string; env?: NodeJS.ProcessEnv } = {}): Promise<HttpFixture> {
  const calls: Record<string, unknown>[] = []
  const headers: IncomingHttpHeaders[] = []
  const server = createServer((req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(405).end()
      return
    }
    headers.push(req.headers)
    let body = ''
    req.setEncoding('utf8').on('data', (chunk: string) => (body += chunk))
    req.on('end', () => {
      const message = JSON.parse(body) as Record<string, unknown>
      if (message.method === 'tools/call') calls.push(message.params as Record<string, unknown>)
      void handle(message, { name: options.name ?? 'http-fixture' }, options.env ?? {}).then((response) => {
        if (!response) {
          res.writeHead(202).end()
          return
        }
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(response))
      })
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as { port: number }
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    calls,
    headers,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}
