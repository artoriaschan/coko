// 后台任务的 agent 部分（docs/subsystems/jobs.md）：环形缓冲与游标、ANSI 去除、等待的三种返回、通知文本、工具结果与"不再通知"标记。
// 进程、日志与条目由 apps/server 的 JobService 负责，见 tests/integration/sidecar-jobs.test.ts。
import { describe, expect, it } from 'vitest'
import { BackgroundJob, jobNotificationText, nextLine, NOTIFICATION_OUTPUT_MAX, statusLine } from './job.ts'
import { jobLabel, OutputRing, stripAnsi } from './output.ts'
import { createJobInputTool, createJobKillTool, createJobListTool, createJobOutputTool, JOB_WAIT_MAX_MS, type JobsPort } from './tools.ts'

const info = { jobId: 'j1', sessionId: 's1', kind: 'bash' as const, label: 'npm test', command: 'npm test', toolCallId: 'c1', startedAt: 1 }

function harness() {
  const job = new BackgroundJob(info)
  let interrupt = new AbortController()
  const kills: string[] = []
  const inputs: string[] = []
  const port: JobsPort = {
    input: (id, data) => void inputs.push(`${id}:${JSON.stringify(data)}`),
    get: (id) => (id === 'j1' ? job : undefined),
    list: async () => [job.snapshot()],
    kill: async (id) => {
      kills.push(id)
      job.requestStop()
      job.finish({ exitCode: 143, signal: 'SIGTERM' })
    },
    interrupt: () => interrupt.signal,
  }
  const output = createJobOutputTool(port)
  const read = async (args: { wait?: boolean; timeout_ms?: number } = {}, signal?: AbortSignal) => {
    const result = await output.execute('t', { job_id: 'j1', ...args }, signal)
    return (result.content[0] as { text: string }).text
  }
  return {
    job,
    port,
    kills,
    inputs,
    read,
    steer: () => {
      interrupt.abort()
      interrupt = new AbortController()
    },
  }
}

describe('OutputRing', () => {
  it.each([
    { name: '未超出容量时全部保留', capacity: 10, chunks: ['abc', 'def'], from: 0, text: 'abcdef', dropped: 0, start: 0 },
    { name: '超出容量丢弃最早的字节，偏移不重置', capacity: 4, chunks: ['abc', 'def'], from: 0, text: 'cdef', dropped: 2, start: 2 },
    { name: '从中间偏移读', capacity: 10, chunks: ['abc', 'def'], from: 3, text: 'def', dropped: 0, start: 0 },
    { name: '整块被挤出', capacity: 3, chunks: ['ab', 'cd', 'efg'], from: 1, text: 'efg', dropped: 3, start: 4 },
  ])('$name', ({ capacity, chunks, from, text, dropped, start }) => {
    const ring = new OutputRing(capacity)
    for (const chunk of chunks) ring.append(chunk)
    expect(ring.start).toBe(start)
    expect(ring.read(from)).toMatchObject({ text, dropped, nextOffset: chunks.join('').length })
  })

  it('偏移按 UTF-8 字节计', () => {
    const ring = new OutputRing()
    expect(ring.append('你好')).toBe(0)
    expect(ring.append('x')).toBe(6)
    expect(ring.end).toBe(7)
  })
})

describe('stripAnsi 与 label', () => {
  it.each([
    ['\u001b[31mred\u001b[0m', 'red'],
    ['\u001b[2K\u001b[1Gprogress', 'progress'],
    ['\u001b]0;title\u0007text', 'text'],
    ['line\r\nnext', 'line\nnext'],
    ['plain [brackets]', 'plain [brackets]'],
  ])('%j → %j', (input, expected) => expect(stripAnsi(input)).toBe(expected))

  it.each([
    ['npm run dev', 'npm run dev'],
    ['\n  cd app\nnpm start', 'cd app'],
    ['x'.repeat(200), 'x'.repeat(119) + '…'],
  ])('label of %j', (command, label) => expect(jobLabel(command)).toBe(label))
})

