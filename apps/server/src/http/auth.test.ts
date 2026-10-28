import { describe, expect, it } from 'vitest'
import { createAccessAuth } from './auth.ts'

const headers = (port: number, cookie: string) => ({ host: `127.0.0.1:${port}`, cookie })
const cookieOf = (setCookie: string) => setCookie.split(';')[0]!

describe('访问认证', () => {
  it('另一个进程实例在同一 authority 上签发的 cookie 被拒绝：签名密钥只在本进程内存', () => {
    const before = createAccessAuth({ port: 40000 })
    const after = createAccessAuth({ port: 40000 })
    const cookie = cookieOf(before.exchange(before.launchToken)!)
    expect(before.isAuthenticated(headers(40000, cookie))).toBe(true)
    expect(after.isAuthenticated(headers(40000, cookie))).toBe(false)
  })

  it('cookie 绑定 authority：改端口后不再有效', () => {
    const auth = createAccessAuth({ port: 40001 })
    const cookie = cookieOf(auth.exchange(auth.launchToken)!)
    // 伪造的 authority 不同于监听地址，同一签名也不通过。
    expect(createAccessAuth({ port: 40002 }).isAuthenticated(headers(40002, cookie))).toBe(false)
    expect(auth.isAuthenticated({ ...headers(40001, cookie) })).toBe(true)
  })

  it('非字符串令牌与长度不同的令牌被拒绝且不作废令牌', () => {
    const auth = createAccessAuth({ port: 40003 })
    expect(auth.exchange(undefined)).toBeUndefined()
    expect(auth.exchange(42)).toBeUndefined()
    expect(auth.exchange(auth.launchToken.slice(1))).toBeUndefined()
    expect(auth.exchange(auth.launchToken)).toMatch(/^coko-session=/)
  })
})
