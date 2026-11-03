// 时间线中的后台任务（docs/subsystems/jobs.md#界面）：后台 bash 工具卡的 Job chip（点击请求在右栏打开该 Job）、job_notification 紧凑行
// （标签与状态来自条目），通知文本不进入用户气泡；待送达的追加指令不再显示为时间线气泡（dock 的 Queue 卡为唯一呈现）。
import '../../styles.css'
import type { SessionEntryRecord } from '@coko/protocol'
import { TooltipProvider } from '@coko/ui'
import type * as React from 'react'
import { describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { ChatStoreProvider } from '../../app/chat.tsx'
import { I18nProvider } from '../../app/i18n.tsx'
import type { ChatStore } from '../../stores/chat-store.ts'
import { createJobsStore, type JobsStore } from '../../stores/jobs-store.ts'
import { createFixtureChat } from '../../testing/fixture-chat.ts'
import { JobsStoreProvider } from './jobs-button.tsx'
import { buildTimeline, type TimelineItem } from './timeline.ts'
import { TimelineView } from './timeline-view.tsx'

let seq = 0
const entry = (kind: string, payload: unknown, runId: string | null = 'run-1'): SessionEntryRecord => ({
  sessionId: 's-1',
  seq: ++seq,
  kind,
  payloadVersion: 1,
  payload,
  runId,
  createdAt: seq,
})
const NOTE = '<job-notification>\n<job-id>job_0123456789ab</job-id>\n<status>killed</status>\n</job-notification>\n\n'

function entries(): SessionEntryRecord[] {
  seq = 0
  return [
    entry('run_start', { trigger: 'submit' }),
    entry('message', { role: 'user', content: [{ type: 'text', text: 'start the server' }], timestamp: 0 }),
    entry('message', {
      role: 'assistant',
      content: [{ type: 'toolCall', id: 'b1', name: 'bash', arguments: { command: 'npm run dev', run_in_background: true } }],
      stopReason: 'toolUse',
      timestamp: 0,
    }),
    entry(
      'job_start',
      { jobId: 'job_0123456789ab', kind: 'bash', label: 'npm run dev', command: 'npm run dev', toolCallId: 'b1', logPath: '/tmp/x.log' },
      null,
    ),
    entry('message', {
      role: 'toolResult',
      toolCallId: 'b1',
      toolName: 'bash',
      content: [{ type: 'text', text: 'Started background job job_0123456789ab: npm run dev. Read output with job_output.' }],
      isError: false,
      timestamp: 0,
    }),
    entry('run_end', { status: 'completed' }),
    entry('job_end', { jobId: 'job_0123456789ab', status: 'killed', signal: 'SIGTERM', outputBytes: 10, truncated: false }, null),
    entry('run_start', { trigger: 'submit' }),
    entry('job_notification', { jobIds: ['job_0123456789ab'] }),
    entry('message', {
      role: 'user',
      content: [
        { type: 'text', text: NOTE },
        { type: 'text', text: 'what happened?' },
      ],
      timestamp: 0,
    }),
    entry('run_end', { status: 'completed' }),
  ]
}

async function mount(chat: ChatStore, jobs: JobsStore, items: () => TimelineItem[]) {
  const View = () => <TimelineView items={items()} theme="light" onRetry={() => {}} />
  const wrap = (node: React.ReactNode) => (
    <I18nProvider locale="en">
      <ChatStoreProvider store={chat}>
        <JobsStoreProvider store={jobs}>
          <TooltipProvider>{node}</TooltipProvider>
        </JobsStoreProvider>
      </ChatStoreProvider>
    </I18nProvider>
  )
  return render(wrap(<View />))
}

const noBackend = { list: async () => [], output: async () => ({ offset: 0, chunk: '', nextOffset: 0, done: true }), kill: async () => {} }

describe('时间线中的后台任务', () => {
  it('Job chip 与通知行：标签与状态来自条目，点击请求打开该 Job；通知文本不进入用户气泡', async () => {
    const { chat } = createFixtureChat({ entries: { 's-1': entries() } })
    await chat.getState().openSession('s-1')
    await expect.poll(() => chat.getState().conversations['s-1']?.status).toBe('ready')
    const jobs = createJobsStore(noBackend)
    const screen = await mount(chat, jobs, () => buildTimeline(chat.getState().conversations['s-1']!))

    await userEvent.click(screen.container.querySelector('[data-slot="tool-card"] button')!)
    const chip = screen.container.querySelector('[data-slot="job-chip"]') as HTMLElement
    expect(chip.getAttribute('data-job-id')).toBe('job_0123456789ab')
    expect(chip.textContent).toBe('npm run dev')
    expect(chip.querySelector('[data-job-status]')?.getAttribute('data-job-status')).toBe('killed')
    await userEvent.click(chip)
    expect(jobs.getState().selected['s-1']).toBe('job_0123456789ab')
    expect(jobs.getState().openRequests['s-1']).toBe(1)

    const row = screen.container.querySelector('[data-slot="job-notification"]') as HTMLElement
    expect(row.textContent).toContain('Background task finished')
    expect(row.textContent).toContain('npm run dev')
    expect(row.textContent).toContain('Stopped · signal SIGTERM')
    await userEvent.click(screen.getByRole('button', { name: 'Open background task npm run dev' }).last())
    expect(jobs.getState().openRequests['s-1']).toBe(2)

    const bubbles = [...screen.container.querySelectorAll('article[aria-label="You"]')].map((a) => a.textContent)
    expect(bubbles).toEqual(['start the server', 'what happened?'])
  })

  it('待送达的追加指令不在时间线中显示', async () => {
    const { chat } = createFixtureChat({ entries: { 's-1': [] } })
    await chat.getState().openSession('s-1')
    await expect.poll(() => chat.getState().conversations['s-1']?.status).toBe('ready')
    const items: TimelineItem[] = [{ kind: 'steering', key: 'steering:0', text: 'also check the README' }]
    const screen = await mount(chat, createJobsStore(noBackend), () => items)
    expect(screen.container.textContent).not.toContain('also check the README')
    expect(screen.container.querySelector('[data-steering]')).toBeNull()
  })
})
