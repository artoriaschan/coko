// 压缩（票 11）：切点表驱动（工具调用对不拆开、只有最近内容时不压缩、错误回复与被回退的压缩不参与）、摘要提示（规定的节标题、
// 增量更新、/compact 指示）、文件与 Skill 汇总、压缩后的 token 估算不信任压缩之前的 usage，以及熔断计数与复位。
import { describe, expect, it } from 'vitest'
import type { EntryLike } from '../../entries/index.ts'
import {
  createCompactionBreaker,
  estimateCompactedTokens,
  formatCompactionSummary,
  MAX_CONSECUTIVE_FAILURES,
  planCompaction,
  SUMMARY_SECTIONS,
  summaryRequest,
  type CompactionPlan,
} from './index.ts'

let seq = 0
const e = (kind: string, payload: unknown): EntryLike => ({ seq: ++seq, kind, runId: 'r', payload })
const usage = (tokens: number) => ({ input: tokens, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: tokens, cost: {} })
const user = (text: string) => e('message', { role: 'user', content: [{ type: 'text', text }], timestamp: 1 })
const assistant = (text: string, extra: Record<string, unknown> = {}) =>
  e('message', { role: 'assistant', content: [{ type: 'text', text }], stopReason: 'stop', usage: usage(0), timestamp: 1, ...extra })
const call = (id: string, name: string, args: Record<string, unknown>) =>
  e('message', { role: 'assistant', content: [{ type: 'toolCall', id, name, arguments: args }], stopReason: 'toolUse', usage: usage(0), timestamp: 1 })
const result = (id: string, text: string, toolName = 'read') =>
  e('message', { role: 'toolResult', toolCallId: id, toolName, content: [{ type: 'text', text }], isError: false, timestamp: 1 })
const build = (make: () => EntryLike[]) => {
  seq = 0
  return make()
}
/** n 个字符约 n/4 tokens。 */
const chars = (n: number, c = 'x') => c.repeat(n)

describe('planCompaction：切点', () => {
  const cases: { name: string; entries: () => EntryLike[]; keep: number; firstKeptSeq: number | undefined; summarized?: number[] }[] = [
    {
      name: '从尾部累加到 keepRecentTokens，切在 user 消息开始处',
      entries: () => [user(chars(400)), assistant(chars(400)), user(chars(400)), assistant(chars(400))],
      keep: 150,
      firstKeptSeq: 3,
      summarized: [1, 2],
    },
    {
      name: '越过预算的位置是 toolResult：切点后移到下一个 user / assistant，调用与结果不分开',
      entries: () => [user(chars(40)), call('c1', 'read', { path: 'a.ts' }), result('c1', chars(800)), user(chars(40)), assistant(chars(40))],
      keep: 100,
      firstKeptSeq: 4,
      summarized: [1, 2, 3],
    },
    {
      name: '最后的 toolResult 本身超过预算：保留它的调用（切在 assistant 开始处）',
      entries: () => [user(chars(400)), assistant(chars(400)), user(chars(40)), call('c1', 'read', { path: 'a.ts' }), result('c1', chars(2000))],
      keep: 100,
      firstKeptSeq: 4,
      summarized: [1, 2, 3],
    },
    {
      name: '只有最近的内容（不超过预算）：不压缩',
      entries: () => [user(chars(40)), assistant(chars(40))],
      keep: 100,
      firstKeptSeq: undefined,
    },
    {
      name: '切点落在第一条消息：没有可摘要的内容，不压缩',
      entries: () => [user(chars(2000)), assistant(chars(40))],
      keep: 100,
      firstKeptSeq: undefined,
    },
    {
      name: '出错的回复不作为切点，也不进入摘要',
      entries: () => [user(chars(400)), assistant('', { stopReason: 'error', errorMessage: 'boom' }), user(chars(400)), assistant(chars(400))],
      keep: 150,
      firstKeptSeq: 3,
      summarized: [1],
    },
  ]
  it.each(cases)('$name', ({ entries: make, keep, firstKeptSeq, summarized = [] }) => {
    const entries = build(make)
    const plan = planCompaction(entries, { keepRecentTokens: keep })
    expect(plan?.firstKeptSeq).toBe(firstKeptSeq)
    expect(plan?.messages ?? []).toEqual(summarized.map((s) => entries.find((x) => x.seq === s)!.payload))
  })

  it('已有压缩：只摘要上次保留的部分到新切点之前，带上次摘要与文件，更早的 compaction 被替代', () => {
    const entries = build(() => [
      user(chars(400)),
      call('c1', 'read', { path: 'old.ts' }),
      result('c1', chars(40)),
      user(chars(400)),
      e('compaction', {
        summary: 'S1',
        firstKeptSeq: 4,
        tokensBefore: 1,
        trigger: 'auto',
        readFiles: ['old.ts'],
        modifiedFiles: ['w.ts'],
        invokedSkills: ['deploy'],
      }),
      call('c2', 'edit', { path: 'w2.ts' }),
      result('c2', chars(40), 'edit'),
      user(chars(400)),
      assistant(chars(400)),
    ])
    const plan = planCompaction(entries, { keepRecentTokens: 150 })!
    expect(plan.firstKeptSeq).toBe(8)
    expect(plan.previousSummary).toBe('S1')
    expect(plan.messages).toEqual([entries[3]!.payload, entries[5]!.payload, entries[6]!.payload])
    expect(plan.readFiles).toEqual(['old.ts'])
    expect(plan.modifiedFiles).toEqual(['w.ts', 'w2.ts'])
    expect(plan.invokedSkills).toEqual(['deploy'])
  })

  it('落在被回退区间内的 compaction 不生效：按原历史重新规划', () => {
    const entries = build(() => [
      user(chars(400)),
      assistant(chars(400)),
      user(chars(400)),
      e('compaction', { summary: 'S1', firstKeptSeq: 3, tokensBefore: 1, trigger: 'auto', readFiles: [], modifiedFiles: [] }),
      e('rewind', { targetSeq: 3 }),
      user(chars(400)),
      assistant(chars(400)),
    ])
    const plan = planCompaction(entries, { keepRecentTokens: 150 })!
    expect(plan.previousSummary).toBeUndefined()
    expect(plan.firstKeptSeq).toBe(6)
    expect(plan.messages).toEqual([entries[0]!.payload, entries[1]!.payload])
  })

  it('文件只从被摘要的工具调用汇总：读过且改过的只列在 modifiedFiles；Skill 来自 skill 调用与 skill 命令', () => {
    const entries = build(() => [
      e('command', { name: 'review', args: '', source: 'skill' }),
      user(chars(40)),
      call('c1', 'read', { path: 'a.ts' }),
      result('c1', 'a'),
      call('c2', 'read', { path: 'b.ts' }),
      result('c2', 'b'),
      call('c3', 'write', { path: 'b.ts', content: 'x' }),
      result('c3', 'ok', 'write'),
      call('c4', 'skill', { name: 'deploy' }),
      result('c4', 'steps', 'skill'),
      user(chars(800)),
      call('c5', 'read', { path: 'kept.ts' }),
      result('c5', chars(40)),
    ])
    const plan = planCompaction(entries, { keepRecentTokens: 150 })!
    expect(plan.firstKeptSeq).toBe(11)
    expect(plan.readFiles).toEqual(['a.ts'])
    expect(plan.modifiedFiles).toEqual(['b.ts'])
    expect(plan.invokedSkills).toEqual(['deploy', 'review'])
  })
})

