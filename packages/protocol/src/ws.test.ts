import { Value } from 'typebox/value'
import { describe, expect, it } from 'vitest'
import { ClientMessage, ServerMessage } from './ws.ts'

describe('WebSocket 消息', () => {
  it('subscribe 必须带 sessionId 与非负 afterSeq', () => {
    expect(Value.Check(ClientMessage, { type: 'subscribe', sessionId: 's1', afterSeq: 0 })).toBe(true)
    expect(Value.Check(ClientMessage, { type: 'subscribe', sessionId: 's1' })).toBe(false)
    expect(Value.Check(ClientMessage, { type: 'subscribe', sessionId: 's1', afterSeq: -1 })).toBe(false)
  })

  it('entry 带 seq，progress 带 runId，两者是不同的消息类型', () => {
    const entry = { sessionId: 's1', seq: 3, kind: 'message', payloadVersion: 1, payload: { role: 'user' }, runId: 'r1', createdAt: 1 }
    expect(Value.Check(ServerMessage, { type: 'entry', sessionId: 's1', entry })).toBe(true)
    expect(Value.Check(ServerMessage, { type: 'entry', sessionId: 's1', entry: { ...entry, seq: 0 } })).toBe(false)
    expect(
      Value.Check(ServerMessage, {
        type: 'progress',
        sessionId: 's1',
        runId: 'r1',
        event: { type: 'assistant_delta', kind: 'text', contentIndex: 0, delta: 'h' },
      }),
    ).toBe(true)
    expect(Value.Check(ServerMessage, { type: 'progress', sessionId: 's1', event: { type: 'run_start' } })).toBe(false)
  })
})
