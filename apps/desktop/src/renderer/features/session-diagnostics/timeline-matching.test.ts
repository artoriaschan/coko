import { expect, it } from 'vitest'
import { locateCandidate, pickRecord } from './timeline-matching.ts'

const candidates = [
  { identity: 'text:a', runId: 'a', seq: 2 },
  { identity: 'tool:call', toolCallId: 'call', runId: 'a', seq: 4 },
  { identity: 'text:b', runId: 'b', seq: 9 },
]
it('locates exact tool results by call identity, then nearby same Run, then another loaded Run', () => {
  expect(locateCandidate({ seq: 5, toolCallId: 'call', runId: 'a' }, candidates)?.identity).toBe('tool:call')
  expect(locateCandidate({ identity: 'removed', seq: 6, runId: 'a' }, candidates)?.identity).toBe('tool:call')
  expect(locateCandidate({ runId: 'missing', seq: 8 }, candidates)?.identity).toBe('text:b')
  expect(locateCandidate({ runId: 'missing' }, [])).toBeUndefined()
})

it('precise displayed identity wins over a shared source Entry and picker never guesses nearby rows', () => {
  expect(locateCandidate({ identity: 'tool:call', seq: 2 }, candidates)?.identity).toBe('tool:call')
  const rows = new Map([
    ['thinking', { identity: 'thinking:2', seq: 2 }],
    ['result', { identity: 'tool:call', sourceSeqs: [4, 5], toolCallId: 'call' }],
  ])
  expect(pickRecord({ identity: 'tool:call', seq: 2 }, rows)).toBe('result')
  expect(pickRecord({ seq: 5 }, rows)).toBe('result')
  expect(pickRecord({ identity: 'unknown', seq: 6, runId: 'a' }, rows)).toBeUndefined()
})
