// Dates use the same Sidecar clock/timezone as the environment section; model requests and persisted entries are the seam.
import { expect, it } from 'vitest'
import { apiPaths } from '@coko/protocol'
import { setClock, waitApproval } from './sidecar-harness.ts'
import { bootAgents, call, of, runEnds, texts } from './sidecar-subagents-harness.ts'

const clockEnv = { TZ: 'Asia/Shanghai', COKO_TEST_CLOCK: '1', COKO_TEST_CLOCK_START: String(Date.parse('2026-11-05T15:59:00Z')) }
const dateValue = { date: '2026-11-05', weekday: 'Thursday' }
const nextDateValue = { date: '2026-11-06', weekday: 'Friday' }

it('first Run receives local date/weekday; next midnight delivers date before Todo and same-day Runs deduplicate', async () => {
  const env = await bootAgents(
    [
      { content: [call('todo_write', 'todo', { items: [{ content: 'keep working', status: 'pending' }] })] },
      { content: 'planned' },
      { content: 'next day' },
      { content: 'same date' },
    ],
    { env: clockEnv },
  )
  const id = await env.open()
  const send = async (text: string, runs: number) => {
    await env.submit(id, text)
    await env.stream.waitFor(() => runEnds(env.stream, id).length === runs)
  }
  await send('DATE-FIRST', 1)
  const first = (await env.requests())[0]!
  expect(first.find((m) => m.role === 'system')!.sections!.environment).toContain('Timezone: Asia/Shanghai')
  expect(of(env.stream, id, 'state_update').map((e) => e.payload)).toEqual([{ name: 'date', value: dateValue }])
  const firstInput = texts(first.filter((m) => m.role === 'user').at(-1)!.content)
  expect(firstInput[0]).toBe('<state_update name="date">\n{\n  "date": "2026-11-05",\n  "weekday": "Thursday"\n}\n</state_update>')
  await setClock(env.api, Date.parse('2026-11-05T16:00:00Z'))
  await send('DATE-NEXT', 2)
  const next = (await env.requests())[2]!
  const blocks = texts(next.filter((m) => m.role === 'user').at(-1)!.content)
  expect(blocks[0]).toContain('<state_update name="date">')
  expect(blocks[0]).toContain('2026-11-06')
  expect(blocks[1]).toContain('<state_update name="todo_list">')
  expect(blocks[2]).toBe('DATE-NEXT')
  expect(next.find((m) => m.role === 'system')!.sections).toEqual(first.find((m) => m.role === 'system')!.sections)
  await send('DATE-SAME', 3)
  const last = (await env.requests())[3]!
  expect(texts(last.filter((m) => m.role === 'user').at(-1)!.content)).toEqual(['DATE-SAME'])
  expect(
    of(env.stream, id, 'state_update')
      .filter((e) => (e.payload as { name: string }).name === 'date')
      .map((e) => e.payload),
  ).toEqual([
    { name: 'date', value: dateValue },
    { name: 'date', value: nextDateValue },
  ])
  expect(env.stream.invalidEntries).toEqual([])
})

it('midnight during a Run waits until the next Run rather than changing a later tool-result request', async () => {
  const env = await bootAgents(
    [{ content: [call('write', 'write', { path: 'clock.txt', content: 'allowed' })] }, { content: 'after approval' }, { content: 'next Run' }],
    { env: clockEnv },
  )
  const id = await env.open('read-only')
  await env.submit(id, 'DATE-GATED')
  const approval = await waitApproval(env.stream, id)
  await setClock(env.api, Date.parse('2026-11-05T16:00:00Z'))
  expect((await env.api.post(apiPaths.sessionApproval(id, approval.requestId), { decision: 'allow' })).status).toBe(204)
  await env.stream.waitFor(() => runEnds(env.stream, id).length === 1)
  const requests = await env.requests()
  expect(requests).toHaveLength(2)
  expect(JSON.stringify(requests[1])).toContain('2026-11-05')
  expect(JSON.stringify(requests[1])).not.toContain('2026-11-06')
  expect(of(env.stream, id, 'state_update').map((e) => e.payload)).toEqual([{ name: 'date', value: dateValue }])
  await env.submit(id, 'DATE-AFTER-MIDNIGHT')
  await env.stream.waitFor(() => runEnds(env.stream, id).length === 2)
  expect(of(env.stream, id, 'state_update').map((e) => e.payload)).toEqual([
    { name: 'date', value: dateValue },
    { name: 'date', value: nextDateValue },
  ])
})

it('subagents and teammates receive their own date on their first Run without root Goal state', async () => {
  const env = await bootAgents(
    [
      {
        match: 'DATE-ROOT',
        content: [
          call('agent', 'child', { description: 'inspect', prompt: 'DATE-CHILD inspect', subagent_type: 'explore' }),
          call('agent', 'mate', { description: 'review', prompt: 'DATE-MATE review', name: 'alice' }),
        ],
      },
      { match: 'DATE-CHILD', content: 'child done' },
      { match: 'DATE-MATE', content: 'mate done' },
      { match: 'DATE-ROOT', content: 'root done' },
    ],
    { env: clockEnv },
  )
  const id = await env.open('full-access')
  await env.submit(id, 'DATE-ROOT go')
  await env.stream.waitFor(() => runEnds(env.stream, id).length === 1)
  const childIds = of(env.stream, id, 'agent_start').map((e) => (e.payload as { agentId: string }).agentId)
  expect(childIds).toHaveLength(2)
  for (const childId of childIds) {
    await expect.poll(async () => (await env.api.get(apiPaths.session(childId))).body.entries.some((e: { kind: string }) => e.kind === 'run_end')).toBe(true)
    const child = (await env.api.get(apiPaths.session(childId))).body.entries as { kind: string; payload: unknown }[]
    const updates = child.filter((e) => e.kind === 'state_update').map((e) => e.payload)
    expect(updates).toContainEqual({ name: 'date', value: dateValue })
    expect(updates).not.toContainEqual(expect.objectContaining({ name: 'goal' }))
  }
  for (const marker of ['DATE-CHILD', 'DATE-MATE']) {
    const request = (await env.requests()).find((messages) =>
      texts(messages.filter((m) => m.role === 'user').at(-1)!.content)
        .join('')
        .includes(marker),
    )!
    const input = texts(request.filter((m) => m.role === 'user').at(-1)!.content)
    expect(input[0]).toContain('<state_update name="date">')
    expect(input[0]).toContain('2026-11-05')
    expect(input.join('')).not.toContain('<state_update name="goal">')
  }
})
