import { expect, it } from 'vitest'
import type { SessionEntryRecord } from '@coko/protocol'
import { buildRawRecords } from './raw-model.ts'

const entry = (seq: number, kind: string, runId?: string): SessionEntryRecord => ({
  sessionId: 's',
  seq,
  kind,
  payloadVersion: 1,
  createdAt: 1234 + seq,
  runId: runId ?? null,
  payload: kind === 'message' ? { role: 'assistant', content: [] } : {},
})

it('groups loaded entries by the run_start position without filling sequence gaps or fabricating missing headers', () => {
  const source = [
    entry(1, 'permission_mode'),
    entry(3, 'run_start', 'a'),
    entry(4, 'message', 'a'),
    entry(5, 'permission_mode'),
    entry(8, 'run_end', 'a'),
    entry(9, 'message', 'missing'),
    entry(12, 'run_start', 'b'),
  ]
  const model = buildRawRecords(source)
  expect(model.rows.map((row) => [row.key, row.parent, row.depth])).toEqual([
    ['entry:1', undefined, 0],
    ['entry:3', undefined, 0],
    ['entry:4', 'entry:3', 1],
    ['entry:8', 'entry:3', 1],
    ['entry:5', undefined, 0],
    ['entry:9', undefined, 0],
    ['entry:12', undefined, 0],
  ])
  expect(model.records.get('entry:4')).toMatchObject({ identity: '4', type: 'message/assistant', location: '1', time: 1238, value: source[2] })
  expect(model.records.get('entry:5')?.location).toBe('')
  expect(model.records.get('entry:12')?.location).toBe('3')
})