describe('摘要提示', () => {
  const plan = {
    firstKeptSeq: 3,
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'Build the API' }], timestamp: 1 },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Reading' },
          { type: 'toolCall', id: 'c', name: 'read', arguments: { path: 'a.ts' } },
        ],
      },
      { role: 'toolResult', toolCallId: 'c', toolName: 'read', content: [{ type: 'text', text: 'R'.repeat(5000) }], isError: false },
    ],
    readFiles: ['a.ts'],
    modifiedFiles: [],
    invokedSkills: [],
  } as unknown as CompactionPlan

  it('首次摘要：规定的节标题，对话序列化为文本（不让模型接着对话），工具结果截断', () => {
    const request = summaryRequest(plan)
    expect(SUMMARY_SECTIONS).toEqual([
      '## Goal',
      '## Constraints & Preferences',
      '## User Messages',
      '## Files and Code',
      '## Errors and Fixes',
      '## Key Decisions',
      '## Progress',
      '## Pending Tasks',
      '## Current Work',
      '## Next Step',
    ])
    for (const heading of SUMMARY_SECTIONS) expect(request.prompt).toContain(heading)
    expect(request.prompt).toContain('[User]: Build the API')
    expect(request.prompt).toContain('[Assistant tool calls]: read(path="a.ts")')
    expect(request.prompt).toMatch(/\[Tool result\]: R{2000}\n\n\[\.\.\. 3000 more characters truncated\]/)
    expect(request.prompt).not.toContain('<previous-summary>')
    expect(request.systemPrompt).toMatch(/Do NOT call any tools/)
  })

  it('已有摘要：增量更新提示，带上次摘要；/compact 的指示追加为额外要求', () => {
    const request = summaryRequest({ ...plan, previousSummary: 'OLD SUMMARY' }, '只保留接口设计')
    expect(request.prompt).toContain('<previous-summary>\nOLD SUMMARY\n</previous-summary>')
    expect(request.prompt).toMatch(/PRESERVE all existing information/)
    for (const heading of SUMMARY_SECTIONS) expect(request.prompt).toContain(heading)
    expect(request.prompt.trimEnd().endsWith('Additional requirements from the user: 只保留接口设计')).toBe(true)
  })

  it('File Reference 与指令文件块缩为一行路径，图片标为省略；用户自己写的文本逐字保留', () => {
    const request = summaryRequest({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'look at @a.ts' },
            { type: 'text', text: '<file_reference path="a.ts">\n' + 'F'.repeat(50_000) + '\n</file_reference>' },
            { type: 'image', data: 'xx', mimeType: 'image/png' },
          ],
          timestamp: 1,
        },
        {
          role: 'toolResult',
          toolCallId: 'c',
          toolName: 'read',
          content: [
            { type: 'text', text: 'ok' },
            { type: 'text', text: '<instruction_file path="/w/pkg/AGENTS.md" scope="nested">\nrules\n</instruction_file>' },
          ],
          isError: false,
        },
      ] as never,
    })
    expect(request.prompt).toContain('[User]: look at @a.ts\n[file reference attached: a.ts]\n[image omitted]')
    expect(request.prompt).not.toContain('FFFF')
    expect(request.prompt).toContain('[Tool result]: ok\n[instruction file attached: /w/pkg/AGENTS.md]')
  })

  it('输入超过上限时先省略最早的工具结果，再省略最早的消息，并注明省略了多少条；最近的部分保留', () => {
    const messages = [
      { role: 'user', content: [{ type: 'text', text: 'FIRST ' + 'u'.repeat(3_000) }], timestamp: 1 },
      { role: 'toolResult', toolCallId: 'c', toolName: 'read', content: [{ type: 'text', text: 'r'.repeat(1_900) }], isError: false },
      { role: 'user', content: [{ type: 'text', text: 'SECOND ' + 'v'.repeat(3_000) }], timestamp: 2 },
      { role: 'user', content: [{ type: 'text', text: 'LAST request' }], timestamp: 3 },
    ] as never
    const unlimited = summaryRequest({ messages })
    expect(unlimited.prompt).toContain('FIRST')
    const capped = summaryRequest({ messages }, undefined, { maxInputChars: 7_000 })
    const conversation = capped.prompt.slice(0, capped.prompt.indexOf('</conversation>'))
    expect(conversation.length).toBeLessThanOrEqual(7_000)
    expect(conversation).not.toContain('rrrr')
    expect(conversation).not.toContain('FIRST')
    expect(conversation).toContain('[2 earlier messages omitted to fit the summary request]')
    expect(conversation).toContain('SECOND')
    expect(conversation).toContain('LAST request')
  })

  it('摘要正文之后列出读过与改过的文件和已调用的 Skill', () => {
    expect(formatCompactionSummary('BODY', { readFiles: ['a.ts'], modifiedFiles: ['b.ts'], invokedSkills: ['deploy'] })).toBe(
      'BODY\n\n<read-files>\na.ts\n</read-files>\n\n<modified-files>\nb.ts\n</modified-files>\n\n<invoked-skills>\ndeploy\n</invoked-skills>',
    )
    expect(formatCompactionSummary('BODY', { readFiles: [], modifiedFiles: [], invokedSkills: [] })).toBe('BODY')
  })
})

