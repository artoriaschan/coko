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

describe('时间线：后台任务通知', () => {
  it('<job-notification> 文本块不进入用户气泡；只有通知的消息不成气泡', () => {
    seq = 0
    const note = '<job-notification>\n<job-id>job_1</job-id>\n</job-notification>\n\n'
    const entries = [
      entry('job_notification', { jobIds: ['job_1'] }, 'r'),
      entry(
        'message',
        {
          role: 'user',
          content: [
            { type: 'text', text: note },
            { type: 'text', text: 'next step' },
          ],
          timestamp: 0,
        },
        'r',
      ),
      reply('ok'),
      entry('job_notification', { jobIds: ['job_2'] }, 'r'),
      entry('message', { role: 'user', content: [{ type: 'text', text: note }], timestamp: 0 }, 'r'),
      reply('noted'),
    ]
    expect(shape(buildTimeline(conversation(entries)))).toEqual(['job', 'user:next step*', 'text:ok', 'job', 'text:noted'])
  })
})

describe('时间线：命令消息', () => {
  const command = (name: string, args: string, source = 'project') => entry('command', { name, args, source }, 'r')

  it('command 条目附到紧随其后的用户消息：显示命令名与参数，全文为展开文本；回退目标文本为原始调用', () => {
    seq = 0
    const entries = [entry('run_start', { trigger: 'submit' }, 'r'), command('review', 'src'), user('Review src carefully.'), reply('ok'), user('plain')]
    const items = buildTimeline(conversation(entries))
    expect(items.filter((i) => i.kind === 'user')).toEqual([
      expect.objectContaining({ text: 'Review src carefully.', command: { name: 'review', args: 'src', source: 'project' }, invocation: '/review src' }),
      expect.not.objectContaining({ command: expect.anything() }),
    ])
    expect(items.map((i) => i.kind)).toEqual(['user', 'text', 'user'])
  })

  it('没有参数的命令调用文本只有名字；command 不跨越 Run 附到下一条消息', () => {
    seq = 0
    const entries = [
      command('compact-notes', ''),
      user('Expanded'),
      entry('run_start', { trigger: 'submit' }, 'r2'),
      command('orphan', ''),
      entry('run_start', { trigger: 'submit' }, 'r3'),
      user('next'),
    ]
    const users = buildTimeline(conversation(entries)).filter((i) => i.kind === 'user')
    expect(users[0]).toMatchObject({ invocation: '/compact-notes', command: { name: 'compact-notes' } })
    expect(users[1]).not.toHaveProperty('command')
  })
})

describe('时间线：File Reference', () => {
  it('<file_reference> 块不进入气泡文本，按出现顺序作为 references；没有引用时省略', () => {
    const withRefs = entry(
      'message',
      {
        role: 'user',
        content: [
          { type: 'text', text: '看看 @src/a.ts 和 @"my dir/"' },
          { type: 'text', text: '<file_reference path="src/a.ts">\nexport const a = 1\n</file_reference>' },
          { type: 'text', text: '<file_reference path="my dir/">\nx.ts\n</file_reference>' },
        ],
        timestamp: 0,
      },
      'r',
    )
    const items = buildTimeline(conversation([withRefs, user('plain')]))
    expect(items[0]).toMatchObject({ kind: 'user', text: '看看 @src/a.ts 和 @"my dir/"', references: ['src/a.ts', 'my dir/'] })
    expect(items[1]).not.toHaveProperty('references')
  })
})

describe('时间线：压缩分隔条', () => {
  const compaction = (extra: Record<string, unknown> = {}) =>
    entry(
      'compaction',
      { summary: '## Goal\nS', firstKeptSeq: 3, tokensBefore: 30_000, tokensAfter: 4_000, trigger: 'auto', readFiles: [], modifiedFiles: [], ...extra },
      'r',
    )

  it('compaction 显示为分隔条（约节省 tokensBefore − tokensAfter），之前的消息仍在时间线中', () => {
    seq = 0
    const items = buildTimeline(conversation([user('one'), reply('a1'), user('two'), compaction(), reply('a2')]))
    expect(shape(items)).toEqual(['user:one*', 'text:a1', 'user:two*', 'compaction', 'text:a2'])
    expect(items[3]).toEqual({ kind: 'compaction', key: '4', summary: '## Goal\nS', trigger: 'auto', saved: 26_000 })
    const unknown = buildTimeline(conversation([user('x'), compaction({ tokensAfter: undefined })]))
    expect(unknown[1]).not.toHaveProperty('saved')
  })

  it('手动压缩的 Run：失败不可重试，进行中不显示"生成中"', () => {
    seq = 0
    const start = entry('run_start', { trigger: 'compact' }, 'c')
    const end = entry('run_end', { status: 'error', error: { code: 'model_error', message: 'x' } }, 'c')
    expect(shape(buildTimeline(conversation([user('one'), reply('a1'), start, end])))).toEqual(['user:one*', 'text:a1', 'error'])
    const running: Conversation = {
      ...conversation([user('one'), reply('a1'), start]),
      running: true,
      live: { runId: 'c', accepting: true, blocks: [], tools: {} },
    }
    expect(shape(buildTimeline(running))).toEqual(['user:one*', 'text:a1'])
  })
})
