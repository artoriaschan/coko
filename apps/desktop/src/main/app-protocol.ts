import { readFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { API_ROUTES } from '@coko/protocol'

export const APP_SCHEME = 'coko-app'
export const APP_HOST = 'app'
/** renderer 文档的来源；协议注册为 standard 后 location.origin 与 Origin 头即为该值。 */
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`

/** main 持有的 sidecar 连接凭据。 */
export interface SidecarEndpoint {
  /** http://127.0.0.1:<port> */
  readonly origin: string
  /** 令牌交换得到的 Cookie 头值。 */
  readonly cookie: string
}

/** 生产从构建目录读取；开发转发给 Vite 开发服务器。 */
export type RendererSource = { readonly kind: 'directory'; readonly root: string } | { readonly kind: 'dev-server'; readonly url: string }

export interface AppProtocolOptions {
  readonly renderer: RendererSource
  /** 当前可用的 sidecar；未就绪或已退出时为 undefined。 */
  readonly endpoint: () => SidecarEndpoint | undefined
}

const MIME: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
}

/** 生产文档的 CSP：脚本只来自应用自身；连接只允许同源（经代理）与 loopback WebSocket。 */
export const RENDERER_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' ws://127.0.0.1:*",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ')

/** 不转发给 sidecar 的请求头：由 main 重新设置或只描述 renderer 到 main 的连接。 */
const STRIPPED_REQUEST_HEADERS = ['host', 'origin', 'cookie', 'referer', 'sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest']
/** 不返回 renderer 的响应头：set-cookie 归 main 所有；其余描述 main 到 sidecar 的 Node fetch 连接。 */
const WITHHELD_RESPONSE_HEADERS = [
  'set-cookie',
  'content-encoding',
  'content-length',
  'transfer-encoding',
  'connection',
  'keep-alive',
  'te',
  'trailer',
  'upgrade',
]
/** renderer 不能触达的 sidecar 路由。 */
const MAIN_ONLY_ROUTES = new Set<string>([API_ROUTES.authExchange])

/** coko-app:// 协议处理：/api/* 转发给 sidecar 并注入 cookie，其余为 renderer 静态资源。 */
export function createAppProtocolHandler(options: AppProtocolOptions): (request: Request) => Promise<Response> {
  return async (request) => {
    const url = new URL(request.url)
    if (url.host !== APP_HOST) return new Response(null, { status: 404 })
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return forwardToSidecar(request, url, options.endpoint())
    if (options.renderer.kind === 'dev-server') return forwardToDevServer(request, url, options.renderer.url)
    return serveDirectory(request, url, options.renderer.root)
  }
}

async function forwardToSidecar(request: Request, url: URL, endpoint: SidecarEndpoint | undefined): Promise<Response> {
  const origin = request.headers.get('origin')
  if (origin !== null && origin !== APP_ORIGIN) return new Response(null, { status: 403 })
  if (MAIN_ONLY_ROUTES.has(url.pathname)) return new Response(null, { status: 404 })
  if (endpoint === undefined) return new Response(null, { status: 503 })
  const target = new URL(url.pathname + url.search, endpoint.origin)
  const headers = new Headers(request.headers)
  for (const name of STRIPPED_REQUEST_HEADERS) headers.delete(name)
  headers.set('cookie', endpoint.cookie)
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD'
  const response = await fetch(target, {
    method: request.method,
    headers,
    body: hasBody ? request.body : undefined,
    signal: request.signal,
    redirect: 'manual',
    // 流式请求体需要 half duplex。
    ...(hasBody ? { duplex: 'half' } : {}),
  } as RequestInit)
  const outgoing = new Headers(response.headers)
  for (const name of WITHHELD_RESPONSE_HEADERS) outgoing.delete(name)
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers: outgoing })
}

async function forwardToDevServer(request: Request, url: URL, devUrl: string): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405 })
  const response = await fetch(new URL(url.pathname + url.search, devUrl), { method: request.method, signal: request.signal })
  const outgoing = new Headers(response.headers)
  for (const name of WITHHELD_RESPONSE_HEADERS) outgoing.delete(name)
  return new Response(response.body, { status: response.status, headers: outgoing })
}

async function serveDirectory(request: Request, url: URL, root: string): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405 })
  let pathname: string
  try {
    pathname = decodeURIComponent(url.pathname)
  } catch {
    return new Response(null, { status: 400 })
  }
  const directory = resolve(root)
  const target = resolve(directory, '.' + (pathname === '/' ? '/index.html' : pathname))
  if (!target.startsWith(directory + sep)) return new Response(null, { status: 403 })
  let body: Buffer
  try {
    body = await readFile(target)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'EISDIR' || code === 'ENOTDIR') return new Response(null, { status: 404 })
    throw error
  }
  const type = MIME[extname(target)] ?? 'application/octet-stream'
  const headers: Record<string, string> = { 'content-type': type, 'x-content-type-options': 'nosniff' }
  if (type.startsWith('text/html')) headers['content-security-policy'] = RENDERER_CSP
  return new Response(request.method === 'HEAD' ? null : new Uint8Array(body), { headers })
}
