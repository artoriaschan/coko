// 条目派生（@coko/agent/entries）：表驱动断言有效条目、上一 Run 状态、未回答的确认与模型上下文；导入守卫断言该子路径
// （含传递导入）不导入 node:* 与 @earendil-works/* 运行时代码，可在 renderer 中使用。
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  COMPACTION_SUMMARY_PREFIX,
  effectiveEntries,
  lastRunStatus,
  modelContext,
  ScheduleRuleError,
  unansweredConfirmations,
  upcomingOccurrences,
  type EntryLike,
} from './index.ts'

let seq = 0
const e = (kind: string, payload: unknown, runId: string | null = null): EntryLike => ({ seq: ++seq, kind, runId, payload })
const user = (text: string, runId: string | null = null) => e('message', { role: 'user', content: [{ type: 'text', text }], timestamp: 1 }, runId)
const assistant = (text: string, runId: string | null = null) =>
  e('message', { role: 'assistant', content: [{ type: 'text', text }], stopReason: 'stop' }, runId)
const textOf = (message: Record<string, unknown>) => (message.content as { text: string }[] | undefined)?.[0]?.text ?? ''

/** 条目从 seq 1 开始重新编号。 */
function build(make: () => EntryLike[]): EntryLike[] {
  seq = 0
  return make()
}

describe('effectiveEntries：回退与压缩', () => {
  const cases: { name: string; entries: () => EntryLike[]; rewindOnly: number[]; compacted: number[] }[] = [
    { name: '没有回退与压缩：全部条目', entries: () => [user('a'), assistant('b')], rewindOnly: [1, 2], compacted: [1, 2] },
    {
      name: '回退区间 [targetSeq, rewind) 与 rewind 条目本身不在有效条目中',
      entries: () => [user('a'), assistant('b'), user('c'), assistant('d'), e('rewind', { targetSeq: 3 }), user('e')],
      rewindOnly: [1, 2, 6],
      compacted: [1, 2, 6],
    },
    {
      name: '嵌套回退：被任一区间覆盖的都不有效',
      entries: () => [user('a'), user('b'), e('rewind', { targetSeq: 2 }), user('c'), e('rewind', { targetSeq: 1 }), user('d')],
      rewindOnly: [6],
      compacted: [6],
    },
    {
      name: '压缩：最后一个 compaction + firstKeptSeq 及之后（默认只回退时原历史仍在）',
      entries: () => [user('a'), assistant('b'), user('c'), assistant('d'), e('compaction', { summary: 's', firstKeptSeq: 3 }), user('e')],
      rewindOnly: [1, 2, 3, 4, 5, 6],
      compacted: [3, 4, 5, 6],
    },
    {
      name: '多次压缩只看最后一个，更早的 compaction 不再有效',
      entries: () => [
        user('a'),
        e('compaction', { summary: 's1', firstKeptSeq: 1 }),
        user('b'),
        assistant('c'),
        e('compaction', { summary: 's2', firstKeptSeq: 3 }),
        user('d'),
      ],
      rewindOnly: [1, 2, 3, 4, 5, 6],
      compacted: [3, 4, 5, 6],
    },
    {
      name: '压缩落在被回退区间时原历史生效',
      entries: () => [
        user('a'),
        assistant('b'),
        user('c'),
        e('compaction', { summary: 's', firstKeptSeq: 3 }),
        assistant('d'),
        e('rewind', { targetSeq: 3 }),
        user('e'),
      ],
      rewindOnly: [1, 2, 7],
      compacted: [1, 2, 7],
    },
    {
      name: '回退到压缩之后的消息：压缩仍生效',
      entries: () => [user('a'), assistant('b'), e('compaction', { summary: 's', firstKeptSeq: 2 }), user('c'), assistant('d'), e('rewind', { targetSeq: 4 })],
      rewindOnly: [1, 2, 3],
      compacted: [2, 3],
    },
    {
      name: '缺字段的 compaction 不生效',
      entries: () => [user('a'), e('compaction', { summary: 's' }), user('b')],
      rewindOnly: [1, 2, 3],
      compacted: [1, 2, 3],
    },
  ]
  it.each(cases)('$name', ({ entries, rewindOnly, compacted }) => {
    const all = build(entries)
    expect(effectiveEntries(all).map((x) => x.seq)).toEqual(rewindOnly)
    expect(effectiveEntries(all, { compacted: true }).map((x) => x.seq)).toEqual(compacted)
  })
})

