import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { IncomingHttpHeaders } from 'node:http'
import { SESSION_COOKIE_NAME } from '@coko/logging'

/**
 * 本地服务访问认证（ADR 0002）：一次性启动令牌 → 绑定 authority 的 HMAC 签名 cookie；签名密钥只在进程内存。
 * 信任围栏与 cookie 校验都只读原始请求头。
 */
export interface AccessAuth {
  /** 32 字节随机令牌的 base64url；只经启动 IPC 交给 main。 */
  readonly launchToken: string
  /** 监听 authority，例如 127.0.0.1:51234。 */
  readonly authority: string
  /** 令牌正确且尚未交换时返回 Set-Cookie 值并作废令牌；否则返回 undefined。 */
  exchange(token: unknown): string | undefined
  /** Host / Origin / sec-fetch-site 信任围栏；失败应返回 403。 */
  isTrusted(headers: IncomingHttpHeaders): boolean
  /** cookie 由本进程签发且绑定当前 authority；失败应返回 401。 */
  isAuthenticated(headers: IncomingHttpHeaders): boolean
}

const header = (headers: IncomingHttpHeaders, name: string): string | undefined => {
  const value = headers[name]
  return Array.isArray(value) ? value[0] : value
}

function equalBytes(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b)
}

export function createAccessAuth(options: { port: number; host?: '127.0.0.1' }): AccessAuth {
  const host = options.host ?? '127.0.0.1'
  const authority = `${host}:${options.port}`
  const origin = `http://${authority}`
  const secret = randomBytes(32)
  const launchToken = randomBytes(32).toString('base64url')
  let pending: Buffer | undefined = Buffer.from(launchToken)

  const sign = (body: string) => createHmac('sha256', secret).update(body).digest()

  const issue = (): string => {
    const body = Buffer.from(JSON.stringify({ authority, issuedAt: Date.now() })).toString('base64url')
    const value = `v1.${body}.${sign(body).toString('base64url')}`
    return `${SESSION_COOKIE_NAME}=${value}; HttpOnly; SameSite=Strict; Path=/`
  }

  const cookieValue = (raw: string | undefined): string | undefined => {
    if (raw === undefined) return undefined
    for (const part of raw.split(';')) {
      const at = part.indexOf('=')
      if (at > 0 && part.slice(0, at).trim() === SESSION_COOKIE_NAME) return part.slice(at + 1).trim()
    }
    return undefined
  }

  return {
    launchToken,
    authority,
    exchange(token) {
      if (pending === undefined || typeof token !== 'string') return undefined
      if (!equalBytes(Buffer.from(token), pending)) return undefined
      pending = undefined
      return issue()
    },
    isTrusted(headers) {
      if (header(headers, 'host') !== authority) return false
      if (header(headers, 'sec-fetch-site') === 'cross-site') return false
      const requestOrigin = header(headers, 'origin')
      return requestOrigin === undefined || requestOrigin === origin
    },
    isAuthenticated(headers) {
      const value = cookieValue(header(headers, 'cookie'))
      if (value === undefined) return false
      const [version, body, signature, ...rest] = value.split('.')
      if (version !== 'v1' || !body || !signature || rest.length > 0) return false
      if (!equalBytes(Buffer.from(signature, 'base64url'), sign(body))) return false
      try {
        const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { authority?: unknown }
        return payload.authority === authority
      } catch {
        return false
      }
    },
  }
}
