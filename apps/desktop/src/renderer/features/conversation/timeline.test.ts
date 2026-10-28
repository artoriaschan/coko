// 时间线的回退折叠：被回退的区间收进 rewound 项（嵌套的回退在其中照样折叠），区间内的用户消息不再是可回退的 Checkpoint。
import type { SessionEntry } from '@coko/protocol'
import { describe, expect, it } from 'vitest'
import type { Conversation } from '../../stores/chat-store.ts'
import { buildTimeline, type TimelineItem } from './timeline.ts'

let seq = 0
const entry = (kind: string, payload: unknown, runId: string | null = null) =>
  ({ sessionId: 's', seq: ++seq, kind, payloadVersion: 1, payload, runId, createdAt: seq }) as SessionEntry
const user = (text: string) => entry('message', { role: 'user', content: [{ type: 'text', text }], timestamp: 0 }, 'r')
const reply = (text: string) => entry('message', { role: 'assistant', content: [{ type: 'text', text }], stopReason: 'stop', timestamp: 0 }, 'r')
const failed = () => entry('run_end', { status: 'error', error: { code: 'model_error', message: 'boom' } }, 'r')
const conversation = (entries: SessionEntry[]): Conversation => ({ status: 'ready', entries, lastSeq: seq, running: false, live: null })

/** 显示项的简写：user:文本[*可回退]、text:文本、error[可重试]、[…] 为折叠的区间。 */
function shape(items: TimelineItem[]): unknown[] {
  return items.map((item) => {
    if (item.kind === 'user') return `user:${item.text}${item.checkpoint ? '*' : ''}`
    if (item.kind === 'text') return `text:${item.text}`
    if (item.kind === 'error') return `error${item.retryable ? '!' : ''}`
    if (item.kind === 'rewound') return shape(item.items)
    return item.kind
  })
}

describe('时间线：回退折叠', () => {
  it('被回退的区间折叠为一项，位置在原处；其中的用户消息不可回退、错误不可重试', () => {
    seq = 0
    const entries = [user('one'), reply('a1'), user('two'), failed(), entry('rewind', { targetSeq: 3 }), user('two again'), reply('a2')]
    expect(shape(buildTimeline(conversation(entries)))).toEqual(['user:one*', 'text:a1', ['user:two', 'error'], 'user:two again*', 'text:a2'])
  })

  it('嵌套的回退在外层折叠项中再折叠；不相交的回退各自折叠', () => {
    seq = 0
    const entries = [
      user('one'), // 1
      reply('a1'), // 2
      user('two'), // 3
      entry('rewind', { targetSeq: 3 }), // 4
      user('three'), // 5
      entry('rewind', { targetSeq: 1 }), // 6：包住 1–5
      user('four'), // 7
      entry('rewind', { targetSeq: 7 }), // 8
      user('five'), // 9
    ]
    expect(shape(buildTimeline(conversation(entries)))).toEqual([['user:one', 'text:a1', ['user:two'], 'user:three'], ['user:four'], 'user:five*'])
  })
})
