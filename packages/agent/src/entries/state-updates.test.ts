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
  it.each(['rewind', 'compaction'])('resends the catalog after %s even when its earlier announcement survives', (kind) => {
    const names = ['mcp__demo__read']
    const prior: EntryLike[] = [
      { seq: 1, kind: 'state_update', runId: 'r', payload: { name: 'on_demand_tools', value: names } },
      { ...message('on_demand_tools'), seq: 3 },
      { seq: 4, kind: 'message', payload: { role: 'user', content: 'later' } },
      { seq: 5, kind, payload: kind === 'rewind' ? { targetSeq: 4 } : { summary: 'summary', firstKeptSeq: 1 } },
    ]
    const delivered = planStateUpdates({ on_demand_tools: names }, prior, {
      on_demand_tools: (_value, previous) => (previous === undefined ? 'FULL' : 'DELTA'),
    })!
    expect(delivered.blocks).toEqual([{ type: 'text', text: '<state_update name="on_demand_tools">\nFULL\n</state_update>' }])
    const entries = [
      ...prior,
      { seq: 6, runId: 'next', ...delivered.entries[0]! },
      { seq: 7, runId: 'next', kind: 'message', payload: { role: 'user', content: delivered.blocks } },
    ]
    expect(planStateUpdates({ on_demand_tools: names }, entries)).toBeUndefined()
  })
  it('first value sends; unchanged skips; null clears once; absent null skips', () => {
    expect(planStateUpdates({ todo_list: value }, [])?.entries[0]).toMatchObject({ kind: 'state_update', payload: { name: 'todo_list', value } })
    expect(planStateUpdates({ todo_list: value }, [marker(), message()])).toBeUndefined()
    const cleared = planStateUpdates({ todo_list: null }, [marker(), message()])!
    expect(cleared.entries[0]).toMatchObject({ payload: { name: 'todo_list', value: null } })
    expect(planStateUpdates({ todo_list: null }, [])).toBeUndefined()
    expect(planStateUpdates({ todo_list: null }, [{ ...marker(), payload: { name: 'todo_list', value: null } }, message()])).toBeUndefined()
  })
  it('renders the executing plan reminder (ADR 0028) after the other names; clearing uses the generic text', () => {
    const plan = { planId: 'p1', revision: 2, title: 'Fix the parser' }
    const delivered = planStateUpdates({ plan, todo_list: value }, [])!
    expect(delivered.entries.map((e) => e.payload.name)).toEqual(['todo_list', 'plan'])
    expect(delivered.blocks[1]).toEqual({
      type: 'text',
      text: '<state_update name="plan">\nAn approved plan is still in progress: "Fix the parser" (revision 2). Keep carrying it out; when the work is done and verified, call complete_plan with a report against the plan.\n</state_update>',
    })
    const prior: EntryLike[] = [
      { seq: 1, kind: 'state_update', runId: 'r', payload: { name: 'plan', value: plan } },
      { ...message('plan'), seq: 2 },
    ]
    expect(planStateUpdates({ plan }, prior)).toBeUndefined()
    expect(planStateUpdates({ plan: null }, prior)?.blocks[0]?.text).toBe(
      '<state_update name="plan">\nThis item currently has no content. Previous updates with this name no longer apply.\n</state_update>',
    )
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
