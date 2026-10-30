// 控制通道（Sidecar 一侧）：不合 schema 的消息不交给监听方；带 requestId 的已知请求立即得到失败回答（bad-request），main 不必等超时。
import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { createControlChannel } from './channel.ts'

function fakeProcess() {
  const sent: unknown[] = []
  const proc = Object.assign(new EventEmitter(), {
    connected: true,
    send: (message: unknown, _handle: unknown, _options: unknown, callback?: () => void) => {
      sent.push(message)
      callback?.()
      return true
    },
    disconnect: () => undefined,
    stdout: process.stdout,
  })
  return { proc: proc as unknown as NodeJS.Process, emit: (m: unknown) => proc.emit('message', m), sent }
}

describe('控制通道：不合 schema 的消息', () => {
  it.each([
    [
      'provider.save',
      { type: 'provider.save', requestId: 7, mode: 'create', provider: { id: 'x', price: -1 } },
      { type: 'provider.save.result', requestId: 7, ok: false },
    ],
    ['provider.models', { type: 'provider.models', requestId: 8, api: 'nope' }, { type: 'provider.models.result', requestId: 8, ok: false }],
    ['secret.store', { type: 'secret.store', requestId: 9, name: '' }, { type: 'secret.store.result', requestId: 9, ok: false }],
  ])('%s 带 requestId：立即回答失败，不交给监听方', async (_name, raw, reply) => {
    const { proc, emit, sent } = fakeProcess()
    const invalid: unknown[] = []
    const received: unknown[] = []
    const channel = createControlChannel(proc, (m) => invalid.push(m))
    channel.onMessage((m) => received.push(m))
    emit(raw)
    await expect.poll(() => sent).toHaveLength(1)
    expect(sent[0]).toMatchObject(reply)
    expect(received).toEqual([])
    expect(invalid).toEqual([raw])
  })

  it('没有 requestId 或类型未知：只交给 onInvalid，不回答', async () => {
    const { proc, emit, sent } = fakeProcess()
    const invalid: unknown[] = []
    createControlChannel(proc, (m) => invalid.push(m))
    emit({ type: 'provider.save', mode: 'create' })
    emit({ type: 'unknown.thing', requestId: 3 })
    expect(invalid).toHaveLength(2)
    expect(sent).toEqual([])
  })
})
