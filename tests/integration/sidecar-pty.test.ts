// PTY 与 stdin（docs/subsystems/execution.md#pty-与-stdin）：真实 Sidecar（faux）上 bash tty 后台任务、job_input 的输入与 Ctrl-C、权限判定（default
// 询问、full-access 放行、拒绝规则匹配 text）、read-only 档位的 Seatbelt、SIGKILL 后孤儿清理，以及 Workspace 经符号链接登记时 PTY 的工作目录为真实路径。
// PTY、Seatbelt 与进程组信号只在 darwin 验证，其他平台显式跳过。faux 脚本用 $LAST_JOB_ID 引用最近启动的 Job。
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile, realpath, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it, onTestFinished } from 'vitest'
import { API_ROUTES, apiPaths, jobPaths, permissionPaths, type JobSnapshot } from '@coko/protocol'
import {
  client,
  connect,
  exchange,
  fauxScript,
  killAndRestart,
  sidecarDirs,
  startSidecar,
  tempDir,
  waitApproval,
  waitProcessesGone,
  type SidecarDirs,
} from './sidecar-harness.ts'

const darwin = process.platform === 'darwin'
/** python3 可用时用 REPL（基础 REPL，少控制序列）；否则用 bash 的 read 计算同一个表达式。 */
const python = darwin && spawnSync('python3', ['-c', 'print(1)'], { encoding: 'utf8' }).stdout?.trim() === '1'

type Message = { role: string; content: string | { type: string; text?: string }[]; toolCallId?: string; isError?: boolean }
const textOf = (m: Message) => (typeof m.content === 'string' ? m.content : m.content.map((b) => b.text ?? '').join(''))

/** 测试结束时终止记录的进程组与 pid（只针对本测试读到的 pid）。 */
function reap(...pids: number[]): void {
  onTestFinished(() => {
    for (const pid of pids)
      for (const target of [-pid, pid])
        try {
          process.kill(target, 'SIGKILL')
        } catch {
          // 已退出。
        }
  })
}

const readPid = async (path: string) => Number((await readFile(path, 'utf8').catch(() => '')).trim())

function dbRows<T>(dirs: SidecarDirs, sql: string): T[] {
  const path = join(dirs.dataDir, 'coko.db')
  if (!existsSync(path)) return []
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    return db.prepare(sql).all() as T[]
  } finally {
    db.close()
  }
}

async function setup(responses: unknown[], options: { mode?: string; workspace?: (root: string) => Promise<string> } = {}) {
  const root = await tempDir()
  const dirs = await sidecarDirs()
  const requestLog = join(root, 'requests.jsonl')
  await writeFile(requestLog, '')
  const env = { COKO_FAUX_SCRIPT: await fauxScript(root, { requestLog, responses }) }
  const sidecar = await startSidecar({ dirs, env })
  const cookie = await exchange(sidecar)
  const api = client(sidecar, cookie)
  const stream = await connect(sidecar, cookie)
  const path = options.workspace ? await options.workspace(root) : root
  const workspaceId = (await api.post(API_ROUTES.workspaces, { path })).body.id as string
  const sessionId = (await api.post(API_ROUTES.sessions, { workspaceId })).body.id as string
  const setMode = async (mode: string) => expect((await api.put(permissionPaths.sessionPermissionMode(sessionId), { mode })).status).toBe(200)
  await setMode(options.mode ?? 'full-access')
  stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
  await stream.waitFor((m) => m.type === 'subscribed' && m.sessionId === sessionId)
  const entries = () => stream.entries(sessionId)
  const count = (kind: string) => entries().filter((e) => e.kind === kind).length
  const send = async (text: string) => expect((await api.post(apiPaths.sessionMessages(sessionId), { text })).status).toBe(202)
  const turn = async (text: string) => {
    const before = count('run_end')
    await send(text)
    await stream.waitFor(() => count('run_end') > before, 60_000)
  }
  const result = (toolCallId: string) => {
    const entry = entries().find((e) => e.kind === 'message' && (e.payload as Message).toolCallId === toolCallId)
    return entry ? { text: textOf(entry.payload as Message), isError: (entry.payload as Message).isError === true } : undefined
  }
  const jobStarts = () =>
    entries()
      .filter((e) => e.kind === 'job_start')
      .map((e) => e.payload as { jobId: string; kind: string; logPath: string })
  const jobEnd = (jobId: string) => entries().find((e) => e.kind === 'job_end' && (e.payload as { jobId: string }).jobId === jobId)?.payload
  const allow = async (n = 1) => {
    const approval = await waitApproval(stream, sessionId, n)
    expect((await api.post(apiPaths.sessionApproval(sessionId, approval.requestId), { decision: 'allow' })).status).toBe(204)
    return approval
  }
  return { root, dirs, env, sidecar, api, stream, sessionId, entries, count, send, turn, result, jobStarts, jobEnd, setMode, allow }
}

