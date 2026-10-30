// 后台任务视图（docs/subsystems/jobs.md#界面）：输出组件（ANSI 颜色、长行局部横向滚动、跟随尾部与上滚暂停）、Jobs tab 的列表（key 为 jobId）、
// 停止按钮（键盘可达），以及 store 按日志字节偏移合并 HTTP 页与 WS 帧（重叠丢弃、缺口补齐）。
import '../../styles.css'
import { JOB_OUTPUT_PAGE_MAX, type JobSnapshot, type ProgressEvent } from '@coko/protocol'
import { TooltipProvider } from '@coko/ui'
import type * as React from 'react'
import { describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { ChatStoreProvider } from '../../app/chat.tsx'
import { I18nProvider } from '../../app/i18n.tsx'
import { createJobsStore, type JobsBackend, type JobsStore } from '../../stores/jobs-store.ts'
import { createFixtureChat } from '../../testing/fixture-chat.ts'
import { JobsStoreProvider } from '../conversation/jobs-button.tsx'
import { JobOutputView, JobsTab } from './jobs-tab.tsx'
import { RIGHT_PANEL_TABS } from './tabs.ts'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

const snapshot = (jobId: string, patch: Partial<JobSnapshot> = {}): JobSnapshot => ({
  jobId,
  sessionId: 's-1',
  kind: 'bash',
  label: `label of ${jobId}`,
  command: 'npm run dev',
  status: 'running',
  toolCallId: `call-${jobId}`,
  startedAt: Date.now() - 5_000,
  outputBytes: 0,
  truncated: false,
  ...patch,
})

/** 内存中的 Job 接口：日志按 UTF-8 字节分页，与 Sidecar 的 GET /api/jobs/:id/output 同形。 */
function fakeBackend(initial: JobSnapshot[], logs: Record<string, string> = {}) {
  const state = { jobs: initial, logs, kills: [] as string[], outputCalls: [] as Array<{ jobId: string; offset: number; limit: number }> }
  const backend: JobsBackend = {
    list: async () => state.jobs.slice(),
    output: async (jobId, offset, limit = JOB_OUTPUT_PAGE_MAX) => {
      state.outputCalls.push({ jobId, offset, limit })
      const bytes = encoder.encode(state.logs[jobId] ?? '')
      const start = Math.min(offset, bytes.length)
      const end = Math.min(bytes.length, start + limit)
      const job = state.jobs.find((j) => j.jobId === jobId)
      return {
        offset: start,
        chunk: decoder.decode(bytes.subarray(start, end)),
        nextOffset: end,
        done: job !== undefined && job.status !== 'running' && end >= bytes.length,
      }
    },
    kill: async (jobId) => {
      state.kills.push(jobId)
    },
  }
  return { state, backend }
}

/** 测试用的 progress 来源（chat-store 的 onProgress 同形）。 */
function progressSource() {
  const listeners = new Set<(p: { sessionId: string; runId: string; event: ProgressEvent }) => void>()
  return {
    onProgress(listener: (p: { sessionId: string; runId: string; event: ProgressEvent }) => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    emit(event: ProgressEvent) {
      for (const l of listeners) l({ sessionId: 's-1', runId: 'run-1', event })
    },
  }
}

function wrap(node: React.ReactNode, store: JobsStore) {
  const { chat } = createFixtureChat({ entries: { 's-1': [] } })
  return render(
    <I18nProvider locale="en">
      <ChatStoreProvider store={chat}>
        <JobsStoreProvider store={store}>
          <TooltipProvider>{node}</TooltipProvider>
        </JobsStoreProvider>
      </ChatStoreProvider>
    </I18nProvider>,
  )
}

const lines = (n: number, prefix = 'line') => Array.from({ length: n }, (_, i) => `${prefix} ${i + 1}`).join('\n') + '\n'

describe('输出组件', () => {
  it('SGR 颜色映射到语义色：红色与 destructive 同色，未着色的文字为前景色', async () => {
    const screen = await render(
      <I18nProvider locale="en">
        <div className="w-80">
          <span data-ref className="text-destructive">
            ref
          </span>
          <JobOutputView label="dev" text={'plain \u001b[31mred text\u001b[0m after\u001b]0;title\u0007\n'} />
        </div>
      </I18nProvider>,
    )
    await expect.element(screen.getByText('red text')).toBeVisible()
    const red = screen.getByText('red text').element() as HTMLElement
    const ref = screen.container.querySelector('[data-ref]') as HTMLElement
    expect(getComputedStyle(red).color).toBe(getComputedStyle(ref).color)
    const output = screen.container.querySelector('[data-slot="job-output"]') as HTMLElement
    expect(getComputedStyle(red).color).not.toBe(getComputedStyle(output).color)
    // 控制序列不作为文字显示。
    expect(output.textContent).toBe('plain red text after\n')
  })

  it('长行在输出区内横向滚动，不撑开面板', async () => {
    const screen = await render(
      <I18nProvider locale="en">
        <div data-panel style={{ width: 300, height: 200, display: 'flex', flexDirection: 'column' }}>
          <JobOutputView label="dev" text={'x'.repeat(2000) + '\n'} />
        </div>
      </I18nProvider>,
    )
    const panel = screen.container.querySelector('[data-panel]') as HTMLElement
    const output = screen.container.querySelector('[data-slot="job-output"]') as HTMLElement
    await expect.poll(() => output.scrollWidth).toBeGreaterThan(1000)
    expect(output.clientWidth).toBeLessThanOrEqual(300)
    expect(panel.scrollWidth).toBe(300)
    expect(panel.getBoundingClientRect().width).toBe(300)
  })

  it('跟随尾部：新输出滚到底；用户上滚后暂停，点"跟随最新输出"恢复', async () => {
    const Host = ({ text }: { text: string }) => (
      <I18nProvider locale="en">
        <div style={{ width: 300, height: 160, display: 'flex', flexDirection: 'column' }}>
          <JobOutputView label="dev" text={text} />
        </div>
      </I18nProvider>
    )
    const screen = await render(<Host text={lines(50)} />)
    const output = () => screen.container.querySelector('[data-slot="job-output"]') as HTMLElement
    const atBottom = () => output().scrollHeight - output().scrollTop - output().clientHeight < 2
    await expect.poll(atBottom).toBe(true)
    await screen.rerender(<Host text={lines(100)} />)
    await expect.poll(atBottom).toBe(true)
    expect(screen.container.querySelector('[data-action="follow-tail"]')).toBeNull()

    output().scrollTop = 0
    output().dispatchEvent(new Event('scroll'))
    await screen.rerender(<Host text={lines(150)} />)
    await expect.element(screen.getByRole('button', { name: 'Follow latest output' })).toBeVisible()
    expect(output().scrollTop).toBe(0)

    await userEvent.click(screen.getByRole('button', { name: 'Follow latest output' }))
    await expect.poll(atBottom).toBe(true)
    await screen.rerender(<Host text={lines(200)} />)
    await expect.poll(atBottom).toBe(true)
  })
})

describe('Jobs tab', () => {
  it('已交付：注册表中 jobs 可用', () => {
    expect(RIGHT_PANEL_TABS.find((t) => t.id === 'jobs')?.available).toBe(true)
  })

  it('列表显示状态、标签、时长与退出码；key 为 jobId（前面插入新项时已有行不换身份）', async () => {
    const { state, backend } = fakeBackend([
      snapshot('job_a', { status: 'completed', exitCode: 0, endedAt: Date.now() }),
      snapshot('job_b', { status: 'failed', exitCode: 2, startedAt: 1_000, endedAt: 66_000 }),
    ])
    const store = createJobsStore(backend)
    const screen = await wrap(<JobsTab sessionId="s-1" />, store)
    const row = (id: string) => screen.container.querySelector(`[data-job-id="${id}"]`) as HTMLElement | null
    await expect.poll(() => row('job_b')).not.toBeNull()
    expect(row('job_b')!.textContent).toContain('label of job_b')
    expect(row('job_b')!.textContent).toContain('Failed')
    expect(row('job_b')!.textContent).toContain('1m 5s')
    expect(row('job_b')!.textContent).toContain('exit code 2')
    const before = row('job_b')
    state.jobs = [snapshot('job_c', { startedAt: 0 }), ...state.jobs]
    await store.getState().load('s-1')
    await expect.poll(() => row('job_c')).not.toBeNull()
    expect(row('job_b')).toBe(before)
    expect(row('job_b')!.textContent).toContain('label of job_b')
  })

  it('选中项显示输出；停止按钮可经键盘到达并停止', async () => {
    const { state, backend } = fakeBackend([snapshot('job_a', { label: 'npm run dev' })], { job_a: 'ready on :3000\n' })
    const store = createJobsStore(backend)
    const screen = await wrap(<JobsTab sessionId="s-1" />, store)
    await expect.element(screen.getByText('ready on :3000')).toBeVisible()
    const stop = screen.getByRole('button', { name: 'Stop' })
    ;(stop.element() as HTMLElement).focus()
    await userEvent.keyboard('{Enter}')
    await expect.poll(() => state.kills).toEqual(['job_a'])
  })

  it('缺省选中最近启动的运行中 Job；它结束后详情不跳到另一个运行中的 Job', async () => {
    const { state, backend } = fakeBackend([snapshot('job_a'), snapshot('job_b')])
    const store = createJobsStore(backend)
    const source = progressSource()
    store.getState().attach(source)
    const screen = await wrap(<JobsTab sessionId="s-1" />, store)
    const detail = () => screen.container.querySelector('[data-slot="job-detail"]')
    await expect.poll(() => detail()?.getAttribute('data-job-id')).toBe('job_b')
    const killed = snapshot('job_b', { status: 'killed', signal: 'SIGTERM', endedAt: Date.now() })
    state.jobs = [state.jobs[0]!, killed]
    source.emit({ type: 'job_update', job: killed })
    await expect.poll(() => detail()?.getAttribute('data-status')).toBe('killed')
    expect(detail()?.getAttribute('data-job-id')).toBe('job_b')
  })

  it('store：WS 帧按字节偏移追加，重叠部分丢弃，缺口时从接口补齐', async () => {
    const log = 'héllo\n'
    const { state, backend } = fakeBackend([snapshot('job_a')], { job_a: log })
    const store = createJobsStore(backend)
    const source = progressSource()
    store.getState().attach(source)
    await store.getState().load('s-1')
    await store.getState().watchOutput('job_a')
    expect(store.getState().outputs.job_a).toMatchObject({ status: 'ready', start: 0, end: encoder.encode(log).length, text: log })

    const end = encoder.encode(log).length
    // 与窗口重叠的帧：只取新部分。
    state.logs.job_a = log + 'wörld\n'
    source.emit({ type: 'job_output', jobId: 'job_a', offset: end - 2, chunk: 'o\nwörld\n' })
    expect(store.getState().outputs.job_a?.text).toBe('héllo\nwörld\n')
    // 缺口：中间的输出从接口补齐。
    state.logs.job_a += 'gap\nafter\n'
    const offset = encoder.encode(state.logs.job_a).length - encoder.encode('after\n').length
    source.emit({ type: 'job_output', jobId: 'job_a', offset, chunk: 'after\n' })
    await expect.poll(() => store.getState().outputs.job_a?.text).toBe('héllo\nwörld\ngap\nafter\n')

    source.emit({ type: 'job_update', job: snapshot('job_a', { status: 'killed', signal: 'SIGTERM', endedAt: Date.now() }) })
    expect(store.getState().sessions['s-1']?.jobs[0]?.status).toBe('killed')
  })

  it('store：长输出先读末尾一页，从行首开始；可加载更早的输出', async () => {
    const log = lines(400)
    const { backend } = fakeBackend([snapshot('job_a', { status: 'completed', exitCode: 0 })], { job_a: log })
    const store = createJobsStore(backend, { tailBytes: 1000 })
    await store.getState().load('s-1')
    await store.getState().watchOutput('job_a')
    const first = store.getState().outputs.job_a!
    expect(first.done).toBe(true)
    expect(first.start).toBeGreaterThan(0)
    expect(first.text.startsWith('line ')).toBe(true)
    expect(log.endsWith(first.text)).toBe(true)
    expect(encoder.encode(first.text).length).toBe(first.end - first.start)
    await store.getState().loadEarlier('job_a')
    expect(store.getState().outputs.job_a?.text).toBe(log)
    expect(store.getState().outputs.job_a?.start).toBe(0)
  })
})
