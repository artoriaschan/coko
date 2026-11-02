// 右栏 Team tab（docs/subsystems/teams.md#界面）：名册（状态点、活动、用量、worktree）、任务板（按状态分组、owner、可认领、阻塞关系、
// 写入范围重叠的警告）、team_update 实时替换；标题栏团队按钮的 running 数；选中成员后订阅其子 Session、切走与关闭后释放（按 WebSocket
// 订阅消息计数），成员时间线只读，键盘可选中与关闭。
import '../../styles.css'
import type { SessionEntryRecord, TeamSnapshot } from '@coko/protocol'
import { TooltipProvider } from '@coko/ui'
import { describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { ChatStoreProvider } from '../../app/chat.tsx'
import { I18nProvider } from '../../app/i18n.tsx'
import { createAgentsStore } from '../../stores/agents-store.ts'
import { createTeamStore } from '../../stores/team-store.ts'
import { createFixtureChat } from '../../testing/fixture-chat.ts'
import { AgentsStoreProvider } from '../conversation/agents-button.tsx'
import { HEADER_ACTIONS } from '../conversation/header-actions.ts'
import { TeamButton, TeamStoreProvider } from '../conversation/team-button.tsx'
import { RIGHT_PANEL_TABS } from './tabs.ts'
import { TeamTab } from './team-tab.tsx'

let seq = 0
const rec = (sessionId: string, kind: string, payload: unknown): SessionEntryRecord => ({
  sessionId,
  seq: ++seq,
  kind,
  payloadVersion: 1,
  payload,
  runId: 'r1',
  createdAt: seq,
})

const usage = (tokens: number) => ({ turns: 2, toolCalls: 1, tokens, cost: 0, durationMs: 3_000 })
const task = (taskId: string, patch: Partial<TeamSnapshot['tasks'][number]>): TeamSnapshot['tasks'][number] => ({
  taskId,
  revision: 1,
  subject: `subject ${taskId}`,
  description: '',
  status: 'pending',
  blockedBy: [],
  writeScopes: [],
  by: 'lead',
  ready: true,
  ...patch,
})

const initial: TeamSnapshot = {
  members: [
    {
      agentId: 'c-alice',
      name: 'alice',
      status: 'running',
      activity: { toolName: 'bash', summary: 'npm test' },
      usage: usage(42),
      worktree: { kept: true, path: '/r/.coko-worktrees/alice', branch: 'coko/alice' },
    },
    { agentId: 'c-bob', name: 'bob', status: 'idle', usage: usage(7) },
    { agentId: 'c-carol', name: 'carol', status: 'dismissed', usage: usage(1) },
  ],
  tasks: [
    task('t1', { status: 'in_progress', owner: 'alice', revision: 2, writeScopes: ['src/api'], ready: false }),
    task('t2', { blockedBy: ['t1'], ready: false }),
    task('t3', {}),
    task('t4', { status: 'completed', owner: 'bob', revision: 3, ready: false }),
    task('t5', { status: 'in_progress', owner: 'lead', revision: 2, writeScopes: ['src/api/routes.ts'], ready: false }),
    task('t6', { status: 'deleted', revision: 2, ready: false }),
  ],
  warnings: [{ code: 'write-scope-overlap', taskIds: ['t1', 't5'], message: 'overlap' }],
}

async function mount() {
  const fixture = createFixtureChat({
    entries: {
      'c-alice': [rec('c-alice', 'message', { role: 'user', content: 'ALICE-PROMPT build the api', timestamp: 0 })],
      'c-bob': [
        rec('c-bob', 'message', { role: 'user', content: 'BOB-PROMPT write docs', timestamp: 0 }),
        rec('c-bob', 'message', { role: 'assistant', content: [{ type: 'text', text: 'BOB-DONE' }], stopReason: 'stop', timestamp: 0 }),
        rec('c-bob', 'run_end', { status: 'completed' }),
      ],
    },
  })
  const state = { gets: 0, team: initial }
  const teams = createTeamStore({
    get: async () => {
      state.gets++
      return state.team
    },
  })
  const agents = createAgentsStore({
    list: async () => [],
    cancel: async () => {},
    definitions: async () => ({ definitions: [], diagnostics: [] }),
    answer: async () => {},
  })
  await expect.poll(() => fixture.chat.lists.getState().listStatus).toBe('ready')
  fixture.chat.getState().openSession('s-1')
  const opened: string[] = []
  const screen = await render(
    <I18nProvider locale="en">
      <ChatStoreProvider store={fixture.chat}>
        <AgentsStoreProvider store={agents}>
          <TeamStoreProvider store={teams}>
            <TooltipProvider>
              <header>
                <TeamButton sessionId="s-1" openTab={(tab) => opened.push(tab)} />
              </header>
              <div style={{ width: 360, height: 700 }} className="flex flex-col">
                <TeamTab sessionId="s-1" />
              </div>
            </TooltipProvider>
          </TeamStoreProvider>
        </AgentsStoreProvider>
      </ChatStoreProvider>
    </I18nProvider>,
  )
  /** 某个子 Session 的 WebSocket 订阅与退订次数。 */
  const subscriptions = (sessionId: string) => ({
    subscribe: fixture.sent.filter((m) => m.type === 'subscribe' && m.sessionId === sessionId).length,
    unsubscribe: fixture.sent.filter((m) => m.type === 'unsubscribe' && m.sessionId === sessionId).length,
  })
  return { ...fixture, teams, state, opened, screen, subscriptions }
}

const q = (selector: string) => document.querySelector(selector)
const text = (selector: string) => q(selector)?.textContent ?? null

describe('Team tab', () => {
  it('右栏 tab 与标题栏操作已登记为可用', () => {
    expect(RIGHT_PANEL_TABS.find((t) => t.id === 'team')).toMatchObject({ available: true, Component: TeamTab })
    expect(HEADER_ACTIONS.find((a) => a.id === 'team')).toMatchObject({ available: true, Component: TeamButton })
  })

  it('名册的状态点、活动、用量与 worktree；任务板分组、owner、可认领与阻塞；重叠警告；team_update 实时替换；标题栏 running 数', async () => {
    const h = await mount()
    await expect.poll(() => document.querySelectorAll('[data-slot="team-roster"] [data-member]').length).toBe(3)
    const member = (name: string) => q(`[data-slot="team-roster"] [data-member="${name}"]`)!
    expect([...document.querySelectorAll('[data-slot="team-roster"] [data-member]')].map((el) => el.getAttribute('data-member'))).toEqual([
      'alice',
      'bob',
      'carol',
    ])
    expect(member('alice').querySelector('[data-member-status]')?.getAttribute('data-member-status')).toBe('running')
    expect(member('alice').querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('Running')
    expect(member('alice').textContent).toContain('bash · npm test')
    expect(member('alice').textContent).toContain('coko/alice')
    expect(member('bob').textContent).toContain('Idle · Turns: 2 · Tool calls: 1 · 7 tokens · 3s')
    expect(member('carol').querySelector('[data-member-status]')?.getAttribute('data-member-status')).toBe('dismissed')

    // 任务板：pending / in_progress / completed 三组（删除的任务不显示），组内按编号。
    const group = (status: string) =>
      [...document.querySelectorAll(`[data-task-group="${status}"] [data-task-id]`)].map((el) => el.getAttribute('data-task-id'))
    expect(group('pending')).toEqual(['t2', 't3'])
    expect(group('in_progress')).toEqual(['t1', 't5'])
    expect(group('completed')).toEqual(['t4'])
    expect(q('[data-task-id="t6"]')).toBeNull()
    const taskRow = (id: string) => q(`[data-slot="team-board"] [data-task-id="${id}"]`)!
    expect(taskRow('t3').querySelector('[data-slot="task-claimable"]')?.textContent).toBe('Claimable')
    expect(taskRow('t2').querySelector('[data-slot="task-claimable"]')).toBeNull()
    expect(taskRow('t2').querySelector('[data-slot="task-blocked"]')?.textContent).toBe('Waiting for t1')
    expect(taskRow('t1').textContent).toContain('Owner alice')
    expect(taskRow('t1').textContent).toContain('subject t1')

    // 写入范围重叠：板顶的警告（任务 id）与两项上的标记。
    expect(text('[data-slot="team-overlap"]')).toBe('Write scopes of t1 and t5 overlap')
    expect(taskRow('t1').getAttribute('data-overlap')).toBe('true')
    expect(taskRow('t5').getAttribute('data-overlap')).toBe('true')
    expect(taskRow('t3').hasAttribute('data-overlap')).toBe(false)

    // 标题栏：running 1。
    const button = () => q('[data-action="open-team"]')!
    expect([button().getAttribute('data-running'), button().getAttribute('aria-label')]).toEqual(['1', 'Team (1 running)'])
    await userEvent.click(page.getByRole('button', { name: 'Team (1 running)' }))
    expect(h.opened).toEqual(['team'])

    // team_update：alice 完成 t1，t2 变为可认领，警告消失，alice 空闲。
    h.sendServer({
      type: 'progress',
      sessionId: 's-1',
      runId: '',
      event: {
        type: 'team_update',
        team: {
          members: [{ ...initial.members[0]!, status: 'idle' as const }, initial.members[1]!, initial.members[2]!].map(({ activity: _a, ...m }) => m),
          tasks: [
            task('t1', { status: 'completed', owner: 'alice', revision: 3, ready: false }),
            task('t2', { ready: true }),
            task('t3', {}),
            task('t4', { status: 'completed', owner: 'bob', revision: 3, ready: false }),
            task('t5', { status: 'in_progress', owner: 'lead', revision: 2, writeScopes: ['src/api/routes.ts'], ready: false }),
          ],
          warnings: [],
        },
      },
    })
    await expect.poll(() => group('completed')).toEqual(['t1', 't4'])
    expect(taskRow('t2').querySelector('[data-slot="task-claimable"]')?.textContent).toBe('Claimable')
    expect(q('[data-slot="team-overlap"]')).toBeNull()
    expect(member('alice').querySelector('[data-member-status]')?.getAttribute('data-member-status')).toBe('idle')
    await expect.poll(() => button().getAttribute('data-running')).toBe('0')
    expect(button().getAttribute('aria-label')).toBe('Team')
  })

  it('选中成员：订阅其子 Session 并显示只读时间线；切到另一成员时释放前一个；关闭与卸载后释放；键盘 Enter 选中与关闭', async () => {
    const h = await mount()
    await expect.poll(() => document.querySelectorAll('[data-slot="team-roster"] [data-member]').length).toBe(3)
    // 缺省不选中成员：没有订阅任何子 Session。
    expect(q('[data-slot="team-member-detail"]')).toBeNull()
    expect(h.subscriptions('c-alice')).toEqual({ subscribe: 0, unsubscribe: 0 })

    // 键盘：焦点在 alice，Enter 选中 → 订阅 c-alice，时间线显示其消息；没有输入区。
    ;(q('[data-member="alice"]') as HTMLElement).focus()
    await userEvent.keyboard('{Enter}')
    await expect.poll(() => q('[data-slot="team-member-detail"]')?.getAttribute('data-agent-id')).toBe('c-alice')
    await expect.poll(() => text('[data-slot="team-member-timeline"]')).toContain('ALICE-PROMPT build the api')
    expect(h.subscriptions('c-alice')).toEqual({ subscribe: 1, unsubscribe: 0 })
    expect(q('[data-member="alice"]')?.getAttribute('aria-current')).toBe('true')
    expect(h.chat.getState().activeSessionId).toBe('s-1')
    expect(q('[data-slot="team-member-detail"] [contenteditable], [data-slot="team-member-detail"] textarea')).toBeNull()
    expect(text('[data-slot="team-read-only"]')).toBe('Read-only: you cannot message a member directly; ask the lead')

    // 切到 bob：释放 c-alice（退订一次），订阅 c-bob。
    await userEvent.click(page.getByRole('button', { name: 'View the work of bob' }))
    await expect.poll(() => text('[data-slot="team-member-timeline"]')).toContain('BOB-DONE')
    expect(h.subscriptions('c-alice')).toEqual({ subscribe: 1, unsubscribe: 1 })
    expect(h.subscriptions('c-bob')).toEqual({ subscribe: 1, unsubscribe: 0 })
    expect(h.chat.getState().conversations['c-alice']).toBeUndefined()

    // 关闭成员视图（键盘 Enter）：释放 c-bob，任务板仍在。
    ;(page.getByRole('button', { name: 'Close member view' }).element() as HTMLElement).focus()
    await userEvent.keyboard('{Enter}')
    await expect.poll(() => q('[data-slot="team-member-detail"]')).toBeNull()
    expect(h.subscriptions('c-bob')).toEqual({ subscribe: 1, unsubscribe: 1 })
    expect(q('[data-slot="team-board"]')).not.toBeNull()

    // 再选中 bob 后卸载整个 tab：同样释放。
    await userEvent.click(page.getByRole('button', { name: 'View the work of bob' }))
    await expect.poll(() => h.subscriptions('c-bob').subscribe).toBe(2)
    await h.screen.unmount()
    expect(h.subscriptions('c-bob')).toEqual({ subscribe: 2, unsubscribe: 2 })
  })

  it('没有成员与任务时为空状态，标题栏按钮不显示；读取失败时可重试', async () => {
    const fixture = createFixtureChat()
    let fail = true
    const teams = createTeamStore({
      get: async () => {
        if (fail) throw new Error('offline')
        return { members: [], tasks: [], warnings: [] }
      },
    })
    await expect.poll(() => fixture.chat.lists.getState().listStatus).toBe('ready')
    fixture.chat.getState().openSession('s-1')
    const screen = await render(
      <I18nProvider locale="en">
        <ChatStoreProvider store={fixture.chat}>
          <TeamStoreProvider store={teams}>
            <TooltipProvider>
              <TeamButton sessionId="s-1" openTab={() => {}} />
              <div style={{ width: 360, height: 400 }} className="flex flex-col">
                <TeamTab sessionId="s-1" />
              </div>
            </TooltipProvider>
          </TeamStoreProvider>
        </ChatStoreProvider>
      </I18nProvider>,
    )
    await expect.element(page.getByText('Could not load the team')).toBeVisible()
    fail = false
    await userEvent.click(page.getByRole('button', { name: 'Retry' }))
    await expect.element(page.getByText('This session has no team yet')).toBeVisible()
    expect(q('[data-action="open-team"]')).toBeNull()
    await screen.unmount()
  })
})
