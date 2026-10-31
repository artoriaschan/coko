// 审批冒泡（docs/subsystems/subagents.md#界面）：父会话与两个 running 子代理各有一个待审批请求时，父会话输入区按请求的先后依次接管；
// 子代理的卡片标出"来自子代理 <类型> · <描述>"，回答发往子 Session（不是当前会话）；父会话的请求照常经当前会话回答；输入区草稿不丢。
import '../../styles.css'
import type { AgentSnapshot, AnswerApprovalRequest, SessionEntryRecord } from '@coko/protocol'
import { describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { App } from '../../app/app.tsx'
import { createAppearanceStore } from '../../app/appearance-store.ts'
import { ChatStoreProvider } from '../../app/chat.tsx'
import { createConnectionStore } from '../../app/connection-store.ts'
import { createPreferences } from '../../app/preferences.ts'
import { createSettingsPageStore } from '../../app/settings-page-store.ts'
import { createAgentsStore } from '../../stores/agents-store.ts'
import { createFixtureChat } from '../../testing/fixture-chat.ts'
import { AgentsStoreProvider } from './agents-button.tsx'
import { useChildApproval } from './approval-panel.tsx'

const seqs: Record<string, number> = {}
const rec = (sessionId: string, kind: string, payload: unknown, createdAt: number): SessionEntryRecord => ({
  sessionId,
  seq: (seqs[sessionId] = (seqs[sessionId] ?? 0) + 1),
  kind,
  payloadVersion: kind === 'approval_decision' ? 2 : 1,
  payload,
  runId: `run-${sessionId}`,
  createdAt,
})
const toolCall = (sessionId: string, id: string, name: string, args: Record<string, unknown>, at: number) =>
  rec(sessionId, 'message', { role: 'assistant', content: [{ type: 'toolCall', id, name, arguments: args }], stopReason: 'toolUse', timestamp: 0 }, at)
const request = (sessionId: string, requestId: string, toolCallId: string, toolName: string, subject: string, at: number) =>
  rec(sessionId, 'approval_request', { requestId, toolCallId, toolName, kind: 'tool', subject, suggestions: [] }, at)
const decision = (sessionId: string, requestId: string, outcome: 'allowed' | 'denied') => rec(sessionId, 'approval_decision', { requestId, outcome }, 100)

const running = (agentId: string, agentType: string, description: string): AgentSnapshot => ({
  agentId,
  agentType,
  description,
  status: 'running',
  background: true,
  startedAt: 1,
})

describe('审批冒泡', () => {
  it('父会话与两个子代理的请求按时间顺序接管输入区；子代理的卡片标出来源，回答发往子 Session；草稿不丢', async () => {
    const fixture = createFixtureChat({ entries: { 's-2': [], 'child-a': [], 'child-b': [] } })
    const parentAnswers: { sessionId: string; requestId: string; answer: AnswerApprovalRequest }[] = []
    // fixture 的 answerApproval 不读参数；这里换成记录参数的实现（与 ApiClient 的签名相同）。
    ;(fixture.api as { answerApproval: (sessionId: string, requestId: string, answer: AnswerApprovalRequest) => Promise<undefined> }).answerApproval = async (
      sessionId,
      requestId,
      answer,
    ) => void parentAnswers.push({ sessionId, requestId, answer })
    const childAnswers: { sessionId: string; requestId: string; answer: AnswerApprovalRequest }[] = []
    const agents = createAgentsStore({
      list: async (sessionId) => (sessionId === 's-2' ? [running('child-a', 'general', 'write docs'), running('child-b', 'explore', 'scan repo')] : []),
      cancel: async () => {},
      definitions: async () => ({ definitions: [], diagnostics: [] }),
      answer: async (sessionId, requestId, answer) => void childAnswers.push({ sessionId, requestId, answer }),
    })
    const store = createAppearanceStore({ theme: 'light', locale: 'en' })
    const preferences = createPreferences({ appearance: store, settings: fixture.settings, onConflict: () => {}, onFailure: () => {} })
    await render(
      <div style={{ width: '100vw', height: '100vh' }}>
        <AgentsStoreProvider store={agents}>
          <App
            store={store}
            connection={createConnectionStore()}
            chat={fixture.chat}
            settings={fixture.settings}
            preferences={preferences}
            settingsPage={createSettingsPageStore()}
            pickDirectory={async () => null}
          />
        </AgentsStoreProvider>
      </div>,
    )
    await expect.poll(() => fixture.chat.getState().listStatus).toBe('ready')
    fixture.chat.getState().openSession('s-2')
    // 两个 running 子代理被订阅（不切换当前会话）；标题栏按钮显示 running 数。
    await expect
      .poll(() => [fixture.chat.getState().conversations['child-a']?.status, fixture.chat.getState().conversations['child-b']?.status])
      .toEqual(['ready', 'ready'])
    expect(fixture.chat.getState().activeSessionId).toBe('s-2')
    await expect.poll(() => document.querySelector('header [data-action="open-agents"]')?.getAttribute('data-running')).toBe('2')

    const composer = page.getByRole('textbox', { name: /Give Coko a task/ })
    await userEvent.click(composer)
    await userEvent.keyboard('keep this draft')

    const send = fixture.sendServer
    for (const entry of [
      toolCall('child-a', 'w1', 'write', { path: 'docs/a.md', content: 'A' }, 5),
      request('child-a', 'req-a', 'w1', 'write', 'docs/a.md', 10),
      toolCall('s-2', 'b1', 'bash', { command: 'npm test' }, 15),
      request('s-2', 'req-p', 'b1', 'bash', 'npm test', 20),
      toolCall('child-b', 'b2', 'bash', { command: 'git log' }, 25),
      request('child-b', 'req-b', 'b2', 'bash', 'git log', 30),
    ])
      send({ type: 'entry', sessionId: entry.sessionId, entry })

    const card = () => document.querySelector('[data-slot="approval-card"]')
    // 1. 最早的是子代理 A（createdAt 10）。
    await expect.poll(() => card()?.getAttribute('data-approval-key')).toBe('req-a')
    expect(card()!.textContent).toContain('From subagent general · write docs')
    expect(card()!.textContent).toContain('docs/a.md')
    await userEvent.click(page.getByRole('button', { name: 'Allow once' }))
    await expect.poll(() => childAnswers).toEqual([{ sessionId: 'child-a', requestId: 'req-a', answer: { decision: 'allow', scope: 'once' } }])
    expect(parentAnswers).toEqual([])
    send({ type: 'entry', sessionId: 'child-a', entry: decision('child-a', 'req-a', 'allowed') })

    // 2. 父会话自己的请求（createdAt 20）：没有来源标注，经当前会话回答。
    await expect.poll(() => card()?.getAttribute('data-approval-key')).toBe('req-p')
    expect(card()!.textContent).not.toContain('From subagent')
    await userEvent.click(page.getByRole('button', { name: 'Allow once' }))
    await expect.poll(() => parentAnswers).toEqual([{ sessionId: 's-2', requestId: 'req-p', answer: { decision: 'allow', scope: 'once' } }])
    send({ type: 'entry', sessionId: 's-2', entry: decision('s-2', 'req-p', 'allowed') })

    // 3. 子代理 B（createdAt 30）：拒绝发往 child-b。
    await expect.poll(() => card()?.getAttribute('data-approval-key')).toBe('req-b')
    expect(card()!.textContent).toContain('From subagent explore · scan repo')
    await userEvent.click(page.getByRole('button', { name: 'Reject', exact: true }))
    await expect.poll(() => childAnswers.at(-1)).toEqual({ sessionId: 'child-b', requestId: 'req-b', answer: { decision: 'deny' } })
    send({ type: 'entry', sessionId: 'child-b', entry: decision('child-b', 'req-b', 'denied') })

    // 全部回答后输入区回来，草稿仍在。
    await expect.poll(() => card()).toBeNull()
    await expect.element(composer).toBeVisible()
    expect(composer.element().textContent).toBe('keep this draft')
    expect(childAnswers).toHaveLength(2)
    expect(parentAnswers).toHaveLength(1)
  })

  it('子代理结束或组件卸载后释放子 Session 的订阅（WS unsubscribe，对话记录移除）', async () => {
    const fixture = createFixtureChat({ entries: { 'child-a': [], 'child-b': [] } })
    let listed = [running('child-a', 'general', 'write docs'), running('child-b', 'explore', 'scan repo')]
    const agents = createAgentsStore({
      list: async (sessionId) => (sessionId === 's-2' ? listed : []),
      cancel: async () => {},
      definitions: async () => ({ definitions: [], diagnostics: [] }),
      answer: async () => {},
    })
    function Probe() {
      useChildApproval('s-2')
      return null
    }
    const screen = await render(
      <ChatStoreProvider store={fixture.chat}>
        <AgentsStoreProvider store={agents}>
          <Probe />
        </AgentsStoreProvider>
      </ChatStoreProvider>,
    )
    const status = () => [fixture.chat.getState().conversations['child-a']?.status, fixture.chat.getState().conversations['child-b']?.status]
    const unsubscribed = () => fixture.sent.filter((m) => m.type === 'unsubscribe').map((m) => m.sessionId)
    await expect.poll(status).toEqual(['ready', 'ready'])
    expect(unsubscribed()).toEqual([])
    // 子代理 B 结束：不再是 running，释放它的订阅；A 保持。
    listed = [running('child-a', 'general', 'write docs'), { ...running('child-b', 'explore', 'scan repo'), status: 'completed' }]
    await agents.getState().load('s-2')
    await expect.poll(unsubscribed).toEqual(['child-b'])
    expect(status()).toEqual(['ready', undefined])
    await screen.unmount()
    await expect.poll(unsubscribed).toEqual(['child-b', 'child-a'])
    expect(status()).toEqual([undefined, undefined])
  })
})