describe('modelContext', () => {
  it('压缩后为合成摘要消息 + firstKeptSeq 及之后的消息', () => {
    const all = build(() => [user('a'), assistant('b'), user('c'), e('compaction', { summary: 'S', firstKeptSeq: 3 }), assistant('d')])
    const context = modelContext(all)
    expect(context.map((m) => m.role)).toEqual(['user', 'user', 'assistant'])
    expect(textOf(context[0]!)).toBe(COMPACTION_SUMMARY_PREFIX + 'S\n</summary>')
    expect(context.slice(1).map(textOf)).toEqual(['c', 'd'])
  })

  it('没有压缩时为全部有效 message payload（非 message 条目不进入）', () => {
    const all = build(() => [e('run_start', { trigger: 'submit' }, 'r'), user('a', 'r'), assistant('b', 'r'), e('run_end', { status: 'completed' }, 'r')])
    expect(modelContext(all).map(textOf)).toEqual(['a', 'b'])
  })
})

describe('lastRunStatus', () => {
  const cases: { name: string; entries: () => EntryLike[]; expected: string | undefined }[] = [
    { name: '没有 run_end', entries: () => [user('a')], expected: undefined },
    {
      name: '最后一条 run_end',
      entries: () => [e('run_end', { status: 'completed' }, 'r1'), e('run_end', { status: 'paused' }, 'r2')],
      expected: 'paused',
    },
    {
      name: '被回退的 Run 不算',
      entries: () => [
        user('a'),
        e('run_end', { status: 'completed' }, 'r1'),
        user('b'),
        e('run_end', { status: 'interrupted' }, 'r2'),
        e('rewind', { targetSeq: 3 }),
      ],
      expected: 'completed',
    },
  ]
  it.each(cases)('$name', ({ entries, expected }) => expect(lastRunStatus(build(entries))).toBe(expected))
})

describe('unansweredConfirmations', () => {
  it('有请求、没有回答的调用（按请求顺序），带 runId', () => {
    const all = build(() => [
      e('confirmation_request', { toolCallId: 'c1' }, 'r1'),
      e('confirmation_request', { toolCallId: 'c2' }, 'r1'),
      e('confirmation_answer', { toolCallId: 'c1', answer: 'applied' }, 'r1'),
      e('confirmation_request', { toolCallId: 'c3' }),
    ])
    expect(unansweredConfirmations(all)).toEqual([
      { toolCallId: 'c2', runId: 'r1' },
      { toolCallId: 'c3', runId: null },
    ])
  })
})

