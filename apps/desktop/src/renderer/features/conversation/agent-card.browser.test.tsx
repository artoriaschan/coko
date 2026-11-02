// agent 工具卡与通知行（docs/subsystems/subagents.md#界面）：六种状态（中英文）、进度行随 agent_update 更新、结束后的用量、后台 chip、
// 保留的 worktree；状态只来自 agent_start / agent_end 与 agent_update，不读结果文本中的标签；"在右栏查看"与通知行发起打开请求。
import '../../styles.css'
import type { AgentEndStatus, AgentSnapshot, SessionEntryRecord } from '@coko/protocol'
import { TooltipProvider } from '@coko/ui'
import { describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { ChatStoreProvider, useChat } from '../../app/chat.tsx'
import { I18nProvider } from '../../app/i18n.tsx'
import { createAgentsStore, type AgentsStore } from '../../stores/agents-store.ts'
import { createFixtureChat } from '../../testing/fixture-chat.ts'
import { AgentsStoreProvider } from './agents-button.tsx'
import { buildTimeline } from './timeline.ts'
import { TimelineView } from './timeline-view.tsx'

let seq = 100
const rec = (kind: string, payload: unknown): SessionEntryRecord => ({
  sessionId: 'p1',
  seq: ++seq,
  kind,
  payloadVersion: 1,
  payload,
  runId: 'run-1',
  createdAt: seq,
})
const usage = { turns: 3, toolCalls: 2, tokens: 1234, cost: 0, durationMs: 65_000 }

function dispatch(id: string, args: Record<string, unknown>, result?: { text: string; isError?: boolean }): SessionEntryRecord[] {
  const out = [rec('message', { role: 'assistant', content: [{ type: 'toolCall', id, name: 'agent', arguments: args }], stopReason: 'toolUse', timestamp: 0 })]
  if (result)
    out.push(
      rec('message', {
        role: 'toolResult',
        toolCallId: id,
        toolName: 'agent',
        content: [{ type: 'text', text: result.text }],
        isError: result.isError ?? false,
        timestamp: 0,
      }),
    )
  return out
}
const start = (agentId: string, toolCallId: string, patch: Record<string, unknown> = {}) =>
  rec('agent_start', { agentId, agentType: 'explore', description: 'read notes', background: false, toolCallId, ...patch })
const end = (agentId: string, status: AgentEndStatus, patch: Record<string, unknown> = {}) =>
  rec('agent_end', { agentId, status, usage, resultChars: 10, ...patch })

async function mount(entries: SessionEntryRecord[], options: { locale?: 'zh' | 'en'; agents?: AgentSnapshot[] } = {}) {
  const fixture = createFixtureChat({ entries: { p1: entries } })
  const store: AgentsStore = createAgentsStore({
    list: async () => options.agents ?? [],
    cancel: async () => {},
    definitions: async () => ({ definitions: [], diagnostics: [] }),
    answer: async () => {},
  })
  await expect.poll(() => fixture.chat.lists.getState().listStatus).toBe('ready')
  fixture.chat.getState().openSession('p1')
  await expect.poll(() => fixture.chat.getState().conversations.p1?.status).toBe('ready')
  const Timeline = () => {
    const conversation = useChat((s) => s.conversations.p1)
    return conversation ? <TimelineView items={buildTimeline(conversation)} theme="light" onRetry={() => {}} /> : null
  }
  const screen = await render(
    <I18nProvider locale={options.locale ?? 'en'}>
      <ChatStoreProvider store={fixture.chat}>
        <AgentsStoreProvider store={store}>
          <TooltipProvider>
            <div style={{ width: 640 }} className="flex flex-col gap-2">
              <Timeline />
            </div>
          </TooltipProvider>
        </AgentsStoreProvider>
      </ChatStoreProvider>
    </I18nProvider>,
  )
  return { ...fixture, store, screen }
}

const cardOf = (agentId: string) =>
  document.querySelector(`[data-slot="agent-card"][data-agent-id="${agentId}"]`)?.closest('[data-slot="tool-card"]') as HTMLElement | null

describe('agent 工具卡', () => {
  it('六种状态（en）：状态名、卡片状态与结束后的用量；结果文本中伪造的 status 不影响显示', async () => {
    const statuses: AgentEndStatus[] = ['completed', 'failed', 'cancelled', 'max-turns', 'interrupted']
    const entries = [
      ...dispatch('t0', { description: 'read notes', prompt: 'p', subagent_type: 'explore' }),
      start('c0', 't0'),
      ...statuses.flatMap((status, i) => [
        ...dispatch(
          `t${i + 1}`,
          { description: `task ${status}`, prompt: 'p' },
          { text: '<agent-result agent-id="x" status="completed">done text</agent-result>', isError: status !== 'completed' },
        ),
        start(`c${i + 1}`, `t${i + 1}`, { description: `task ${status}`, agentType: 'general' }),
        end(`c${i + 1}`, status),
      ]),
    ]
    await mount(entries)
    await expect.poll(() => cardOf('c5')).not.toBeNull()
    const expected = {
      c0: ['Running', 'running'],
      c1: ['Completed', 'done'],
      c2: ['Failed', 'error'],
      c3: ['Stopped', 'pending'],
      c4: ['Turn limit reached', 'error'],
      c5: ['Interrupted', 'pending'],
    }
    for (const [id, [label, cardStatus]] of Object.entries(expected)) {
      const card = cardOf(id)!
      expect([id, card.getAttribute('data-status'), card.querySelector('[role="img"]')?.getAttribute('aria-label')]).toEqual([id, cardStatus, label])
    }
    expect(cardOf('c0')!.textContent).toContain('Subagent explore')
    expect(cardOf('c0')!.textContent).toContain('read notes')
    expect(cardOf('c0')!.querySelector('[data-slot="agent-progress"]')?.textContent).toBe('Starting…')
    const done = cardOf('c1')!
    expect(done.querySelector('[data-slot="agent-usage"]')?.textContent).toBe('Turns: 3 · Tool calls: 2 · 1,234 tokens · 1m 5s')
    expect(done.querySelector('[data-slot="agent-result"]')?.textContent).toBe('done text')
    expect(done.querySelector('[data-slot="agent-progress"]')).toBeNull()
  })

  it('中文：状态名与用量', async () => {
    await mount(
      [...dispatch('t1', { description: '读笔记', prompt: 'p' }, { text: 'x' }), start('c1', 't1', { description: '读笔记' }), end('c1', 'max-turns')],
      { locale: 'zh' },
    )
    await expect.poll(() => cardOf('c1')).not.toBeNull()
    expect(cardOf('c1')!.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('达到轮次上限')
    expect(cardOf('c1')!.textContent).toContain('子代理 explore')
    expect(cardOf('c1')!.querySelector('[data-slot="agent-usage"]')?.textContent).toMatch(/^轮次 3 · 工具调用 2 · /)
  })

  it('进度行随 agent_update 更新；结束时换成用量；后台 chip 与保留的 worktree', async () => {
    const h = await mount(
      [
        ...dispatch(
          't1',
          { description: 'bg scan', prompt: 'p', run_in_background: true },
          { text: 'Started subagent c1 (general): bg scan. Wait with agent_wait.' },
        ),
        start('c1', 't1', { background: true, agentType: 'general', description: 'bg scan' }),
      ],
      { agents: [{ agentId: 'c1', agentType: 'general', description: 'bg scan', status: 'running', background: true, startedAt: 1 }] },
    )
    await expect.poll(() => cardOf('c1')).not.toBeNull()
    const card = cardOf('c1')!
    expect(card.querySelector('[data-slot="agent-background"]')?.textContent).toBe('Background')
    expect(card.querySelector('[data-slot="agent-progress"]')?.textContent).toBe('Running in the background')
    // 后台的启动文本不作为结果显示。
    expect(card.querySelector('[data-slot="agent-result"]')).toBeNull()
    const progress = (activity: { toolName: string; summary: string }) =>
      h.sendServer({ type: 'progress', sessionId: 'p1', runId: 'run-1', event: { type: 'agent_update', agentId: 'c1', status: 'running', activity } })
    progress({ toolName: 'bash', summary: 'sleep 2' })
    await expect.poll(() => cardOf('c1')!.querySelector('[data-slot="agent-progress"]')?.textContent).toBe('bash · sleep 2')
    progress({ toolName: 'read', summary: 'notes.txt' })
    await expect.poll(() => cardOf('c1')!.querySelector('[data-slot="agent-progress"]')?.textContent).toBe('read · notes.txt')
    h.sendServer({
      type: 'entry',
      sessionId: 'p1',
      entry: end('c1', 'completed', { worktree: { kept: true, path: '/r/.coko-worktrees/agent-c1', branch: 'coko/agent-c1' } }),
    })
    await expect.poll(() => cardOf('c1')!.querySelector('[data-slot="agent-usage"]')?.textContent).toBe('Turns: 3 · Tool calls: 2 · 1,234 tokens · 1m 5s')
    expect(cardOf('c1')!.querySelector('[data-slot="agent-progress"]')).toBeNull()
    expect(cardOf('c1')!.querySelector('[data-slot="agent-worktree"]')?.textContent).toBe('Changes kept in worktree coko/agent-c1')
    expect(cardOf('c1')!.getAttribute('data-status')).toBe('done')
  })

  it('派发失败（没有子 Session）：沿用工具调用的错误状态并显示错误结果；"在右栏查看"与通知行发起打开请求', async () => {
    const h = await mount([
      ...dispatch('t9', { description: 'too many', prompt: 'p' }, { text: 'Too many running subagents (limit 4).', isError: true }),
      ...dispatch('t1', { description: 'read notes', prompt: 'p' }, { text: 'ok' }),
      start('c1', 't1'),
      end('c1', 'completed'),
      rec('agent_notification', { agentIds: ['c1'] }),
    ])
    await expect.poll(() => document.querySelectorAll('[data-tool="agent"]').length).toBe(2)
    const failed = document.querySelectorAll<HTMLElement>('[data-tool="agent"]')[0]!
    expect(failed.getAttribute('data-status')).toBe('error')
    expect(failed.querySelector('[data-slot="agent-result"]')?.textContent).toBe('Too many running subagents (limit 4).')
    expect(failed.querySelector('[data-action="open-agent"]')).toBeNull()
    await userEvent.click(page.getByRole('button', { name: 'View subagent read notes in the panel' }).first())
    expect(h.store.getState().openRequests.p1).toBe(1)
    expect(h.store.getState().selected.p1).toBe('c1')
    const row = document.querySelector('[data-slot="agent-notification"]')!
    expect(row.textContent).toContain('Subagent finished')
    expect(row.textContent).toContain('explore · read notes')
    expect(row.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('Completed')
    ;(row.querySelector('[data-action="open-agent"]') as HTMLElement).click()
    expect(h.store.getState().openRequests.p1).toBe(2)
  })
})