describe('job_output', () => {
  it('游标只返回上次读取之后的输出，ANSI 被去除，末尾为 [status: …]', async () => {
    const h = harness()
    h.job.append('\u001b[32m1\u001b[0m\n')
    expect(await h.read()).toBe('1\n\n\n[status: running]')
    expect(await h.read()).toBe('(no new output)\n\n[status: running]')
    h.job.append('2\n')
    expect(await h.read()).toBe('2\n\n\n[status: running]')
  })

  it.each([
    { name: '结束时返回', act: (h: ReturnType<typeof harness>) => h.job.finish({ exitCode: 0 }), status: '[status: completed]', observed: true },
    { name: '失败带退出码', act: (h: ReturnType<typeof harness>) => h.job.finish({ exitCode: 2 }), status: '[status: failed (exit code 2)]', observed: true },
    { name: '追加指令到达时返回', act: (h: ReturnType<typeof harness>) => h.steer(), status: '[status: running]', observed: false },
  ])('wait：$name', async ({ act, status, observed }) => {
    const h = harness()
    const pending = h.read({ wait: true, timeout_ms: 60_000 })
    h.job.append('done\n')
    act(h)
    const text = await pending
    expect(text).toContain('done')
    expect(text.endsWith(status)).toBe(true)
    expect(h.job.observedEnd).toBe(observed)
  })

  it('wait：超时后返回 running，不标记已读到终态', async () => {
    const h = harness()
    const started = Date.now()
    expect(await h.read({ wait: true, timeout_ms: 30 })).toBe('(no new output)\n\n[status: running]')
    expect(Date.now() - started).toBeGreaterThanOrEqual(25)
    expect(h.job.observedEnd).toBe(false)
  })

  it('wait：工具被取消时 reject，游标不前移', async () => {
    const h = harness()
    h.job.append('kept\n')
    const abort = new AbortController()
    const pending = h.read({ wait: true }, abort.signal)
    abort.abort()
    await expect(pending).rejects.toThrow('Operation aborted')
    expect(await h.read()).toContain('kept')
  })

  it('timeout_ms 上限 600 000', () => {
    const tool = createJobOutputTool(harness().port)
    expect(JOB_WAIT_MAX_MS).toBe(600_000)
    expect(JSON.stringify(tool.parameters)).toContain('at most 600000')
  })

  it('大量输出按工具输出规则保留末尾并注明', async () => {
    const h = harness()
    h.job.append(Array.from({ length: 2500 }, (_, i) => 'line ' + i).join('\n'))
    const text = await h.read()
    expect(text).toContain('line 2499')
    expect(text).not.toContain('line 0\n')
    expect(text).toContain('[Showing the last 2000 of 2500 lines')
  })

  it('其他 Session 或未知 id：错误', async () => {
    const tool = createJobOutputTool(harness().port)
    await expect(tool.execute('t', { job_id: 'other' })).rejects.toThrow('No background job other in this session')
  })
})

describe('job_kill 与 job_list', () => {
  it('job_kill 停止运行中的 Job 并标记不再通知；已结束的返回当前状态', async () => {
    const h = harness()
    const kill = createJobKillTool(h.port)
    const first = await kill.execute('t', { job_id: 'j1' })
    expect((first.content[0] as { text: string }).text).toBe('Stopped background job j1: npm test\n\n[status: killed (signal SIGTERM)]')
    expect(h.job.observedEnd).toBe(true)
    const second = await kill.execute('t', { job_id: 'j1' })
    expect((second.content[0] as { text: string }).text).toContain('already ended')
    expect(h.kills).toEqual(['j1'])
  })

  it('job_list 每个 Job 一行', async () => {
    const h = harness()
    const text = ((await createJobListTool(h.port).execute('t', {})).content[0] as { text: string }).text
    expect(text).toBe('j1 [bash] running — npm test')
  })
})

