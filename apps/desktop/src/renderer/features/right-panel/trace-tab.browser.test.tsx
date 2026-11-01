// 右栏 Trace tab（docs/subsystems/tracing.md#界面）：在应用中（内存协议后端）打开右栏的 Trace tab；追踪与导出经注入的 TraceBackend
// （与 GET …/trace、…/export 同形）。最近的 Run 在最上面，展开为请求与工具行（键盘可达）；影响追踪的条目到达时重读（同一帧合并）；
// 导出交给下载并提示文件名；读取失败时可重试。
import '../../styles.css'
import type { RunTrace, SessionEntryRecord, TraceResponse } from '@coko/protocol'
import { expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { App } from '../../app/app.tsx'
import { createAppearanceStore } from '../../app/appearance-store.ts'
import { createConnectionStore } from '../../app/connection-store.ts'
import { createPreferences } from '../../app/preferences.ts'
import { createSettingsPageStore } from '../../app/settings-page-store.ts'
import { createTraceStore, type TraceBackend } from '../../stores/trace-store.ts'
import { createFixtureChat } from '../../testing/fixture-chat.ts'
import { TraceStoreProvider } from './trace-tab.tsx'

const usage = { input: 100, output: 20, cacheRead: 0, cacheWrite: 0, total: 120 }
const run = (runId: string, patch: Partial<RunTrace> = {}): RunTrace => ({
  runId,
  trigger: 'submit',
  status: 'completed',
  startedAt: 1,
  durationMs: 2_500,
  requests: [
    {
      runId,
      provider: 'faux',
      model: 'faux-1',
      startedAt: 1,
      durationMs: 800,
      ttftMs: 120,
      usage,
      cost: 0.0123,
      stopReason: 'toolUse',
      retries: 2,
      purpose: 'turn',
    },
  ],
  tools: [
    {
      toolCallId: `${runId}-c1`,
      name: 'bash',
      startedAt: 1,
      durationMs: 1_700,
      execMs: 40,
      isError: false,
      approvalWaitMs: 1_500,
      approval: 'allowed',
      approvalBy: 'user',
      hooks: [{ event: 'PreToolUse', hookId: 'global:PreToolUse:0:0', source: 'global', outcome: 'asked', durationMs: 9 }],
    },
  ],
  hooks: [],
  usage,
  tokens: 120,
  cost: 0.0123,
  ...patch,
})
const response = (runs: RunTrace[]): TraceResponse => ({
  runs,
  totals: {
    runs: runs.length,
    requests: runs.reduce((n, r) => n + r.requests.length, 0),
    toolCalls: runs.reduce((n, r) => n + r.tools.length, 0),
    tokens: runs.reduce((n, r) => n + r.tokens, 0),
    cost: runs.reduce((n, r) => n + r.cost, 0),
    durationMs: 0,
  },
})

function fakeTrace(initial: TraceResponse) {
  const state = { response: initial, reads: 0, exports: [] as string[], fail: false }
  const backend: TraceBackend = {
    trace: async () => {
      state.reads++
      if (state.fail) throw new Error('offline')
      return state.response
    },
    export: async (sessionId) => {
      state.exports.push(sessionId)
      return { filename: `coko-session-${sessionId}.ndjson`, text: '{"type":"header"}\n' }
    },
  }
  return { state, backend }
}

let seq = 5000
const record = (kind: string, payload: unknown, runId: string | null = 'run-x'): SessionEntryRecord =>
  ({ sessionId: 's-1', seq: ++seq, kind, payloadVersion: 1, payload, runId, createdAt: seq }) as SessionEntryRecord

async function open(trace: ReturnType<typeof fakeTrace>) {
  const fixture = createFixtureChat()
  const store = createAppearanceStore({ theme: 'light', locale: 'en' })
  const preferences = createPreferences({ appearance: store, settings: fixture.settings, onConflict: () => {}, onFailure: () => {} })
  await render(
    <div style={{ width: '100vw', height: '100vh' }}>
      <TraceStoreProvider store={createTraceStore(trace.backend)}>
        <App
          store={store}
          connection={createConnectionStore()}
          chat={fixture.chat}
          settings={fixture.settings}
          preferences={preferences}
          settingsPage={createSettingsPageStore()}
          pickDirectory={async () => null}
        />
      </TraceStoreProvider>
    </div>,
  )
  await expect.poll(() => fixture.chat.getState().conversations['s-1']?.status).toBe('ready')
  await page.getByRole('button', { name: 'Open right panel' }).click()
  await page.getByRole('tab', { name: 'Trace' }).click()
  await expect.poll(() => document.querySelector('[role="tab"][data-tab="trace"]')?.getAttribute('aria-selected')).toBe('true')
  return fixture
}

const runRows = () => [...document.querySelectorAll<HTMLElement>('[data-slot="trace-run"]')]
/** 等两帧：同一帧内合并的重读已经发出。 */
const frames = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))

