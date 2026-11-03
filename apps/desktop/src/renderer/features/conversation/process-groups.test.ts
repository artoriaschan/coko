import { expect, it } from 'vitest'
import { processSeats, wholeFoldEligible } from './process-groups.ts'
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