describe('upcomingOccurrences：表单预览的接下来几次（UTC 毫秒）', () => {
  const now = Date.parse('2026-11-02T00:30:00Z')
  const iso = (list: number[]) => list.map((ms) => new Date(ms).toISOString())
  it.each([
    // Asia/Shanghai 为 UTC+8：工作日 09:00 = 01:00Z；2026-11-02 是周一。
    [
      'cron 按时区的本地时刻',
      { kind: 'cron', expression: '0 9 * * 1-5', timeZone: 'Asia/Shanghai' },
      ['2026-11-02T01:00:00.000Z', '2026-11-03T01:00:00.000Z', '2026-11-04T01:00:00.000Z'],
    ],
    // America/New_York 2026-11-01 夏令时结束：01:30 重复，只取较早的一次（EDT，05:30Z）；之后每天 06:30Z（EST）。
    [
      'cron 在夏令时结束日只取较早的一次',
      { kind: 'cron', expression: '30 1 * * *', timeZone: 'America/New_York' },
      ['2026-11-02T06:30:00.000Z', '2026-11-03T06:30:00.000Z', '2026-11-04T06:30:00.000Z'],
    ],
    ['every 从 now 对齐', { kind: 'every', seconds: 600 }, ['2026-11-02T00:40:00.000Z', '2026-11-02T00:50:00.000Z', '2026-11-02T01:00:00.000Z']],
    ['after 只有一次', { kind: 'after', seconds: 90 }, ['2026-11-02T00:31:30.000Z']],
    ['at 只有一次', { kind: 'at', at: '2026-11-03T09:00:00+08:00' }, ['2026-11-03T01:00:00.000Z']],
  ] as const)('%s', (_name, rule, expected) => {
    expect(iso(upcomingOccurrences(rule, now, 3))).toEqual(expected)
  })

  it('夏令时结束当天：01:30 的较晚一次（EST）不算', () => {
    const before = Date.parse('2026-11-01T05:00:00Z')
    expect(iso(upcomingOccurrences({ kind: 'cron', expression: '30 1 * * *', timeZone: 'America/New_York' }, before, 2))).toEqual([
      '2026-11-01T05:30:00.000Z',
      '2026-11-02T06:30:00.000Z',
    ])
  })

  it.each([
    ['间隔小于 60 秒', { kind: 'every', seconds: 30 }],
    ['at 在过去', { kind: 'at', at: '2026-11-01T00:00:00Z' }],
    ['cron 非法', { kind: 'cron', expression: '61 * * * *', timeZone: 'UTC' }],
    ['时区非法', { kind: 'cron', expression: '* * * * *', timeZone: '+08:00' }],
  ] as const)('不合要求时抛 ScheduleRuleError：%s', (_name, rule) => {
    expect(() => upcomingOccurrences(rule, now, 3)).toThrow(ScheduleRuleError)
  })
})

describe('导入守卫', () => {
  const root = dirname(fileURLToPath(import.meta.url))
  const IMPORT = /^\s*(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|^\s*import\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/gm

  async function walk(file: string, seen: Map<string, string[]>): Promise<void> {
    if (seen.has(file)) return
    const specifiers = [...(await readFile(file, 'utf8')).matchAll(IMPORT)].map((m) => m[1] ?? m[2] ?? m[3]!)
    seen.set(file, specifiers)
    for (const specifier of specifiers) if (specifier.startsWith('.')) await walk(resolve(dirname(file), specifier), seen)
  }

  /** entries/ 之外允许的纯模块（定时任务的规则与 cron，只用 Intl）；它们的传递导入同样受检。 */
  const ALLOWED_OUTSIDE = new Set(['cron.ts', 'rules.ts'].map((name) => resolve(root, '../tasks/schedules', name)))

  it('子路径及其传递导入只用 typebox、本目录与登记的纯模块', async () => {
    const seen = new Map<string, string[]>()
    await walk(join(root, 'index.ts'), seen)
    const offending: string[] = []
    for (const [file, specifiers] of seen) {
      if (!file.startsWith(root + '/') && !ALLOWED_OUTSIDE.has(file)) offending.push(`${file} 在 entries/ 之外`)
      for (const s of specifiers) {
        if (s.startsWith('.')) continue
        if (s.startsWith('node:') || s.startsWith('@earendil-works/') || !(s === 'typebox' || s.startsWith('typebox/'))) offending.push(`${file}: ${s}`)
      }
    }
    expect(seen.size).toBeGreaterThan(1)
    expect(offending).toEqual([])
  })

  it('包入口 exports 声明 ./entries', async () => {
    const entries = await import('@coko/agent/entries')
    expect(entries.effectiveEntries).toBeTypeOf('function')
    expect(entries.modelContext).toBeTypeOf('function')
  })
})
