// message 的 payload 是 pi 的 AgentMessage（只约束判别字段），不能在类型上比较：两侧的 schema 对同一组消息给出相同的判定。
import { messagePayloadSchema, SESSION_ENTRY_PAYLOADS } from '@coko/agent'
import { MessagePayload, ToolLoadPayload, StateUpdatePayload, SESSION_ENTRY_PAYLOAD_SCHEMAS } from '@coko/protocol'
import { Value } from 'typebox/value'
import { describe, expect, it } from 'vitest'

const samples: unknown[] = [
  { role: 'user', content: 'hi' },
  { role: 'user', content: [{ type: 'text', text: 'hi' }] },
  { role: 'assistant', content: [{ type: 'text', text: 'ok' }], stopReason: 'stop' },
  { role: 'assistant', content: [], stopReason: 'error', errorMessage: 'model failed' },
  { role: 'toolResult', toolCallId: 't1', toolName: 'bash', content: [{ type: 'text', text: 'x' }], isError: true, details: { sandbox: { denied: true } } },
  { role: 'system', content: 'tools changed' },
  // 不合格：
  { role: 'assistant', content: [] },
  { role: 'toolResult', toolCallId: '', toolName: 'bash', content: [], isError: false },
  { role: 'assistant', content: [], stopReason: 'error', errorMessage: 42 },
  { role: 'robot', content: 'x' },
]

describe('条目 payload 的两份 schema', () => {
  it('message：agent 与 protocol 对同一组消息的判定相同', () => {
    expect(samples.map((s) => Value.Check(messagePayloadSchema, s))).toEqual(samples.map((s) => Value.Check(MessagePayload, s)))
  })

  it('两侧注册的 kind 相同', () => {
    expect(SESSION_ENTRY_PAYLOADS.map((d) => d.kind).sort()).toEqual(Object.keys(SESSION_ENTRY_PAYLOAD_SCHEMAS).sort())
  })

  it('tool_load and catalog State Updates accept the same durable payloads on both sides', () => {
    for (const [kind, schema, samples] of [
      [
        'tool_load',
        ToolLoadPayload,
        [
          { names: ['mcp__demo__echo'], source: 'search', toolCallId: 's' },
          { names: [], source: 'search', toolCallId: 's' },
          { names: ['a'], source: 'fake', toolCallId: 's' },
        ],
      ],
      [
        'state_update',
        StateUpdatePayload,
        [
          { name: 'on_demand_tools', value: ['mcp__demo__echo'] },
          { name: 'unknown', value: [] },
        ],
      ],
    ] as const) {
      const agentCheck = SESSION_ENTRY_PAYLOADS.find((definition) => definition.kind === kind)!.versions.at(-1)!.check
      expect(samples.map((sample) => agentCheck(sample) === undefined)).toEqual(samples.map((sample) => Value.Check(schema, sample)))
    }
  })
})
