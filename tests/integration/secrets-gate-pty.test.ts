// 秘密不外泄总闸的 PTY 通道（ADR 0004、0007）：tty 后台任务分两段（中间 sleep）打印登记的 Secret，再经 job_input 输入完整的值，终端回显输入、
// 程序再打印一次。PTY 引入的通道——终端原始输出进入的 Job 日志、job_output 结果、WS job_output / job_update 帧与 HTTP 输出接口——以及库、日志、
// stderr 与 faux requestLog 中都不得出现明文。只在 darwin 运行（PTY）。符号链接越界见 sidecar-pty.test.ts。
import { randomBytes } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { API_ROUTES, apiPaths, jobPaths, permissionPaths } from '@coko/protocol'
import { connect, exchange, fauxScript, sidecarDirs, startSidecar, tempDir } from './sidecar-harness.ts'
import { leaksIn, persisted, recordingClient } from './secrets-gate-harness.ts'

describe.skipIf(process.platform !== 'darwin')('秘密不外泄总闸：PTY', () => {
  it('PTY 回显登记 Secret：日志、job_output、WS 帧、HTTP 输出与 requestLog 中没有明文', { timeout: 90_000 }, async () => {
    // 不是凭据形态：只能靠登记明文的按值替换。命令中只有两半；完整的值经 job_input 输入，由终端回显并被程序再打印。
    const value = 'pty-token-' + randomBytes(12).toString('hex')
    const [head, tail] = [value.slice(0, 12), value.slice(12)]
    const root = await tempDir()
    // 终端在输入到达时就回显：等程序打印完两段（ready 文件出现）之后才输入，回显不会插进两段之间。
    const ready = join(root, 'ready')
    const command = `printf 'token=%s' '${head}'; sleep 0.3; printf '%s\\n' '${tail}'; touch ${ready}; read -r line; echo "got:$line"`
    const dirs = await sidecarDirs()
    const requestLog = join(root, 'requests.jsonl')
    await writeFile(requestLog, '')
    const call = (id: string, name: string, args: Record<string, unknown>) => ({ type: 'toolCall', name, id, arguments: args })
    const script = await fauxScript(root, {
      requestLog,
      responses: [
        { content: [call('b1', 'bash', { command, run_in_background: true, tty: true })] },
        { content: [call('w1', 'bash', { command: `while [ ! -f ${ready} ]; do sleep 0.05; done` })] },
        { content: [call('i1', 'job_input', { job_id: '$LAST_JOB_ID', text: value, submit: true })] },
        { content: [call('o1', 'job_output', { job_id: '$LAST_JOB_ID', wait: true, timeout_ms: 20_000 })] },
        { content: 'done' },
      ],
    })
    const sidecar = await startSidecar({ dirs, ipc: false, env: { COKO_FAUX_SCRIPT: script, COKO_SECRET_PTY_TOKEN: value } })
    const cookie = await exchange(sidecar)
    const bodies: string[] = []
    const api = recordingClient(sidecar, cookie, bodies)
    const stream = await connect(sidecar, cookie)
    const workspaceId = (await api.post(API_ROUTES.workspaces, { path: root })).body.id as string
    const sessionId = (await api.post(API_ROUTES.sessions, { workspaceId })).body.id as string
    expect((await api.put(permissionPaths.sessionPermissionMode(sessionId), { mode: 'full-access' })).status).toBe(200)
    stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
    await stream.waitFor((m) => m.type === 'subscribed' && m.sessionId === sessionId)
    const entries = () => stream.entries(sessionId)
    expect((await api.post(apiPaths.sessionMessages(sessionId), { text: 'run it' })).status).toBe(202)
    await stream.waitFor(() => entries().some((e) => e.kind === 'run_end'), 30_000)
    const start = entries().find((e) => e.kind === 'job_start')!.payload as { jobId: string; kind: string; logPath: string }
    expect(start.kind).toBe('pty')
    await stream.waitFor(() => entries().some((e) => e.kind === 'job_end'))
    await api.get(jobPaths.output(start.jobId))
    await api.get(jobPaths.sessionJobs(sessionId))

    // 前置：每个通道确实被驱动，保存的文本带占位（终端回显的输入与程序的输出都被替换）。
    const result = entries().find((e) => e.kind === 'message' && (e.payload as { toolCallId?: string }).toolCallId === 'o1')!
    expect(JSON.stringify(result.payload)).toContain('token=[REDACTED:secret]')
    expect(JSON.stringify(result.payload)).toContain('got:[REDACTED:secret]')
    const log = await readFile(start.logPath, 'utf8')
    expect(log).toContain('token=[REDACTED:secret]\r\n')
    expect(log).toContain('got:[REDACTED:secret]')
    expect(stream.frames.some((f) => f.includes('"job_output"'))).toBe(true)
    expect(bodies.some((b) => b.includes('got:[REDACTED:secret]'))).toBe(true)
    const requests = (await readFile(requestLog, 'utf8')).split('\n').filter(Boolean)
    expect(requests.at(-1)).toContain('got:[REDACTED:secret]')

    sidecar.child.kill('SIGTERM')
    expect(await sidecar.exited).toEqual({ code: 0, signal: null })
    const files = await persisted(dirs)
    expect(files.filter((f) => f.name.startsWith('jobs/'))).toHaveLength(1)
    const channels: [string, string | Buffer][] = [
      ...stream.frames.map((frame, i): [string, string] => ['ws frame ' + i, frame]),
      ...bodies.map((body, i): [string, string] => ['http body ' + i, body]),
      ...requests.map((line, i): [string, string] => ['model request ' + i, line]),
      ...files.map((f): [string, Buffer] => ['stopped ' + f.name, f.bytes]),
      ['sidecar stderr', sidecar.stderr()],
    ]
    expect(leaksIn(channels, { 'registered secret': value })).toEqual([])
  })
})
