import { expect, it } from 'vitest'
import { processActivities, processSeats, processSteps, processTitle, toolArgumentSummary, toolStepPresentation, wholeFoldEligible } from './process-groups.ts'
import { createTranslator } from '@coko/i18n'
import type { TimelineItem } from './timeline.ts'

const thought = (key: string, runId: string | null): TimelineItem => ({ kind: 'thinking', key, text: 'actual thought', streaming: false, origin: { runId } })

it('unknown ownership remains independent and real replies, inputs and business rows split process seats', () => {
  const items: TimelineItem[] = [
    thought('a', 'r'),
    thought('b', 'r'),
    { kind: 'text', key: 'reply', text: 'phase', streaming: false, origin: { runId: 'r' } },
    thought('c', 'r'),
    thought('orphan', null),
    thought('other', 'other'),
  ]
  const seats = processSeats(items, new Map())
  expect(seats.map((seat) => (seat.kind === 'process' ? seat.members.map((member) => member.key) : seat.item.key))).toEqual([
    ['a', 'b'],
    'reply',
    ['c'],
    'orphan',
    ['other'],
  ])
})

it('revealing an earlier process member retains an overlapping group identity and respects newly revealed visible input', () => {
  const before = processSeats([thought('old', 'r')], new Map()).filter((seat) => seat.kind === 'process')
  const expanded = processSeats([thought('earlier', 'r'), thought('old', 'r')], new Map(), before)
  expect(expanded[0]).toMatchObject({ id: before[0]!.id })
  const run = { id: 'r', status: 'completed', restricted: false, endedSeq: 10 } as const
  const opening: TimelineItem = { kind: 'user', key: 'input', text: 'visible input', seq: 5, checkpoint: true, origin: { runId: null, seq: 5 } }
  expect(wholeFoldEligible([opening, thought('old', 'r')], run)).toBe(true)
  expect(wholeFoldEligible([thought('earlier', 'r'), opening, thought('old', 'r')], run)).toBe(false)
})

it('groups calls by the recorded assistant message, keeping thoughts and separate requests in order', () => {
  const tool = (id: string, seq: number): TimelineItem => ({
    kind: 'tool',
    key: `tool:${id}`,
    call: { id, name: 'bash', arguments: {} },
    result: null,
    status: 'running',
    live: null,
    origin: { runId: 'r', seq },
  })
  const steps = processSteps([thought('thinking', 'r'), tool('one', 2), tool('two', 2), tool('three', 4), thought('next', 'r'), tool('four', 6)])
  expect(steps.map((step) => (step.kind === 'tools' ? step.members.map((member) => member.call.id) : step.item.key))).toEqual([
    'thinking',
    ['one', 'two'],
    ['three'],
    'next',
    ['four'],
  ])
})

it('splitting an existing process seat cannot reuse its retained React identity for another seat', () => {
  const initial = processSeats([thought('second', 'r')], new Map()).filter((seat) => seat.kind === 'process')
  const previous = processSeats([thought('first', 'r'), thought('second', 'r')], new Map(), initial).filter((seat) => seat.kind === 'process')
  const input: TimelineItem = { kind: 'user', key: 'input', text: 'steering', seq: 3, checkpoint: false, origin: { runId: 'r' } }
  const seats = processSeats([thought('first', 'r'), input, thought('second', 'r')], new Map(), previous).filter((seat) => seat.kind === 'process')
  expect(new Set(seats.map((seat) => seat.id)).size).toBe(2)
  expect(seats[0]!.id).toBe(previous[0]!.id)
})

const recordedTool = (id: string, name: string, args: unknown = {}): Extract<TimelineItem, { kind: 'tool' }> => ({
  kind: 'tool',
  key: `tool:${id}`,
  call: { id, name, arguments: args },
  result: null,
  status: 'done',
  live: null,
})

it('composes Harness activity names from distinct calls, ranks ties by first appearance, and shares translated prefixes', () => {
  const calls = [recordedTool('code', 'run_code'), recordedTool('bash', 'bash'), recordedTool('find', 'find')]
  expect(processTitle(calls, createTranslator('zh'))).toBe('运行了代码，执行了命令，已搜索代码')
  expect(processTitle(calls, createTranslator('en'))).toBe('Ran code, ran commands, searched code')
  expect(processTitle([recordedTool('read', 'read'), recordedTool('find', 'find')], createTranslator('zh'))).toBe('已读取文件并搜索代码')
  expect(processActivities([...calls, calls[0]!])).toEqual(['code', 'commands', 'search'])
})

it('names a request from its operation types and recorded task description, with truthful old-record fallbacks', () => {
  expect(
    toolStepPresentation([
      recordedTool('bash', 'bash', { command: 'ls', description: 'Find tool definitions\nMore detail' }),
      recordedTool('find', 'find', { pattern: '*.ts' }),
    ]),
  ).toEqual({ activity: 'code', summary: 'Find tool definitions' })
  expect(toolStepPresentation([recordedTool('bash', 'bash', { command: 'pwd' })])).toEqual({ activity: 'commands', summary: 'pwd' })
  expect(toolArgumentSummary('read', { path: 'src/tools.ts', description: 'Read a file' })).toBe('src/tools.ts')
  expect(toolArgumentSummary('run_code', { description: 'Check sizes', code: 'console.log(1)' })).toBe('Check sizes')
})
