// Session Reference 的记录序列化：被引用会话的有效上下文 → [User] / [Assistant] 文字记录。只取用户提交的文本与助手的文字回复，
// 压缩过的以摘要打头，命令消息以原始调用出现；超过上限时保留摘要与最近的消息，从摘要之后最早的消息开始省略并注明条数。
import { describe, expect, it } from 'vitest'
import type { EntryLike } from '../../entries/index.ts'
import { SESSION_REFERENCE_MAX_BYTES, SESSION_REFERENCE_NOTES, sessionReferenceBlock, sessionTranscript } from './index.ts'

let seq = 0
const e = (kind: string, payload: unknown, runId = 'r1'): EntryLike => ({ seq: ++seq, kind, runId, payload })
const text = (value: string) => ({ type: 'text', text: value })
const user = (content: unknown, runId?: string) => e('message', { role: 'user', content, timestamp: 1 }, runId)
const assistant = (content: unknown[], runId?: string) => e('message', { role: 'assistant', content, stopReason: 'stop', timestamp: 1 }, runId)
const build = (make: () => EntryLike[]) => {
  seq = 0
  return make()
}
const body = (make: () => EntryLike[], maxBytes?: number) => sessionTranscript(build(make), maxBytes === undefined ? {} : { maxBytes }).body

describe('sessionTranscript：各类消息的取舍', () => {
  it('两轮对话：用户文本与助手文字按顺序出现，各以 [User]: / [Assistant]: 标出', () => {
    expect(body(() => [user('方案 A 还是 B？'), assistant([text('建议 A。')]), user([text('好，记下')]), assistant([text('已记下。')])])).toBe(
      '[User]: 方案 A 还是 B？\n\n[Assistant]: 建议 A。\n\n[User]: 好，记下\n\n[Assistant]: 已记下。',
    )
  })

  it('助手消息只取文字：思考、工具调用与工具结果不进入记录；只有工具调用的助手消息不出现', () => {
    const out = body(() => [
      user('读一下'),
      assistant([
        { type: 'thinking', thinking: 'THINK-MARK' },
        text('我先看文件。'),
        { type: 'toolCall', id: 'c1', name: 'read', arguments: { path: 'CALL-MARK' } },
      ]),
      e('message', { role: 'toolResult', toolCallId: 'c1', toolName: 'read', content: [text('RESULT-MARK')], isError: false, timestamp: 1 }),
      assistant([{ type: 'toolCall', id: 'c2', name: 'read', arguments: { path: 'b.ts' } }]),
      assistant([text('看完了。')]),
    ])
    expect(out).toBe('[User]: 读一下\n\n[Assistant]: 我先看文件。\n\n[Assistant]: 看完了。')
  })

  it('用户消息只取提交的文本：State Update、File Reference 与 Session Reference 的块、附件块、图片不进入记录', () => {
    const out = body(() => [
      e('state_update', { name: 'date', value: '2026-11-21' }),
      user([
        text('<state_update name="date">\n2026-11-21\n</state_update>'),
        text('看 @a.ts 和 @session:s9'),
        text('<file_reference path="a.ts">\nFILE-MARK\n</file_reference>'),
        text('<session_reference id="s9" title="旧会话">\n[User]: NESTED-MARK\n</session_reference>'),
        text('<coko_attachment>{"name":"n.pdf","path":"/tmp/n.pdf"}</coko_attachment>'),
        { type: 'image', data: 'IMAGE-MARK', mimeType: 'image/png' },
      ]),
      assistant([text('好。')]),
    ])
    expect(out).toBe('[User]: 看 @a.ts 和 @session:s9\n\n[Assistant]: 好。')
  })

  it('命令展开而来的用户消息以原始调用 /name 参数 出现（紧邻的 command 条目属于同一 Run）', () => {
    const out = body(() => [
      e('command', { name: 'explain', args: '@a.ts', source: 'project' }),
      user([text('TEMPLATE-MARK Explain @a.ts in one paragraph.')]),
      assistant([text('解释完毕。')]),
      e('command', { name: 'review', args: '', source: 'user' }, 'r2'),
      user([text('TEMPLATE-MARK review everything')], 'r2'),
      // 另一个 Run 的 command 条目不属于这条消息。
      e('command', { name: 'stale', args: '', source: 'user' }, 'r3'),
      user([text('普通消息')], 'r4'),
    ])
    expect(out).toBe('[User]: /explain @a.ts\n\n[Assistant]: 解释完毕。\n\n[User]: /review\n\n[User]: 普通消息')
  })

  it('被回退的消息不出现', () => {
    const out = body(() => [
      user('保留'),
      assistant([text('好。')]),
      user('REWOUND-MARK'),
      assistant([text('REWOUND-REPLY')]),
      e('rewind', { targetSeq: 3 }),
      user('重来'),
    ])
    expect(out).toBe('[User]: 保留\n\n[Assistant]: 好。\n\n[User]: 重来')
  })

  it('有有效 Compaction 时以摘要打头，摘要之前的消息不出现；压缩边界上的命令消息仍以原始调用出现', () => {
    const out = body(() => [
      user('OLD-MARK'),
      assistant([text('OLD-REPLY')]),
      e('command', { name: 'explain', args: 'x', source: 'project' }, 'r2'),
      user([text('TEMPLATE-MARK')], 'r2'),
      assistant([text('最近的回复')], 'r2'),
      e('compaction', { summary: '## Goal\n定下方案 A', firstKeptSeq: 4 }, 'r2'),
    ])
    expect(out).toBe('[Summary of the earlier conversation]: ## Goal\n定下方案 A\n\n[User]: /explain x\n\n[Assistant]: 最近的回复')
  })

  it('没有可附内容时写明没有消息', () => {
    expect(sessionTranscript([])).toEqual({ body: SESSION_REFERENCE_NOTES.empty, bytes: 0, truncated: false })
    expect(body(() => [e('run_start', {}), assistant([{ type: 'toolCall', id: 'c', name: 'ls', arguments: {} }])])).toBe('[No messages in this session.]')
  })
})

