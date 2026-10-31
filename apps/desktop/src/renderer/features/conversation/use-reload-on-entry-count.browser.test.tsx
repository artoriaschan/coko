// 条目计数变化即重新读取：首次读取；给定 kind 的条目到达时再读取，其他 kind 不读取；切换会话时读取新会话。
import type { SessionEntryRecord } from '@coko/protocol'
import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { ChatStoreProvider, useChat } from '../../app/chat.tsx'
import { createFixtureChat } from '../../testing/fixture-chat.ts'
import { useReloadOnEntryCount } from './use-reload-on-entry-count.ts'

let seq = 100
const rec = (sessionId: string, kind: string, payload: unknown): SessionEntryRecord => ({
  sessionId,
  seq: ++seq,
  kind,
  payloadVersion: 1,
  payload,
  runId: 'run-1',
  createdAt: seq,
})
const fire = (sessionId: string) => rec(sessionId, 'schedule_fire', { scheduleId: 'sc', occurrence: 1, status: 'started' })
const user = (sessionId: string) => rec(sessionId, 'message', { role: 'user', content: 'hi', timestamp: 0 })

describe('useReloadOnEntryCount', () => {
  it('首次与 kind 条目数变化时读取；其他条目不触发；切换会话读取新会话', async () => {
    const fixture = createFixtureChat({ entries: { 's-1': [], 's-2': [] } })
    const releases = [fixture.chat.getState().subscribeSession('s-1'), fixture.chat.getState().subscribeSession('s-2')]
    await expect.poll(() => fixture.chat.getState().conversations['s-2']?.status).toBe('ready')
    const loads: string[] = []
    const load = (sessionId: string) => void loads.push(sessionId)
    function Probe({ sessionId }: { sessionId: string | null }) {
      useReloadOnEntryCount(sessionId, 'schedule_fire', load)
      // 渲染出条目数：每条条目到达后先等这次渲染，再断言是否读取。
      const count = useChat((s) => s.conversations['s-1']?.entries.length ?? 0)
      return <span data-testid="count">{count}</span>
    }
    const rendered = () => document.querySelector('[data-testid="count"]')?.textContent
    const node = (sessionId: string | null) => (
      <ChatStoreProvider store={fixture.chat}>
        <Probe sessionId={sessionId} />
      </ChatStoreProvider>
    )
    const screen = await render(node('s-1'))
    await expect.poll(() => loads).toEqual(['s-1'])
    fixture.sendServer({ type: 'entry', sessionId: 's-1', entry: user('s-1') })
    await expect.poll(rendered).toBe('1')
    fixture.sendServer({ type: 'entry', sessionId: 's-2', entry: fire('s-2') })
    await expect.poll(() => fixture.chat.getState().conversations['s-2']?.entries.length).toBe(1)
    await screen.rerender(node('s-1'))
    expect(loads).toEqual(['s-1'])
    fixture.sendServer({ type: 'entry', sessionId: 's-1', entry: fire('s-1') })
    await expect.poll(rendered).toBe('2')
    await expect.poll(() => loads).toEqual(['s-1', 's-1'])
    await screen.rerender(node('s-2'))
    await expect.poll(() => loads).toEqual(['s-1', 's-1', 's-2'])
    await screen.rerender(node(null))
    fixture.sendServer({ type: 'entry', sessionId: 's-2', entry: fire('s-2') })
    await screen.rerender(node(null))
    expect(loads).toEqual(['s-1', 's-1', 's-2'])
    await screen.unmount()
    releases.forEach((release) => release())
  })
})