describe('job_input', () => {
  const ptyInfo = { ...info, jobId: 'p1', kind: 'pty' as const, label: 'python3 -i', command: 'python3 -i' }
  function inputHarness() {
    const jobs = new Map<string, BackgroundJob>([
      ['j1', new BackgroundJob(info)],
      ['p1', new BackgroundJob(ptyInfo)],
      ['p2', new BackgroundJob({ ...ptyInfo, jobId: 'p2' })],
      ['p3', new BackgroundJob({ ...ptyInfo, jobId: 'p3' })],
    ])
    jobs.get('p2')!.requestStop()
    jobs.get('p3')!.finish({ exitCode: 0 })
    const inputs: string[] = []
    const port: JobsPort = {
      get: (id) => jobs.get(id),
      list: async () => [...jobs.values()].map((j) => j.snapshot()),
      kill: async () => undefined,
      interrupt: () => new AbortController().signal,
      input: (id, data) => void inputs.push(`${id}:${data}`),
    }
    return { tool: createJobInputTool(port), inputs }
  }
  const run = async (args: { job_id: string; text: string; submit?: boolean; ctrl_c?: boolean }) => {
    const h = inputHarness()
    const outcome = await h.tool.execute('t', args).then(
      (r) => ({ kind: 'ok', text: (r.content[0] as { text: string }).text }),
      (e: Error) => ({ kind: 'error', text: e.message }),
    )
    return { outcome, inputs: h.inputs }
  }

  it.each([
    {
      name: 'running 的 pty：写入原文',
      args: { job_id: 'p1', text: 'abc' },
      inputs: ['p1:abc'],
      kind: 'ok',
      text: 'Sent 3 characters to background job p1. Read the response with job_output.',
    },
    {
      name: 'submit 追加 \\r',
      args: { job_id: 'p1', text: 'print(6*7)', submit: true },
      inputs: ['p1:print(6*7)\r'],
      kind: 'ok',
      text: 'Sent 10 characters and Enter',
    },
    { name: 'ctrl_c 先写 \\x03', args: { job_id: 'p1', text: '', ctrl_c: true }, inputs: ['p1:\u0003'], kind: 'ok', text: 'Sent Ctrl-C to background job p1' },
    {
      name: 'ctrl_c 与文本：先中断再输入',
      args: { job_id: 'p1', text: 'ls', ctrl_c: true, submit: true },
      inputs: ['p1:\u0003ls\r'],
      kind: 'ok',
      text: 'Sent Ctrl-C, then 2 characters and Enter',
    },
    {
      name: '非 PTY Job：stdin 已关闭',
      args: { job_id: 'j1', text: 'y' },
      inputs: [],
      kind: 'error',
      text: 'Background job j1 is not a terminal job: its stdin is closed. Start it with bash tty: true',
    },
    {
      name: 'stopping 的 pty：不接受',
      args: { job_id: 'p2', text: 'y' },
      inputs: [],
      kind: 'error',
      text: 'Background job p2 is not running (status: stopping)',
    },
    {
      name: '已结束的 pty：不接受',
      args: { job_id: 'p3', text: 'y' },
      inputs: [],
      kind: 'error',
      text: 'Background job p3 is not running (status: completed)',
    },
    { name: '未知 id', args: { job_id: 'zz', text: 'y' }, inputs: [], kind: 'error', text: 'No background job zz in this session' },
    { name: '没有文本、submit 与 ctrl_c：参数错误', args: { job_id: 'p1', text: '' }, inputs: [], kind: 'error', text: 'Nothing to send' },
  ])('$name', async ({ args, inputs, kind, text }) => {
    const result = await run(args)
    expect(result.outcome.kind).toBe(kind)
    expect(result.outcome.text).toContain(text)
    expect(result.inputs).toEqual(inputs)
  })

  it('判定对象为 text', () => {
    const { tool } = inputHarness()
    expect(tool.permissionSubject?.({ job_id: 'p1', text: 'rm -rf x', submit: true })).toBe('rm -rf x')
    expect(tool.effect).toBe('side-effect')
  })
})

describe('状态机', () => {
  it.each([
    { name: 'running → completed', stop: false, exit: 0, status: 'completed' },
    { name: 'running → failed', stop: false, exit: 1, status: 'failed' },
    { name: 'stopping → killed（即使退出码为 0）', stop: true, exit: 0, status: 'killed' },
  ])('$name', ({ stop, exit, status }) => {
    const job = new BackgroundJob(info)
    expect(stop ? job.requestStop() : true).toBe(true)
    expect(job.finish({ exitCode: exit })).toBe(status)
    expect(job.requestStop()).toBe(false)
    expect(job.finish({ exitCode: 9 })).toBe(status)
  })
})

describe('通知文本', () => {
  const ended = { ...info, status: 'completed' as const, exitCode: 0, outputBytes: 0, truncated: false }
  it('未读输出 ≤ 2 KB 时内联', () => {
    const { text, inlined } = jobNotificationText(ended, '1\n2\n')
    expect(inlined).toBe(true)
    expect(text).toBe(
      '<job-notification>\n<job-id>j1</job-id>\n<status>completed</status>\n<exit-code>0</exit-code>\n' +
        '<summary>Background job "npm test" completed (exit code 0)</summary>\n<output>1\n2\n</output>\n</job-notification>',
    )
  })

  it('超过 2 KB 时不内联，提示 job_output', () => {
    const { text, inlined } = jobNotificationText(ended, 'x'.repeat(NOTIFICATION_OUTPUT_MAX + 1))
    expect(inlined).toBe(false)
    expect(text).not.toContain('<output>')
    expect(text).toContain('read them with job_output')
  })

  it('没有退出码时省略 exit-code；label 中的尖括号被转义', () => {
    const { text } = jobNotificationText({ ...ended, status: 'killed', label: 'a <b>', exitCode: undefined } as never, '')
    expect(text).not.toContain('<exit-code>')
    expect(text).toContain('<summary>Background job "a &lt;b&gt;" killed</summary>')
  })

  it('statusLine', () => expect(statusLine({ status: 'lost' })).toBe('[status: lost]'))
})

describe('终端的当前行（job_input 的判定对象）', () => {
  it.each([
    ['', 'rm -r', 'rm -r'],
    ['rm -r', 'f build\r', ''],
    ['echo a', '\rls', 'ls'],
    ['rm -r', '\x03', ''],
    ['rm -rx', '\x7f', 'rm -r'],
    ['rm -r', '\x15ls', 'ls'],
    ['a', 'b\nc', 'c'],
  ])('%j 写入 %j 之后为 %j', (line, data, expected) => {
    expect(nextLine(line, data)).toBe(expected)
  })
})