describe('sessionTranscript：上限', () => {
  const bytes = (value: string) => Buffer.byteLength(value, 'utf-8')
  const turns = (count: number, size: number) => () => Array.from({ length: count }, (_, i) => user(`m${i + 1} ${'x'.repeat(size)}`))

  it('不超过上限时原样给出，bytes 为记录的字节数', () => {
    const result = sessionTranscript(build(() => [user('你好'), assistant([text('在。')])]))
    expect(result).toEqual({ body: '[User]: 你好\n\n[Assistant]: 在。', bytes: bytes('[User]: 你好\n\n[Assistant]: 在。'), truncated: false })
  })

  it('默认上限 50KB：保留最近的消息，从最早处省略并在开头注明条数', () => {
    expect(SESSION_REFERENCE_MAX_BYTES).toBe(50 * 1024)
    const result = sessionTranscript(build(turns(10, 10_000)))
    expect(result.truncated).toBe(true)
    expect(result.bytes).toBe(bytes(result.body))
    expect(result.bytes).toBeLessThanOrEqual(50 * 1024)
    const parts = result.body.split('\n\n')
    expect(parts[0]).toBe('[5 earlier messages omitted to fit the session reference limit]')
    expect(parts.slice(1).map((part) => part.slice(0, 12))).toEqual(['[User]: m6 x', '[User]: m7 x', '[User]: m8 x', '[User]: m9 x', '[User]: m10 '])
  })

  it('有摘要时摘要保留，省略说明位于摘要之后、保留的消息之前', () => {
    const result = sessionTranscript(
      build(() => [...turns(6, 300)(), e('compaction', { summary: 'SUMMARY-BODY', firstKeptSeq: 1 })]),
      { maxBytes: 1000 },
    )
    const parts = result.body.split('\n\n')
    expect(parts.slice(0, 2)).toEqual([
      '[Summary of the earlier conversation]: SUMMARY-BODY',
      '[4 earlier messages omitted to fit the session reference limit]',
    ])
    expect(parts.slice(2).map((part) => part.slice(0, 11))).toEqual(['[User]: m5 ', '[User]: m6 '])
    expect(result.bytes).toBeLessThanOrEqual(1000)
    expect(result.truncated).toBe(true)
  })

  it('只省略一条时用单数', () => {
    expect(body(turns(2, 400), 700).split('\n\n')[0]).toBe('[1 earlier message omitted to fit the session reference limit]')
  })

  it('摘要自身放不下时截断摘要并注明，其后的消息全部省略', () => {
    const result = sessionTranscript(
      build(() => [user('m1'), user('m2'), e('compaction', { summary: '摘'.repeat(2000), firstKeptSeq: 1 })]),
      { maxBytes: 1000 },
    )
    const parts = result.body.split('\n\n')
    expect(parts[0]!.startsWith('[Summary of the earlier conversation]: 摘摘')).toBe(true)
    // 多字节字符不被切成半个。
    expect(parts[0]!.endsWith('摘')).toBe(true)
    expect(parts.slice(1)).toEqual([
      '[Summary truncated to fit the session reference limit]',
      '[2 earlier messages omitted to fit the session reference limit]',
    ])
    expect(result.bytes).toBeLessThanOrEqual(1000)
    expect(result.truncated).toBe(true)
  })

  it('最近的一条消息自身放不下时截断它并注明', () => {
    const result = sessionTranscript(
      build(() => [user('m1'), user(`last ${'y'.repeat(5000)}`)]),
      { maxBytes: 1000 },
    )
    const parts = result.body.split('\n\n')
    expect(parts[0]).toBe('[1 earlier message omitted to fit the session reference limit]')
    expect(parts[1]!.startsWith('[User]: last yyy')).toBe(true)
    expect(parts[2]).toBe('[Message truncated to fit the session reference limit]')
    expect(result.bytes).toBeLessThanOrEqual(1000)
  })
})

describe('sessionReferenceBlock', () => {
  it('开标签带 id 与按 XML 属性转义的标题', () => {
    expect(sessionReferenceBlock('s1', '方案 "A" & <B>', '[User]: hi')).toBe(
      '<session_reference id="s1" title="方案 &quot;A&quot; &amp; &lt;B&gt;">\n[User]: hi\n</session_reference>',
    )
  })
})
