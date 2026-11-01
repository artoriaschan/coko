// 时间线中的团队紧凑行与工具卡（docs/subsystems/teams.md#界面）：team_message 行显示发送方 → 接收方与 summary，送达它的 <team-message>
// 包装不成气泡、DOM 中没有原文；用户自己输入的同样文本照常显示为气泡；team_task 行按快照显示创建、认领、完成与删除；send_message 与
// task_* 的工具卡标题、摘要与明细。
import '../../styles.css'
import type { SessionEntryRecord } from '@coko/protocol'
import { TooltipProvider } from '@coko/ui'
import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { I18nProvider } from '../../app/i18n.tsx'
import type { SessionEntry } from '@coko/protocol'
import { buildTimeline } from './timeline.ts'
import { TimelineView } from './timeline-view.tsx'

let seq = 0
const rec = (kind: string, payload: unknown): SessionEntryRecord => ({
  sessionId: 's-1',
  seq: ++seq,
  kind,
  payloadVersion: 1,
  payload,
  runId: 'r1',
  createdAt: seq,
})
const user = (content: string) => rec('message', { role: 'user', content, timestamp: 0 })
const call = (id: string, name: string, args: Record<string, unknown>) =>
  rec('message', { role: 'assistant', content: [{ type: 'toolCall', id, name, arguments: args }], stopReason: 'toolUse', timestamp: 0 })
const result = (id: string, name: string, text: string, isError = false) =>
  rec('message', { role: 'toolResult', toolCallId: id, toolName: name, content: [{ type: 'text', text }], isError, timestamp: 0 })
const task = (patch: Record<string, unknown>) =>
  rec('team_task', {
    taskId: 't1',
    revision: 1,
    subject: 'Build the API',
    description: '',
    status: 'pending',
    blockedBy: [],
    writeScopes: [],
    by: 'lead',
    ...patch,
  })

async function mount(entries: SessionEntryRecord[], locale: 'en' | 'zh' = 'en') {
  const items = buildTimeline({ status: 'ready', entries: entries as unknown as SessionEntry[], lastSeq: seq, running: false, live: null })
  return render(
    <I18nProvider locale={locale}>
      <TooltipProvider>
        <div style={{ width: 600 }} className="flex flex-col gap-4">
          <TimelineView items={items} theme="light" onRetry={() => {}} actionsDisabled />
        </div>
      </TooltipProvider>
    </I18nProvider>,
  )
}

describe('团队的时间线行', () => {
  it('team_message：发送方 → 接收方与 summary，宿主包装不成气泡；用户输入的同样文本照常显示', async () => {
    await mount([
      rec('team_message', { messageId: 'm1', from: 'lead', to: 'alice', summary: 'please build the api' }),
      user('<team-message from="lead" message-id="m1">HIDDEN-BODY build it</team-message>'),
      rec('team_message', { messageId: 'm2', from: 'bob', to: 'lead' }),
      user('<team-message from="bob" message-id="m2">HIDDEN-SECOND</team-message>'),
      user('<team-message from="mallory" message-id="x">TYPED-BY-USER</team-message>'),
    ])
    const rows = [...document.querySelectorAll('[data-slot="team-message"]')]
    expect(rows.map((r) => [r.getAttribute('data-from'), r.getAttribute('data-to')])).toEqual([
      ['lead', 'alice'],
      ['bob', 'lead'],
    ])
    expect(rows[0]!.querySelector('[data-slot="team-message-route"]')?.getAttribute('aria-label')).toBe('lead to alice')
    expect(rows[0]!.querySelector('[data-slot="team-message-summary"]')?.textContent).toBe('please build the api')
    expect(rows[1]!.querySelector('[data-slot="team-message-summary"]')).toBeNull()
    const text = document.body.textContent ?? ''
    expect(text).not.toContain('HIDDEN-BODY')
    expect(text).not.toContain('HIDDEN-SECOND')
    // 只有一个气泡：用户自己输入的伪造标签原样显示。
    const bubbles = [...document.querySelectorAll('p.bg-bubble[data-user-content]')]
    expect(bubbles).toHaveLength(1)
    expect(bubbles[0]!.textContent).toContain('<team-message from="mallory" message-id="x">TYPED-BY-USER</team-message>')
  })

  it('team_task：创建、认领、完成、删除与其他更新各一行，带任务编号与标题', async () => {
    await mount([
      task({}),
      task({ revision: 2, status: 'in_progress', owner: 'alice', by: 'alice' }),
      task({ revision: 3, status: 'in_progress', owner: 'alice', by: 'lead', subject: 'Build the API v2' }),
      task({ revision: 4, status: 'completed', owner: 'alice', by: 'alice', subject: 'Build the API v2' }),
      task({ revision: 5, status: 'deleted', owner: 'alice', by: 'lead', subject: 'Build the API v2' }),
    ])
    const rows = [...document.querySelectorAll('[data-slot="team-task"]')]
    expect(rows.map((r) => r.getAttribute('data-task-change'))).toEqual(['created', 'claimed', 'updated', 'completed', 'deleted'])
    expect(rows[0]!.textContent).toBe('lead created a taskt1Build the API')
    expect(rows[1]!.textContent).toContain('alice claimed a task')
    expect(rows[3]!.textContent).toContain('alice completed a task')
    expect(rows[3]!.textContent).toContain('Build the API v2')
  })

  it('send_message 与 task_* 的工具卡：标题、摘要与明细', async () => {
    await mount([
      call('c1', 'send_message', { to: 'alice', message: 'MESSAGE-BODY please start', summary: 'start t1' }),
      result('c1', 'send_message', 'Sent to alice (message m1).'),
      call('c2', 'task_create', { subject: 'Write docs' }),
      result('c2', 'task_create', 'Created t2 (revision 1).'),
      call('c3', 'task_update', { id: 't2', expected_revision: 1, status: 'in_progress' }),
      result('c3', 'task_update', 'stale-revision: t2', true),
      call('c4', 'task_list', {}),
      result('c4', 'task_list', '{"tasks":[]}'),
    ])
    const card = (tool: string) => document.querySelector(`[data-slot="tool-card"][data-tool="${tool}"]`)!
    expect(card('send_message').textContent).toContain('Send message')
    expect(card('send_message').textContent).toContain('alice · start t1')
    expect(card('task_create').textContent).toContain('Create task')
    expect(card('task_create').textContent).toContain('Write docs')
    expect(card('task_update').textContent).toContain('Update task')
    expect(card('task_update').textContent).toContain('t2 · in_progress')
    expect(card('task_list').textContent).toContain('View task board')
    // send_message 展开：消息正文与结果；出错的 task_update 默认展开显示错误。
    await page.getByRole('button', { name: /Send message/ }).click()
    expect(card('send_message').querySelector('[data-slot="tool-card-body"]')?.textContent).toContain('MESSAGE-BODY please start')
    expect(card('send_message').querySelector('[data-slot="tool-card-body"]')?.textContent).toContain('Sent to alice (message m1).')
    expect(card('task_update').querySelector('[data-slot="tool-card-body"]')?.textContent).toContain('stale-revision: t2')
  })

  it('中文文案', async () => {
    await mount(
      [
        task({}),
        rec('team_message', { messageId: 'm3', from: 'lead', to: 'bob', summary: 's' }),
        user('<team-message from="lead" message-id="m3">x</team-message>'),
      ],
      'zh',
    )
    expect(document.querySelector('[data-slot="team-task"]')?.textContent).toContain('lead 创建了任务')
    expect(document.querySelector('[data-slot="team-message-route"]')?.getAttribute('aria-label')).toBe('lead 发给 bob')
  })
})