it('最近的 Run 在最上面；合计；键盘展开为请求与工具行（首字、重试、审批等待与 Hook 结果）', async () => {
  const trace = fakeTrace(response([run('run-1', { trigger: 'goal' }), run('run-2', { status: 'error', errorCode: 'model_error' })]))
  await open(trace)
  await expect.poll(() => runRows().length).toBe(2)
  expect(runRows().map((r) => r.dataset.runId)).toEqual(['run-2', 'run-1'])
  expect(runRows()[1]!.textContent).toContain('Goal round')
  expect(runRows()[0]!.textContent).toContain('Error · 2.5 s · 120 tokens · $0.0123')
  const totals = document.querySelector('[data-slot="trace-totals"]')!.textContent
  expect(totals).toContain('240 tokens · $0.0246')
  expect(totals).toContain('2 runs · 2 requests · 2 tool calls')

  const toggle = runRows()[1]!.querySelector<HTMLButtonElement>('[data-action="toggle-run"]')!
  expect(toggle.getAttribute('aria-expanded')).toBe('false')
  toggle.focus()
  await userEvent.keyboard('{Enter}')
  await expect.poll(() => toggle.getAttribute('aria-expanded')).toBe('true')
  const details = document.getElementById(toggle.getAttribute('aria-controls')!)!
  expect(details.querySelector('[data-slot="trace-request"]')!.textContent).toBe('faux-1Turn800 ms · TTFT 120 ms · 120 tokens · $0.0123 · 2 retries')
  const tool = details.querySelector<HTMLElement>('[data-slot="trace-tool"]')!
  expect(tool.dataset.tool).toBe('bash')
  expect(tool.textContent).toContain('1.7 s · Approval wait 1.5 s · Allowed')
  expect(tool.querySelector('[data-slot="trace-hook"]')!.textContent).toBe('PreToolUse · asked · 9 ms')
  await userEvent.keyboard(' ')
  await expect.poll(() => toggle.getAttribute('aria-expanded')).toBe('false')
})

it('model_request、run_start 与 run_end 到达时重读，同一帧内的多条合并为一次；其他条目不触发', async () => {
  const trace = fakeTrace(response([run('run-1')]))
  const fixture = await open(trace)
  await expect.poll(() => trace.state.reads).toBe(1)
  await frames()
  const before = trace.state.reads
  for (let i = 0; i < 5; i++) fixture.sendServer({ type: 'entry', sessionId: 's-1', entry: record('message', { role: 'user', content: 'x' }) })
  await frames()
  expect(trace.state.reads).toBe(before)

  trace.state.response = response([run('run-1'), run('run-2')])
  fixture.sendServer({ type: 'entry', sessionId: 's-1', entry: record('run_start', { trigger: 'submit' }, 'run-2') })
  fixture.sendServer({ type: 'entry', sessionId: 's-1', entry: record('model_request', run('run-2').requests[0], 'run-2') })
  fixture.sendServer({ type: 'entry', sessionId: 's-1', entry: record('run_end', { status: 'completed' }, 'run-2') })
  await expect.poll(() => runRows().map((r) => r.dataset.runId)).toEqual(['run-2', 'run-1'])
  await frames()
  expect(trace.state.reads - before).toBe(1)
})

it('导出：读取 ?children=1 的文本并交给下载，提示文件名；导出中按钮不可用', async () => {
  const trace = fakeTrace(response([run('run-1')]))
  await open(trace)
  await expect.poll(() => runRows().length).toBe(1)
  const clicked: { download: string; href: string }[] = []
  const original = HTMLAnchorElement.prototype.click
  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    clicked.push({ download: this.download, href: this.href })
  }
  try {
    await page.getByRole('button', { name: 'Export' }).click()
    await expect.poll(() => clicked).toEqual([{ download: 'coko-session-s-1.ndjson', href: expect.stringMatching(/^blob:/) }])
  } finally {
    HTMLAnchorElement.prototype.click = original
  }
  expect(trace.state.exports).toEqual(['s-1'])
  await expect.element(page.getByText('Exported coko-session-s-1.ndjson')).toBeVisible()
})

it('读取失败：没有内容时为错误与重试；有内容时保留内容并显示紧凑提示', async () => {
  const trace = fakeTrace(response([]))
  trace.state.fail = true
  await open(trace)
  await expect.element(page.getByText('Couldn’t load the trace')).toBeVisible()
  trace.state.fail = false
  trace.state.response = response([run('run-1')])
  await page.getByRole('button', { name: 'Retry' }).click()
  await expect.poll(() => runRows().length).toBe(1)
})
