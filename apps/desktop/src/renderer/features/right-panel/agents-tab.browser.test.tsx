// 右栏 Agents tab（docs/subsystems/subagents.md#界面）：列表（状态、类型、描述、用量、worktree，key 为 agentId）、选中项的只读子时间线
// （订阅子 Session，没有输入区）、停止按钮（键盘：Tab 到停止、Enter）、Enter 选中另一个子代理打开其时间线；标题栏按钮与打开请求。
import '../../styles.css'
import type { AgentSnapshot, SessionEntryRecord } from '@coko/protocol'
import { TooltipProvider } from '@coko/ui'
import { describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { ChatStoreProvider } from '../../app/chat.tsx'
import { I18nProvider } from '../../app/i18n.tsx'
import { createAgentsStore } from '../../stores/agents-store.ts'
import { createFixtureChat } from '../../testing/fixture-chat.ts'
import { AgentsButton, AgentsStoreProvider } from '../conversation/agents-button.tsx'
import { AgentsTab } from './agents-tab.tsx'
import { RIGHT_PANEL_TABS } from './tabs.ts'

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

const agents: AgentSnapshot[] = [
  {
    agentId: 'c-done',
    agentType: 'explore',
    description: 'read notes',
    status: 'completed',
    background: false,
    startedAt: 1,
    endedAt: 2,
    usage: { turns: 2, toolCalls: 1, tokens: 42, cost: 0, durationMs: 3_000 },
    worktree: { kept: true, path: '/r/.coko-worktrees/agent-x', branch: 'coko/agent-x' },
  },
  { agentId: 'c-run', agentType: 'general', description: 'long scan', status: 'running', background: true, startedAt: Date.now() - 2_000 },
]

async function mount() {
  const fixture = createFixtureChat({
    entries: {
      'c-run': [rec('c-run', 'message', { role: 'user', content: 'scan everything', timestamp: 0 })],
      'c-done': [
        rec('c-done', 'message', { role: 'user', content: 'read notes.txt', timestamp: 0 }),
        rec('c-done', 'message', { role: 'assistant', content: [{ type: 'text', text: 'FOUND IT at notes.txt:1' }], stopReason: 'stop', timestamp: 0 }),
        rec('c-done', 'run_end', { status: 'completed' }),
      ],
    },
  })
  const state = { list: agents.slice(), cancels: [] as string[] }
  const store = createAgentsStore({
    list: async () => state.list.slice(),
    cancel: async (sessionId, agentId) => {
      state.cancels.push(`${sessionId}:${agentId}`)
      state.list = state.list.map((a) => (a.agentId === agentId ? { ...a, status: 'cancelled', endedAt: Date.now() } : a))
    },
    definitions: async () => ({ definitions: [], diagnostics: [] }),
    answer: async () => {},
  })
  await expect.poll(() => fixture.chat.getState().listStatus).toBe('ready')
  fixture.chat.getState().openSession('s-1')
  const opened: string[] = []
  const screen = await render(
    <I18nProvider locale="en">
      <ChatStoreProvider store={fixture.chat}>
        <AgentsStoreProvider store={store}>
          <TooltipProvider>
            <AgentsButton sessionId="s-1" openTab={(tab) => opened.push(tab)} />
            <div style={{ width: 360, height: 600 }} className="flex flex-col">
              <AgentsTab sessionId="s-1" />
            </div>
          </TooltipProvider>
        </AgentsStoreProvider>
      </ChatStoreProvider>
    </I18nProvider>,
  )
  return { ...fixture, store, state, opened, screen }
}

describe('Agents tab', () => {
  it('Agents tab 已登记为可用', () => {
    expect(RIGHT_PANEL_TABS.find((t) => t.id === 'agents')?.available).toBe(true)
  })

  it('列表与缺省选中（运行中）；子时间线只读；Tab 到停止、Enter 停止；Enter 选中另一个打开其时间线；标题栏按钮的 running 数', async () => {
    const h = await mount()
    await expect.poll(() => document.querySelectorAll('[data-slot="agents-tab"] li').length).toBe(2)
    const button = document.querySelector('[data-action="open-agents"]')!
    expect([button.getAttribute('data-running'), button.getAttribute('aria-label')]).toEqual(['1', 'Subagents (1 running)'])
    const done = document.querySelector('li [data-agent-id="c-done"]')!
    expect(done.textContent).toContain('explore')
    expect(done.textContent).toContain('read notes')
    expect(done.textContent).toContain('Completed · Turns: 2 · Tool calls: 1 · 42 tokens · 3s')
    expect(done.textContent).toContain('coko/agent-x')
    expect(document.querySelector('li [data-agent-id="c-run"]')!.textContent).toContain('Background')

    // 缺省选中运行中的子代理：订阅子 Session，时间线中是它的消息；没有输入区。
    await expect.poll(() => document.querySelector('[data-slot="agent-detail"]')?.getAttribute('data-agent-id')).toBe('c-run')
    await expect.poll(() => document.querySelector('[data-slot="agent-timeline"]')?.textContent).toContain('scan everything')
    expect(h.chat.getState().activeSessionId).toBe('s-1')
    expect(document.querySelector('[data-slot="agent-detail"] [contenteditable], [data-slot="agent-detail"] textarea')).toBeNull()
    expect(document.querySelector('[data-slot="agent-read-only"]')?.textContent).toBe('Read-only: you cannot continue a subagent conversation here')

    // 键盘：焦点在列表的运行中项，Tab 经过下一项到停止按钮，Enter 停止。
    ;(document.querySelector('li [data-agent-id="c-run"]') as HTMLElement).focus()
    await userEvent.keyboard('{Tab}')
    await expect.poll(() => (document.activeElement as HTMLElement | null)?.getAttribute('data-action')).toBe('stop-agent')
    await userEvent.keyboard('{Enter}')
    await expect.poll(() => h.state.cancels).toEqual(['s-1:c-run'])
    await expect.poll(() => document.querySelector('[data-slot="agent-detail"]')?.getAttribute('data-status')).toBe('cancelled')
    expect(document.querySelector('[data-action="stop-agent"]')).toBeNull()
    await expect.poll(() => document.querySelector('[data-action="open-agents"]')?.getAttribute('data-running')).toBe('0')

    // Enter 选中已结束的子代理：打开它的时间线。
    ;(document.querySelector('li [data-agent-id="c-done"]') as HTMLElement).focus()
    await userEvent.keyboard('{Enter}')
    await expect.poll(() => document.querySelector('[data-slot="agent-detail"]')?.getAttribute('data-agent-id')).toBe('c-done')
    await expect.poll(() => document.querySelector('[data-slot="agent-timeline"]')?.textContent).toContain('FOUND IT at notes.txt:1')
    expect(document.querySelector('li [data-agent-id="c-done"]')?.getAttribute('aria-current')).toBe('true')

    // 工具卡或通知行发起的打开请求：标题栏按钮打开 Agents tab。
    h.store.getState().open('s-1', 'c-run')
    await expect.poll(() => h.opened).toEqual(['agents'])
    await userEvent.click(page.getByRole('button', { name: 'Subagents' }))
    expect(h.opened).toEqual(['agents', 'agents'])
  })
})
