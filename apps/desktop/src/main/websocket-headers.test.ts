import { describe, expect, it } from 'vitest'
import { APP_ORIGIN } from './app-protocol.ts'
import { decideWebSocketHeaders } from './websocket-headers.ts'

const endpoint = { origin: 'http://127.0.0.1:51234', cookie: 'coko-session=abc' }
const base = {
  mainWebContentsId: 1,
  webContentsId: 1,
  url: 'ws://127.0.0.1:51234/api/ws',
  requestHeaders: { Origin: APP_ORIGIN, Cookie: 'forged=1', 'User-Agent': 'x' },
  endpoint,
}

describe('WebSocket 升级头注入', () => {
  it('主窗口、目标 authority 与 coko-app://app 来源：注入 cookie 与同源 Origin', () => {
    expect(decideWebSocketHeaders(base)).toEqual({
      requestHeaders: { 'User-Agent': 'x', Origin: endpoint.origin, Cookie: endpoint.cookie, 'Sec-Fetch-Site': 'same-origin' },
    })
  })

  it('其他窗口发往 sidecar 的升级被取消', () => {
    expect(decideWebSocketHeaders({ ...base, webContentsId: 2 })).toEqual({ cancel: true })
    expect(decideWebSocketHeaders({ ...base, webContentsId: undefined })).toEqual({ cancel: true })
  })

  it('主窗口中非 coko-app://app 来源的升级被取消', () => {
    expect(decideWebSocketHeaders({ ...base, requestHeaders: { Origin: 'https://evil.example' } })).toEqual({ cancel: true })
    expect(decideWebSocketHeaders({ ...base, requestHeaders: {} })).toEqual({ cancel: true })
  })

  it('非 sidecar authority 的连接原样放行，不注入凭据', () => {
    expect(decideWebSocketHeaders({ ...base, url: 'ws://127.0.0.1:9999/' })).toEqual({})
    expect(decideWebSocketHeaders({ ...base, url: 'wss://127.0.0.1:51234/api/ws' })).toEqual({})
  })

  it('sidecar 未就绪时不注入凭据', () => {
    expect(decideWebSocketHeaders({ ...base, endpoint: undefined })).toEqual({})
  })
})