const tty = (id: string, command: string) => ({ type: 'toolCall', name: 'bash', id, arguments: { command, run_in_background: true, tty: true } })
const call = (id: string, name: string, args: Record<string, unknown>) => ({ type: 'toolCall', name, id, arguments: args })
const read = (id: string, timeout_ms = 20_000) => call(id, 'job_output', { job_id: '$LAST_JOB_ID', wait: true, timeout_ms })
const input = (id: string, args: Record<string, unknown>) => call(id, 'job_input', { job_id: '$LAST_JOB_ID', ...args })

describe.skipIf(!darwin)('PTY 与 stdin（真实 Sidecar，darwin）', { timeout: 120_000 }, () => {
  it('后台 tty 运行交互式程序：job_input 写入表达式并 submit，job_output 读到 42；Job kind pty，日志保存终端原始输出', async () => {
    const [command, expression] = python ? ['PYTHON_BASIC_REPL=1 python3 -q -i', 'print(6*7)'] : ['read -r e; echo "= $((e))"', '6*7']
    const h = await setup([
      { content: [tty('b1', command)] },
      { content: [input('i1', { text: expression, submit: true })] },
      ...(python ? [{ content: [input('i2', { text: 'exit()', submit: true })] }] : []),
      { content: [read('o1')] },
      { content: 'done' },
    ])
    await h.turn('compute')
    const [start] = h.jobStarts()
    expect(start).toMatchObject({ kind: 'pty' })
    expect(h.result('b1')!.text).toBe(`Started background job ${start!.jobId}: ${command}. Send input with job_input; read output with job_output.`)
    expect(h.result('i1')).toEqual({
      text: `Sent ${expression.length} characters and Enter to background job ${start!.jobId}. Read the response with job_output.`,
      isError: false,
    })
    const output = h.result('o1')!.text
    expect(output).toMatch(python ? /^42$/m : /^= 42$/m)
    expect(output).not.toContain('\r')
    expect(output.endsWith('[status: completed]')).toBe(true)
    expect(await readFile(start!.logPath, 'utf8')).toMatch(python ? /\r\n42\r\n/ : /= 42\r\n/)
    const listed = (await h.api.get(jobPaths.sessionJobs(h.sessionId))).body.jobs as JobSnapshot[]
    expect(listed).toMatchObject([{ jobId: start!.jobId, kind: 'pty', status: 'completed', exitCode: 0 }])
  })

  it('ctrl_c 中断前台的 sleep 100：trap 收到 SIGINT，Job 很快结束', async () => {
    const root = await tempDir()
    const ready = join(root, 'ready')
    const h = await setup([
      { content: [tty('b1', `trap 'echo trapped; exit 0' INT; touch ${ready}; sleep 100; echo not-reached`)] },
      { content: [call('w1', 'bash', { command: `while [ ! -f ${ready} ]; do sleep 0.05; done` })] },
      { content: [input('c1', { text: '', ctrl_c: true })] },
      { content: [read('o1')] },
      { content: 'done' },
    ])
    const started = Date.now()
    await h.turn('interrupt')
    expect(h.result('c1')!.text).toContain('Sent Ctrl-C to background job')
    const output = h.result('o1')!.text
    expect(output).toContain('trapped')
    expect(output).not.toContain('not-reached')
    expect(output.endsWith('[status: completed]')).toBe(true)
    expect(Date.now() - started).toBeLessThan(60_000)
    expect(h.jobEnd(h.jobStarts()[0]!.jobId)).toMatchObject({ status: 'completed', exitCode: 0 })
  })

  it('job_input 的判定对象为 text：full-access 不询问；default 询问（subject 为 text）；拒绝规则匹配 text 时拒绝', async () => {
    const h = await setup([
      { content: [tty('b1', 'cat')] },
      { content: [input('i0', { text: 'first', submit: true })] },
      { content: 'started' },
      { content: [input('i1', { text: 'echo hello-pty', submit: true })] },
      { content: 'sent' },
      { content: [input('i2', { text: 'rm -rf x', submit: true })] },
      { content: 'denied' },
    ])
    await h.turn('start')
    expect(h.count('approval_request')).toBe(0)
    expect(h.result('i0')!.isError).toBe(false)

    await h.setMode('default')
    await h.send('type')
    const approval = await h.allow()
    // Job 在 full-access 下启动：default 下的输入经提权审批（档位比当前宽），subject 仍为 text。
    expect(approval).toMatchObject({ toolName: 'job_input', kind: 'escalation', subject: 'echo hello-pty' })
    await h.stream.waitFor(() => h.count('run_end') === 2, 30_000)
    expect(h.result('i1')!.isError).toBe(false)

    const rule = { behavior: 'deny', tool: 'Bash', content: 'rm *' }
    expect((await h.api.post(permissionPaths.sessionPermissionRules(h.sessionId), { rule })).status).toBe(200)
    await h.turn('remove')
    expect(h.count('approval_request')).toBe(1)
    expect(h.result('i2')).toEqual({ text: 'Permission denied by rule Bash(rm *).', isError: true })
    const log = await readFile(h.jobStarts()[0]!.logPath, 'utf8')
    expect(log).toContain('hello-pty')
    expect(log).not.toContain('rm -rf x')
    expect(await h.sidecar.stop()).toEqual({ code: 0, signal: null })
  })

  it('Job 在较宽档位启动、之后模式收紧：plan 下 job_input 被拒绝（不写入终端）；default 下要求一次提权审批（kind escalation）', async () => {
    const h = await setup([
      { content: [tty('b1', 'cat')] },
      { content: 'started' },
      { content: [input('i1', { text: 'touch planned.txt', submit: true })] },
      { content: 'refused' },
      { content: [input('i2', { text: 'echo widened', submit: true })] },
      { content: 'sent' },
    ])
    await h.turn('start')
    expect(h.result('b1')!.isError).toBe(false)

    await h.setMode('plan')
    await h.turn('touch')
    expect(h.count('approval_request')).toBe(0)
    expect(h.result('i1')).toEqual({
      text: expect.stringMatching(/^Not sent: background job \S+ was started under the danger-full-access sandbox, wider than plan mode allows/),
      isError: true,
    })

    await h.setMode('default')
    await h.send('echo')
    const approval = await h.allow()
    expect(approval).toMatchObject({ toolName: 'job_input', kind: 'escalation', subject: 'echo widened', targetMode: 'danger-full-access' })
    await h.stream.waitFor(() => h.count('run_end') === 3, 30_000)
    expect(h.result('i2')!.isError).toBe(false)
    const log = await readFile(h.jobStarts()[0]!.logPath, 'utf8')
    expect(log).toContain('widened')
    expect(log).not.toContain('planned')
    expect(await h.sidecar.stop()).toEqual({ code: 0, signal: null })
  })

  it('job_input 按上次回车之后累计的输入判定：拆成几段的命令匹配拒绝规则；同一批中前一段改变了当前行时后一段不发送', async () => {
    const h = await setup([
      // cat 忽略 SIGINT：Ctrl-C 只清空终端的当前行。
      { content: [tty('b1', "trap '' INT; cat")] },
      { content: [input('p1', { text: 'rm -r' })] },
      { content: [input('p2', { text: 'f build', submit: true })] },
      { content: [input('c1', { text: '', ctrl_c: true })] },
      // 同一批：q1 之前当前行为空，q2 判定时看到的也是空行加本段；q1 执行后当前行已变。
      { content: [input('q1', { text: 'rm -r' }), input('q2', { text: 'f build', submit: true })] },
      { content: 'done' },
    ])
    const rule = { behavior: 'deny', tool: 'Bash', content: 'rm -rf *' }
    expect((await h.api.post(permissionPaths.sessionPermissionRules(h.sessionId), { rule })).status).toBe(200)
    await h.turn('split')
    expect(h.result('p1')!.isError).toBe(false)
    expect(h.result('p2')).toEqual({ text: 'Permission denied by rule Bash(rm -rf *).', isError: true })
    expect(h.result('c1')!.isError).toBe(false)
    expect(h.result('q1')!.isError).toBe(false)
    expect(h.result('q2')).toEqual({ text: expect.stringMatching(/^Not sent: an earlier input changed the current line of background job \S+/), isError: true })
    const log = await readFile(h.jobStarts()[0]!.logPath, 'utf8')
    expect(log).not.toContain('build')
    expect(await h.sidecar.stop()).toEqual({ code: 0, signal: null })
  })

  it('read-only 档位：tty Job 在 Seatbelt 下写 Workspace 被拒绝', async () => {
    const h = await setup([{ content: [tty('b1', 'touch blocked.txt; echo "exit=$?"')] }, { content: [read('o1')] }, { content: 'done' }], {
      mode: 'read-only',
    })
    await h.send('write')
    expect(await h.allow()).toMatchObject({ toolName: 'bash' })
    await h.stream.waitFor(() => h.count('run_end') === 1, 30_000)
    const output = h.result('o1')!.text
    expect(output).toContain('Operation not permitted')
    expect(output).toContain('exit=1')
    expect(existsSync(join(h.root, 'blocked.txt'))).toBe(false)
  })

  it('SIGKILL Sidecar 后重启：PTY 进程组（忽略 SIGHUP 的 shell 与 sleep）被孤儿清理终止，登记为 kind pty，Job 记 lost', async () => {
    const root = await tempDir()
    const command = `trap '' HUP; echo $$ > ${join(root, 'pty.pid')}; sleep 300 & echo $! > ${join(root, 'pty-child.pid')}; wait`
    const h = await setup([{ content: [tty('b1', command)] }, { content: 'started' }])
    await h.turn('go')
    let shell = 0
    let child = 0
    await expect
      .poll(
        async () => {
          shell = await readPid(join(root, 'pty.pid'))
          child = await readPid(join(root, 'pty-child.pid'))
          return shell > 0 && child > 0
        },
        { timeout: 20_000 },
      )
      .toBe(true)
    reap(shell, child)
    const jobId = h.jobStarts()[0]!.jobId
    await expect
      .poll(() => dbRows(h.dirs, "SELECT pid, pgid, kind, job_id FROM host_processes WHERE kind = 'pty'"), { timeout: 10_000 })
      .toEqual([{ pid: shell, pgid: shell, kind: 'pty', job_id: jobId }])

    const restarted = await killAndRestart(h.sidecar, { dirs: h.dirs, env: h.env })
    await waitProcessesGone([shell, child], 5_000)
    const api = client(restarted, await exchange(restarted))
    expect((await api.get(jobPaths.sessionJobs(h.sessionId))).body.jobs).toMatchObject([{ jobId, kind: 'pty', status: 'lost' }])
    expect(await restarted.stop()).toEqual({ code: 0, signal: null })
    const log = (await readFile(join(h.dirs.logDir, 'sidecar.jsonl'), 'utf8'))
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { message: string; properties: Record<string, unknown> })
    expect(log.some((r) => r.message === 'orphan process terminated' && r.properties.kind === 'pty' && r.properties.pid === shell)).toBe(true)
  })

  it('符号链接越界：Workspace 以符号链接路径登记时，PTY 中 pwd -P 与 $PWD 都是目标路径，workspace-write 的写入按真实路径放行', async () => {
    let link = ''
    const h = await setup(
      [{ content: [tty('b1', 'pwd -P; echo "PWD=$PWD"; touch inside.txt && echo wrote')] }, { content: [read('o1')] }, { content: 'done' }],
      {
        mode: 'default',
        workspace: async (root) => {
          link = join(await tempDir(), 'ws-link')
          await symlink(root, link)
          return link
        },
      },
    )
    const real = await realpath(h.root)
    expect(real).not.toBe(link)
    await h.send('where')
    await h.allow()
    await h.stream.waitFor(() => h.count('run_end') === 1, 30_000)
    const output = h.result('o1')!.text
    expect(output.split('\n')).toEqual(expect.arrayContaining([real, `PWD=${real}`, 'wrote']))
    expect(output).not.toContain(link)
    expect(existsSync(join(real, 'inside.txt'))).toBe(true)
  })
})
