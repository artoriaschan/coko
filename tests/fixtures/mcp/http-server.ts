// streamable HTTP MCP 测试 Server（node:http，同进程启动）：POST 返回 application/json 的 JSON-RPC 响应，通知 202，GET 405（无服务端流）。
// 收到的请求头记入 headers，tools/call 的 params 记入 calls，每个 POST 的 JSON-RPC 方法记入 methods（连接尝试 = initialize 的个数）。
// auth：Authorization 不等于 auth.authorization 时回 401，响应体与 WWW-Authenticate 带 auth.leak（对手用例：令牌不得进入诊断、日志与协议）；
// auth.methods 给出时只有这些方法要求认证（例如只在 tools/call 时 401）。features 同 stdio Server（MCP_FIXTURE_FEATURES）。
import { createServer, type IncomingHttpHeaders } from 'node:http'
import { handle, type CoreOptions } from './server-core.ts'

export interface HttpFixture {
  url: string
  calls: Record<string, unknown>[]
  headers: IncomingHttpHeaders[]
  methods: string[]
  /** 回了 401 的请求的方法。 */
  rejected: string[]
  close(): Promise<void>
}

export interface HttpFixtureAuth {
  /** 期望的 Authorization 请求头原文。 */
  authorization: string
  /** 401 响应体与 WWW-Authenticate 中的令牌。 */
  leak: string
  methods?: readonly string[]
}

export async function startHttpFixture(
  options: { name?: string; env?: NodeJS.ProcessEnv; auth?: HttpFixtureAuth; features?: CoreOptions['features'] } = {},
): Promise<HttpFixture> {
  const calls: Record<string, unknown>[] = []
  const headers: IncomingHttpHeaders[] = []
  const methods: string[] = []
  const rejected: string[] = []
  const { auth } = options
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
      const method = String(message.method ?? '')
      methods.push(method)
      if (auth && (auth.methods === undefined || auth.methods.includes(method)) && req.headers.authorization !== auth.authorization) {
        rejected.push(method)
        res
          .writeHead(401, {
            'content-type': 'text/plain',
            'www-authenticate': `Bearer realm="fixture", error="invalid_token", error_description="expected ${auth.leak}"`,
          })
          .end(`unauthorized: use token ${auth.leak}`)
        return
      }
      if (message.method === 'tools/call') calls.push(message.params as Record<string, unknown>)
      void handle(message, { name: options.name ?? 'http-fixture', ...(options.features ? { features: options.features } : {}) }, options.env ?? {}).then(
        (response) => {
          if (!response) {
            res.writeHead(202).end()
            return
          }
          res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(response))
        },
      )
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as { port: number }
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    calls,
    headers,
    methods,
    rejected,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}
