import { Value } from 'typebox/value'
import { describe, expect, it } from 'vitest'
import { MainToSidecarMessage, SidecarToMainMessage } from './control.ts'

// 32 字节随机数的 base64url 编码，43 个字符。
const token = 'q2Jx3bL8kV0fT1rN9sYwZc4uPaHdGe5mKi7oQjXlR6E'

describe('Sidecar 控制 IPC', () => {
  it.each([
    { type: 'starting' },
    { type: 'ready', port: 51234, token },
    { type: 'fatal', code: 'storage-corrupt', message: '数据库损坏，已隔离' },
    { type: 'shutdown-complete' },
    { type: 'inspect-quit.result', requestId: 1, activeRuns: 2 },
    { type: 'credential.decrypt', requestId: 3, ciphertext: 'AAEC/w==' },
    { type: 'credential.store.result', requestId: 4, ok: true },
    { type: 'credential.store.result', requestId: 4, ok: false, error: 'provider not found' },
  ])('接受 sidecar 发往 main 的合法消息 %j', (message) => {
    expect(Value.Check(SidecarToMainMessage, message)).toBe(true)
  })

  it.each([
    { type: 'ready', port: 0, token },
    { type: 'ready', port: 70000, token },
    { type: 'ready', port: '51234', token },
    { type: 'ready', port: 51234, token: 'short' },
    { type: 'ready', port: 51234, token, extra: true },
    { type: 'fatal', code: '', message: 'x' },
    { type: 'inspect-quit.result', requestId: 0, activeRuns: 0 },
    { type: 'inspect-quit.result', requestId: 1, activeRuns: -1 },
    { type: 'credential.decrypt', requestId: 1, ciphertext: '' },
    { type: 'credential.decrypt', requestId: 1, ciphertext: 'not base64!' },
    { type: 'unknown' },
    null,
    'ready',
  ])('拒绝端口越界、令牌格式错误、多余字段与未知类型 %j', (message) => {
    expect(Value.Check(SidecarToMainMessage, message)).toBe(false)
  })

  it('接受 main 发往 sidecar 的 shutdown 与 inspect-quit，拒绝缺少 requestId 的询问', () => {
    expect(Value.Check(MainToSidecarMessage, { type: 'shutdown' })).toBe(true)
    expect(Value.Check(MainToSidecarMessage, { type: 'inspect-quit', requestId: 7 })).toBe(true)
    expect(Value.Check(MainToSidecarMessage, { type: 'inspect-quit' })).toBe(false)
  })

  it('credential.store 只携带密文与末四位提示；decrypt.result 二选一给出明文或错误', () => {
    expect(Value.Check(MainToSidecarMessage, { type: 'credential.store', requestId: 1, providerId: 'p1', ciphertext: 'AAEC', hint: 'abcd' })).toBe(true)
    expect(
      Value.Check(MainToSidecarMessage, { type: 'credential.store', requestId: 1, providerId: 'p1', ciphertext: 'AAEC', hint: 'abcd', plaintext: 'sk-x' }),
    ).toBe(false)
    expect(Value.Check(MainToSidecarMessage, { type: 'credential.store', requestId: 1, providerId: 'p1', ciphertext: 'AAEC', hint: 'abcde' })).toBe(false)
    expect(Value.Check(MainToSidecarMessage, { type: 'credential.decrypt.result', requestId: 2, plaintext: 'sk-x' })).toBe(true)
    expect(Value.Check(MainToSidecarMessage, { type: 'credential.decrypt.result', requestId: 2, error: 'safeStorage unavailable' })).toBe(true)
    expect(Value.Check(MainToSidecarMessage, { type: 'credential.decrypt.result', requestId: 2 })).toBe(false)
  })
})
