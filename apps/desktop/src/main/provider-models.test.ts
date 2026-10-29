import type { MainToSidecarMessage, SidecarToMainMessage } from '@coko/protocol'
import { describe, expect, it, vi } from 'vitest'
import type { SidecarControlChannel } from './control-channel.ts'
import { createProviderModelsBridge } from './provider-models.ts'

/** 假控制通道：记录 main 发出的消息，可注入 sidecar 的消息。 */
function fakeChannel(options: { ready?: boolean; answer?: (message: MainToSidecarMessage) => SidecarToMainMessage | undefined } = {}) {
  const sent: MainToSidecarMessage[] = []
  const listeners = new Set<(message: SidecarToMainMessage) => void>()
  const unavailable = new Set<() => void>()
  const channel: SidecarControlChannel = {
    isReady: () => options.ready ?? true,
    send(message) {
      sent.push(message)
      const reply = options.answer?.(message)
      if (reply) queueMicrotask(() => deliver(reply))
    },
    onMessage(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    onUnavailable(listener) {
      unavailable.add(listener)
      return () => unavailable.delete(listener)
    },
  }
  const deliver = (message: SidecarToMainMessage) => {
    for (const listener of listeners) listener(message)
  }
  return { channel, sent, deliver, exit: () => unavailable.forEach((l) => l()) }
}

const list = (message: MainToSidecarMessage): SidecarToMainMessage | undefined =>
  message.type === 'provider.models'
    ? { type: 'provider.models.result', requestId: message.requestId, ok: true, models: ['custom-model-1', 'custom-model-2'] }
    : undefined

const request = { requestKey: 'k1', api: 'openai-completions', baseUrl: 'https://gateway.example/v1' } as const

describe('获取可用模型（ADR 0010）', () => {
  it('新建：表单中的 Key（去掉首尾空白）以明文随 provider.models 发给 Sidecar，不加密；回传模型 ID', async () => {
    const { channel, sent } = fakeChannel({ answer: list })
    const bridge = createProviderModelsBridge({ channel })
    expect(await bridge.fetch({ ...request, secret: '  sk-form-key-1234\n' })).toEqual({ ok: true, models: ['custom-model-1', 'custom-model-2'] })
    expect(sent).toEqual([
      { type: 'provider.models', requestId: expect.any(Number), api: 'openai-completions', baseUrl: request.baseUrl, secret: 'sk-form-key-1234' },
    ])
  })

  it('编辑：Key 留空时只带 Provider ID（用已保存的 Credential）；填写了新 Key 时一起带上', async () => {
    const { channel, sent } = fakeChannel({ answer: list })
    const bridge = createProviderModelsBridge({ channel })
    await bridge.fetch({ ...request, providerId: 'custom-provider-1', secret: '   ' })
    await bridge.fetch({ ...request, providerId: 'custom-provider-1', secret: 'sk-new-key-5678' })
    expect(sent.map((m) => (m.type === 'provider.models' ? [m.providerId, m.secret] : m.type))).toEqual([
      ['custom-provider-1', undefined],
      ['custom-provider-1', 'sk-new-key-5678'],
    ])
    expect(sent[0]).not.toHaveProperty('secret')
  })

  it.each([
    ['不是对象', null],
    ['没有 Key 也没有 Provider ID', request],
    ['协议不在三种之内', { ...request, api: 'google', secret: 'sk-x-12345678' }],
    ['Provider ID 不合规则', { ...request, providerId: 'Bad ID' }],
    ['Key 含空白', { ...request, secret: 'sk a b' }],
    ['缺少 requestKey', { api: request.api, baseUrl: request.baseUrl, secret: 'sk-x-12345678' }],
  ])('输入不合要求（%s）时 invalid-input，不发送', async (_label, input) => {
    const { channel, sent } = fakeChannel({ answer: list })
    expect(await createProviderModelsBridge({ channel }).fetch(input)).toMatchObject({ ok: false, code: 'invalid-input' })
    expect(sent).toEqual([])
  })

  it('Sidecar 的失败原样带回错误码、说明与状态码；未就绪或在回答前退出为 sidecar-unavailable', async () => {
    const failing = fakeChannel({
      answer: (m) =>
        m.type === 'provider.models'
          ? { type: 'provider.models.result', requestId: m.requestId, ok: false, error: { code: 'upstream-error', message: 'HTTP 401: bad key', status: 401 } }
          : undefined,
    })
    expect(await createProviderModelsBridge({ channel: failing.channel }).fetch({ ...request, secret: 'sk-x-12345678' })).toEqual({
      ok: false,
      code: 'upstream-error',
      message: 'HTTP 401: bad key',
      status: 401,
    })
    const notReady = fakeChannel({ ready: false })
    expect(await createProviderModelsBridge({ channel: notReady.channel }).fetch({ ...request, secret: 'sk-x-12345678' })).toMatchObject({
      ok: false,
      code: 'sidecar-unavailable',
    })
    expect(notReady.sent).toEqual([])
    const exiting = fakeChannel()
    const pending = createProviderModelsBridge({ channel: exiting.channel }).fetch({ ...request, secret: 'sk-x-12345678' })
    exiting.exit()
    expect(await pending).toMatchObject({ ok: false, code: 'sidecar-unavailable' })
  })

  it('cancel(requestKey) 立即以 cancelled 结束并请 Sidecar 中止；未知或已结束的 key 不发送', async () => {
    const { channel, sent, deliver } = fakeChannel()
    const bridge = createProviderModelsBridge({ channel })
    const pending = bridge.fetch({ ...request, secret: 'sk-x-12345678' })
    const { requestId } = sent[0] as Extract<MainToSidecarMessage, { type: 'provider.models' }>
    bridge.cancel('k1')
    expect(await pending).toMatchObject({ ok: false, code: 'cancelled' })
    expect(sent[1]).toEqual({ type: 'provider.models.cancel', requestId })
    // 之后到达的回答被忽略。
    deliver({ type: 'provider.models.result', requestId, ok: true, models: ['late'] })
    bridge.cancel('k1')
    bridge.cancel('unknown')
    bridge.cancel(42)
    expect(sent).toHaveLength(2)
  })

  it('超过时限以 timeout 结束，并请 Sidecar 中止', async () => {
    const { channel, sent } = fakeChannel()
    const bridge = createProviderModelsBridge({ channel, timeoutMs: 30 })
    expect(await bridge.fetch({ ...request, secret: 'sk-x-12345678' })).toMatchObject({ ok: false, code: 'timeout' })
    const { requestId } = sent[0] as Extract<MainToSidecarMessage, { type: 'provider.models' }>
    expect(sent[1]).toEqual({ type: 'provider.models.cancel', requestId })
  })

  it('默认时限为 15 秒：之前仍在等待，到时以 timeout 结束', async () => {
    vi.useFakeTimers()
    try {
      const bridge = createProviderModelsBridge({ channel: fakeChannel().channel })
      let settled = false
      const pending = bridge.fetch({ ...request, secret: 'sk-x-12345678' }).finally(() => (settled = true))
      await vi.advanceTimersByTimeAsync(14_999)
      expect(settled).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      expect(await pending).toMatchObject({ ok: false, code: 'timeout' })
    } finally {
      vi.useRealTimers()
    }
  })
})
