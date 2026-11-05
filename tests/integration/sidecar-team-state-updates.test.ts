// ADR 0024: team definitions stay in system; current members/tasks travel as persisted State Updates.
import { apiPaths, teamPaths, type SessionEntry, type TeamSnapshot } from '@coko/protocol'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { tempDir } from './sidecar-harness.ts'
import { bootAgents, byUser, call, of, runEnds, texts } from './sidecar-subagents-harness.ts'

describe('Agent Teams: State Update', () => {
  it('teammate sections stay stable; changed tasks/members are delivered once, capped at 30 lines and redacted', { timeout: 120_000 }, async () => {
    const secret = 'team-state-secret-0123456789'
    const gate = join(await tempDir('coko-team-state-gate-'), 'bob')
    const env = await bootAgents(
      [
        { match: 'LEAD-FIRST', content: [call('agent', 'a1', { description: 'review', prompt: 'MATE-FIRST review', name: 'alice' })] },
        { match: 'MATE-FIRST', content: 'alice ready' },
        { match: 'LEAD-FIRST', content: 'lead ready' },
        {
          match: 'LEAD-TASKS',
          content: Array.from({ length: 31 }, (_, i) => call('task_create', 't' + i, { subject: i === 0 ? 'Review ' + secret : 'Review item ' + (i + 1) })),
        },
        { match: 'LEAD-TASKS', content: [call('send_message', 's1', { to: 'alice', message: 'MATE-TASKS review tasks' })] },
        { match: 'MATE-TASKS', content: 'alice saw tasks' },
        { match: 'LEAD-TASKS', content: 'lead tasks done' },
        { match: 'LEAD-SAME', content: [call('send_message', 's2', { to: 'alice', message: 'MATE-SAME review again' })] },
        { match: 'MATE-SAME', content: 'alice unchanged' },
        { match: 'LEAD-SAME', content: 'lead same done' },
        { match: 'LEAD-BOB', content: [call('agent', 'a2', { description: 'work', prompt: 'MATE-BOB stay running', name: 'bob' })] },
        { match: 'MATE-BOB', content: [call('bash', 'bob-gate', { command: "until [ -f '" + gate + "' ]; do sleep 0.05; done" })] },
        { match: 'LEAD-BOB', content: [call('send_message', 's3', { to: 'alice', message: 'MATE-MEMBER check members' })] },
        { match: 'MATE-MEMBER', content: 'alice saw bob' },
        { match: 'LEAD-BOB', content: 'lead bob done' },
        { match: 'LEAD-DISMISS', content: [call('agent_cancel', 'c1', { agent_id: 'bob' })] },
        { match: 'LEAD-DISMISS', content: [call('send_message', 's4', { to: 'alice', message: 'MATE-DISMISSED check members again' })] },
        { match: 'MATE-DISMISSED', content: 'alice saw dismissal' },
        { match: 'LEAD-DISMISS', content: 'lead dismissal done' },
      ],
      { ipc: false, env: { COKO_SECRET_TEAM_TOKEN: secret } },
    )
    const { api, stream, submit, requests } = env
    const lead = await env.open('full-access')
    await submit(lead, 'LEAD-FIRST start')
    await stream.waitFor(() => runEnds(stream, lead).length === 1, 60_000)
    const alice = (of(stream, lead, 'agent_start')[0]!.payload as { agentId: string }).agentId
    const childEntries = async () => (await api.get(apiPaths.session(alice))).body.entries as SessionEntry[]
    const waitAlice = async (runs: number) => {
      await expect.poll(async () => (await childEntries()).filter((e) => e.kind === 'run_end').length, { timeout: 30_000 }).toBe(runs)
    }
    await waitAlice(1)
    const run = async (marker: string, rootRuns: number, childRuns: number) => {
      await submit(lead, marker + ' go')
      await stream.waitFor(() => runEnds(stream, lead).length === rootRuns, 60_000)
      await waitAlice(childRuns)
    }
    await run('LEAD-TASKS', 2, 2)
    await run('LEAD-SAME', 3, 3)

    const logged = await requests()
    const first = byUser(logged, 'MATE-FIRST')[0]!
    const changed = byUser(logged, 'MATE-TASKS')[0]!
    const same = byUser(logged, 'MATE-SAME')[0]!
    const sections = (request: typeof first) => request.find((m) => m.role === 'system')!.sections!
    expect(sections(changed)).toEqual(sections(first))
    expect(sections(same)).toEqual(sections(first))
    expect(sections(first).teams).toContain('led by "lead"')
    expect(sections(first).teams).toContain('task_update')
    expect(sections(first).teams).not.toContain('Other teammates:')
    expect(sections(first).teams).not.toContain('Current tasks:')
    const blocks = texts(changed.filter((m) => m.role === 'user').at(-1)!.content)
    const teamBlock = blocks.find((text) => text.startsWith('<state_update name="team">'))!
    expect(teamBlock).toContain('Review [REDACTED:secret]')
    expect(teamBlock.split('\n').slice(1, -1)).toHaveLength(30)
    expect(teamBlock).toContain('4 more; use task_list')
    expect(blocks[0]).toBe(teamBlock)
    expect(texts(same.filter((m) => m.role === 'user').at(-1)!.content).join('')).not.toContain('<state_update')
    const updates = (entries: SessionEntry[]) => entries.filter((e) => e.kind === 'state_update' && (e.payload as { name?: string }).name === 'team')
    expect(updates(await childEntries())).toHaveLength(2)
    expect(JSON.stringify(await childEntries())).not.toContain(secret)
    expect(JSON.stringify(logged)).not.toContain(secret)
    expect(of(stream, lead, 'state_update').filter((e) => (e.payload as { name?: string }).name === 'team')).toEqual([])

    await run('LEAD-BOB', 4, 4)
    const members = (await api.get(teamPaths.team(lead))).body as TeamSnapshot
    expect(members.members.find((member) => member.name === 'bob')?.status).toBe('running')
    const memberRequest = byUser(await requests(), 'MATE-MEMBER')[0]!
    expect(sections(memberRequest)).toEqual(sections(first))
    expect(texts(memberRequest.filter((m) => m.role === 'user').at(-1)!.content).join('')).toContain('bob (running)')
    await run('LEAD-DISMISS', 5, 5)
    const dismissedRequest = byUser(await requests(), 'MATE-DISMISSED')[0]!
    expect(sections(dismissedRequest)).toEqual(sections(first))
    expect(texts(dismissedRequest.filter((m) => m.role === 'user').at(-1)!.content).join('')).toContain('Other teammates: none.')
    expect(updates(await childEntries())).toHaveLength(4)
  })
})
