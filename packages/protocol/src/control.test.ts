import { Value } from 'typebox/value'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRequestTracker, MainToSidecarMessage, RequestTimeoutError, SidecarToMainMessage } from './control.ts'

// 32 字节随机数的 base64url 编码，43 个字符。
const token = 'q2Jx3bL8kV0fT1rN9sYwZc4uPaHdGe5mKi7oQjXlR6E'

const fields = {
  id: 'custom-provider-1',
  name: '自定义供应商一',
  api: 'openai-completions',
  baseUrl: 'https://gateway.example/v1',
  models: [{ id: 'custom-model-1', name: '', contextWindow: 128_000, maxTokens: 16_000, input: ['text'], reasoning: false, thinkingLevels: [] }],
}
const savedProvider = { ...fields, credential: { hint: 'abcd' }, createdAt: 1, updatedAt: 1 }

describe('Sidecar 控制 IPC', () => {
  it.each([
    { type: 'starting' },
    { type: 'ready', port: 51234, token },
    { type: 'fatal', code: 'storage-corrupt', message: '数据库损坏，已隔离' },
    { type: 'shutdown-complete' },
    { type: 'inspect-quit.result', requestId: 1, activeRuns: 2 },
    { type: 'credential.decrypt', requestId: 3, ciphertext: 'AAEC/w==' },
    { type: 'provider.save.result', requestId: 4, ok: true, provider: savedProvider },
    { type: 'provider.save.result', requestId: 4, ok: false, error: { code: 'already-exists', message: 'in use', details: { field: 'id', id: 'p1' } } },
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
    { type: 'credential.store.result', requestId: 4, ok: true },
    { type: 'provider.save.result', requestId: 4, ok: false, error: { code: 'nope', message: 'x' } },
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

  it('provider.save 一条消息携带完整配置与可选的密文和末四位提示（ADR 0010）；不接受明文；单独的 credential.store 已移除', () => {
    const save = { type: 'provider.save', requestId: 1, mode: 'create', provider: fields }
    expect(Value.Check(MainToSidecarMessage, save)).toBe(true)
    expect(Value.Check(MainToSidecarMessage, { ...save, mode: 'update', credential: { ciphertext: 'AAEC', hint: 'abcd' } })).toBe(true)
    expect(Value.Check(MainToSidecarMessage, { ...save, mode: 'upsert' })).toBe(false)
    expect(Value.Check(MainToSidecarMessage, { ...save, credential: { ciphertext: 'AAEC', hint: 'abcde' } })).toBe(false)
    expect(Value.Check(MainToSidecarMessage, { ...save, credential: { ciphertext: 'AAEC', hint: 'abcd', plaintext: 'sk-x' } })).toBe(false)
    expect(Value.Check(MainToSidecarMessage, { ...save, secret: 'sk-x' })).toBe(false)
    expect(Value.Check(MainToSidecarMessage, { ...save, provider: { ...fields, id: 'Bad' } })).toBe(false)
    expect(Value.Check(MainToSidecarMessage, { type: 'credential.store', requestId: 1, providerId: 'p1', ciphertext: 'AAEC', hint: 'abcd' })).toBe(false)
    expect(Value.Check(MainToSidecarMessage, { type: 'credential.decrypt.result', requestId: 2, plaintext: 'sk-x' })).toBe(true)
    expect(Value.Check(MainToSidecarMessage, { type: 'credential.decrypt.result', requestId: 2, error: 'safeStorage unavailable' })).toBe(true)
    expect(Value.Check(MainToSidecarMessage, { type: 'credential.decrypt.result', requestId: 2 })).toBe(false)
  })

  it('secret.store 按登记名携带密文与提示（ADR 0007）；名字必须合规；secret.decrypt 往返与 Credential 同形', () => {
    expect(Value.Check(MainToSidecarMessage, { type: 'secret.store', requestId: 1, name: 'MY_SERVICE_DSN', ciphertext: 'AAEC', hint: 'abcd' })).toBe(true)
    expect(Value.Check(MainToSidecarMessage, { type: 'secret.store', requestId: 1, name: 'my-dsn', ciphertext: 'AAEC', hint: 'abcd' })).toBe(false)
    expect(Value.Check(MainToSidecarMessage, { type: 'secret.store', requestId: 1, name: 'A', ciphertext: 'AAEC', hint: '', value: 'x' })).toBe(false)
    expect(Value.Check(MainToSidecarMessage, { type: 'secret.decrypt.result', requestId: 2, plaintext: 'v' })).toBe(true)
    expect(Value.Check(MainToSidecarMessage, { type: 'secret.decrypt.result', requestId: 2, error: 'unavailable' })).toBe(true)
    expect(Value.Check(SidecarToMainMessage, { type: 'secret.decrypt', requestId: 3, ciphertext: 'AAEC' })).toBe(true)
    expect(Value.Check(SidecarToMainMessage, { type: 'secret.store.result', requestId: 3, ok: false, error: 'invalid' })).toBe(true)
  })
})

describe('createRequestTracker', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('按 requestId 交付结果：先发出、后到达的回答结束对应的请求，与其他请求互不影响', async () => {
    const tracker = createRequestTracker<string>({ timeoutMs: 1000 })
    const sent: number[] = []
    const first = tracker.request((id) => sent.push(id))
    const second = tracker.request((id) => sent.push(id))
    expect(sent).toEqual([1, 2])
    expect(tracker.size).toBe(2)
    expect(tracker.resolve(2, 'two')).toBe(true)
    expect(tracker.reject(1, new Error('one failed'))).toBe(true)
    await expect(second).resolves.toBe('two')
    await expect(first).rejects.toThrow('one failed')
    // 已结束或未知的 id 不再交付。
    expect(tracker.resolve(1, 'late')).toBe(false)
    expect(tracker.resolve(99, 'unknown')).toBe(false)
    expect(tracker.size).toBe(0)
  })

  it('超时以 RequestTimeoutError 结束并移除挂起项；之后到达的回答被忽略', async () => {
    vi.useFakeTimers()
    const tracker = createRequestTracker<number>({ timeoutMs: 50, timeoutMessage: (ms) => `no answer within ${ms} ms` })
    let requestId = 0
    const pending = tracker.request((id) => {
      requestId = id
    })
    const outcome = pending.then(
      () => 'resolved',
      (error: unknown) => error,
    )
    await vi.advanceTimersByTimeAsync(49)
    expect(tracker.size).toBe(1)
    await vi.advanceTimersByTimeAsync(1)
    const error = await outcome
    expect(error).toBeInstanceOf(RequestTimeoutError)
    expect(error).toMatchObject({ message: 'no answer within 50 ms', timeoutMs: 50 })
    expect(tracker.size).toBe(0)
    expect(tracker.resolve(requestId, 1)).toBe(false)
  })

  it('rejectAll 以给定错误立即结束全部挂起请求，并清掉它们的计时器', async () => {
    vi.useFakeTimers()
    const tracker = createRequestTracker<number>({ timeoutMs: 10_000 })
    const requests = [tracker.request(() => {}), tracker.request(() => {}), tracker.request(() => {})]
    const disconnected = new Error('Desktop app disconnected')
    tracker.rejectAll(disconnected)
    for (const request of requests) await expect(request).rejects.toBe(disconnected)
    expect(tracker.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
    // 之后的新请求照常工作。
    const next = tracker.request((id) => queueMicrotask(() => tracker.resolve(id, 7)))
    await expect(next).resolves.toBe(7)
  })

  it('signal 中止时以中止原因结束；已中止的 signal 不发送请求', async () => {
    const tracker = createRequestTracker<string>({ timeoutMs: 1000 })
    const controller = new AbortController()
    const pending = tracker.request(() => {}, { signal: controller.signal })
    const reason = new Error('Run aborted')
    controller.abort(reason)
    await expect(pending).rejects.toBe(reason)
    expect(tracker.size).toBe(0)

    let sends = 0
    await expect(tracker.request(() => void sends++, { signal: AbortSignal.abort(new Error('already')) })).rejects.toThrow('already')
    expect(sends).toBe(0)
    expect(tracker.size).toBe(0)
  })

  it('发送抛错时请求以该错误结束，不留挂起项', async () => {
    const tracker = createRequestTracker<string>({ timeoutMs: 1000 })
    await expect(
      tracker.request(() => {
        throw new Error('channel closed')
      }),
    ).rejects.toThrow('channel closed')
    expect(tracker.size).toBe(0)
  })
})
