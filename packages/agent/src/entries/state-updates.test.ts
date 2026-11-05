import { describe, expect, it } from 'vitest'
import { pairedStateUpdates, planStateUpdates, type EntryLike } from './index.ts'

const value = { items: [{ id: 't1', content: 'read spec', status: 'pending' }] }
const marker = (seq = 1): EntryLike => ({ seq, kind: 'state_update', runId: 'r', payload: { name: 'todo_list', value } })
const message = (name = 'todo_list'): EntryLike => ({
  seq: 3,
  kind: 'message',
  runId: 'r',
  payload: {
    role: 'user',
    content: [
      { type: 'text', text: `<state_update name="${name}">\nstate\n</state_update>` },
      { type: 'text', text: 'hello' },
    ],
  },
})

describe('State Update provenance', () => {
  it.each([
    ['paired', [marker(), message()], 1],
    ['crash before message', [marker()], 0],
    ['marker absent', [message()], 0],
    ['name mismatch', [marker(), message('date')], 0],
    ['command between', [marker(), { seq: 2, kind: 'command', payload: {} }, message()], 1],
    ['different Run', [marker(), { ...message(), runId: 'other' }], 0],
  ] as const)('%s', (_name, entries, count) => {
    expect([...pairedStateUpdates(entries).values()].flat()).toHaveLength(count)
  })
  it('compaction cutting away marker invalidates delivery', () => {
    const entries = [marker(), message(), { seq: 4, kind: 'compaction', payload: { summary: 's', firstKeptSeq: 3 } }]
    expect(planStateUpdates({ todo_list: value }, entries)?.entries).toHaveLength(1)
  })
})

describe('State Update planning', () => {
  it('first value sends; unchanged skips; null clears once; absent null skips', () => {
    expect(planStateUpdates({ todo_list: value }, [])?.entries[0]).toMatchObject({ kind: 'state_update', payload: { name: 'todo_list', value } })
    expect(planStateUpdates({ todo_list: value }, [marker(), message()])).toBeUndefined()
    const cleared = planStateUpdates({ todo_list: null }, [marker(), message()])!
    expect(cleared.entries[0]).toMatchObject({ payload: { name: 'todo_list', value: null } })
    expect(planStateUpdates({ todo_list: null }, [])).toBeUndefined()
    expect(planStateUpdates({ todo_list: null }, [{ ...marker(), payload: { name: 'todo_list', value: null } }, message()])).toBeUndefined()
  })
  it('compares normalized objects and orders names', () => {
    expect(planStateUpdates({ todo_list: { items: [{ status: 'pending', content: 'read spec', id: 't1' }] } }, [marker(), message()])).toBeUndefined()
    expect(planStateUpdates({ team: 't', todo_list: value, goal: 'g', date: 'd' }, [])?.entries.map((e) => e.payload.name)).toEqual([
      'date',
      'goal',
      'todo_list',
      'team',
    ])
  })
})
