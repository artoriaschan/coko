// 秘密不外泄总闸的后台任务通道（ADR 0004、0007）：后台 bash 分两段（中间 sleep）回显登记的 Secret，明文跨输出块到达。后台任务引入的通道——
// Job 日志文件（<dataDir>/jobs）、job_output 的结果、WS job_output / job_update 帧、HTTP 输出接口与 Job 列表、完成通知文本（经 faux requestLog
// 发给模型）——以及库、日志与 stderr 中都不得出现明文；日志与结果带脱敏占位。符号链接越界见 sidecar-jobs.test.ts。
import { randomBytes } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { API_ROUTES, apiPaths, jobPaths, permissionPaths } from '@coko/protocol'
import { connect, exchange, fauxScript, sidecarDirs, startSidecar, tempDir } from './sidecar-harness.ts'
import { leaksIn, persisted, recordingClient } from './secrets-gate-harness.ts'

describe('秘密不外泄总闸：后台任务', () => {
  it('后台 bash 回显登记 Secret：日志、job_output、WS 帧、HTTP 输出、通知与 requestLog 中没有明文', { timeout: 90_000 }, async () => {
    // 不是凭据形态：只能靠登记明文的按值替换。命令中只有两半，完整的值只出现在输出中，且跨两个输出块。
    const value = 'deploy-token-' + randomBytes(12).toString('hex')
    const [head, tail] = [value.slice(0, 15), value.slice(15)]
    const echo = `printf 'token=%s' '${head}'; sleep 0.3; printf '%s\\n' '${tail}'`
    const root = await tempDir()
    const dirs = await sidecarDirs()
    const requestLog = join(root, 'requests.jsonl')
    await writeFile(requestLog, '')
    const bg = (id: string) => ({ type: 'toolCall', name: 'bash', id, arguments: { command: echo, run_in_background: true } })
    const script = await fauxScript(root, {
      requestLog,
      responses: [
        { content: [bg('a1')] },
        { content: [{ type: 'toolCall', name: 'job_output', id: 'o1', arguments: { job_id: '$LAST_JOB_ID', wait: true, timeout_ms: 20_000 } }] },
        { content: [bg('b1')] },
        { content: 'started' },
        { content: 'noted' },
      ],
    })
    const sidecar = await startSidecar({ dirs, ipc: false, env: { COKO_FAUX_SCRIPT: script, COKO_SECRET_DEPLOY_TOKEN: value } })
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
    const turn = async (text: string) => {
      const before = entries().filter((e) => e.kind === 'run_end').length
      expect((await api.post(apiPaths.sessionMessages(sessionId), { text })).status).toBe(202)
      await stream.waitFor(() => entries().filter((e) => e.kind === 'run_end').length > before, 30_000)
    }
    await turn('run it')
    const starts = entries()
      .filter((e) => e.kind === 'job_start')
      .map((e) => e.payload as { jobId: string; logPath: string })
    expect(starts).toHaveLength(2)
    // 第二个 Job 在 Session 空闲时结束：通知挂起到下一次提交。
    await stream.waitFor(() => entries().filter((e) => e.kind === 'job_end').length === 2)
    await turn('next')
    for (const { jobId } of starts) {
      await api.get(jobPaths.output(jobId))
    }
    await api.get(`/api/sessions/${sessionId}/jobs`)

    // 前置：每个通道确实被驱动，保存的文本带占位。
    const result = entries().find((e) => e.kind === 'message' && (e.payload as { toolCallId?: string }).toolCallId === 'o1')!
    expect(JSON.stringify(result.payload)).toContain('token=[REDACTED:secret]')
    for (const { logPath } of starts) expect(await readFile(logPath, 'utf8')).toBe('token=[REDACTED:secret]\n')
    const requests = (await readFile(requestLog, 'utf8')).split('\n').filter(Boolean)
    expect(requests.at(-1)).toContain('<job-notification>')
    expect(requests.at(-1)).toContain('token=[REDACTED:secret]')
    expect(stream.frames.some((f) => f.includes('"job_output"'))).toBe(true)
    expect(bodies.some((b) => b.includes('token=[REDACTED:secret]'))).toBe(true)

    sidecar.child.kill('SIGTERM')
    expect(await sidecar.exited).toEqual({ code: 0, signal: null })
    const files = await persisted(dirs)
    expect(files.filter((f) => f.name.startsWith('jobs/'))).toHaveLength(2)
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