describe('estimateCompactedTokens', () => {
  it('压缩之前的 usage 不再可信：按合成摘要与保留消息的 chars/4；压缩之后有 usage 时以它为准', () => {
    const entries = build(() => [
      user(chars(400)),
      assistant(chars(40), { usage: usage(30_000) }),
      user(chars(40)),
      assistant(chars(40), { usage: usage(20_000) }),
      e('compaction', { summary: chars(400, 's'), firstKeptSeq: 3, tokensBefore: 1, trigger: 'auto', readFiles: [], modifiedFiles: [] }),
    ])
    const stale = estimateCompactedTokens(entries)
    expect(stale.usageTokens).toBe(0)
    expect(stale.estimated).toBe(true)
    // 合成摘要消息（前后缀 + 400 字符）与保留的两条各 40 字符。
    expect(stale.tokens).toBeGreaterThan(100)
    expect(stale.tokens).toBeLessThan(200)
    entries.push(user(chars(40)), assistant(chars(40), { usage: usage(500) }), user(chars(40)))
    expect(estimateCompactedTokens(entries)).toMatchObject({ tokens: 510, usageTokens: 500, estimated: true })
  })
})

describe('熔断', () => {
  it('连续 3 次自动失败后暂停；手动失败只计入连续失败数；一次成功复位', () => {
    expect(MAX_CONSECUTIVE_FAILURES).toBe(3)
    const breaker = createCompactionBreaker()
    expect(breaker.failed('auto')).toBe(1)
    expect(breaker.failed('overflow')).toBe(2)
    expect(breaker.paused).toBe(false)
    expect(breaker.failed('manual')).toBe(3)
    expect(breaker.paused).toBe(false)
    expect(breaker.failed('auto')).toBe(4)
    expect(breaker.paused).toBe(true)
    breaker.succeeded()
    expect(breaker.paused).toBe(false)
    expect(breaker.consecutiveFailures).toBe(0)
  })
})
