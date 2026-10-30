// 秘密不外泄总闸的定时任务通道（ADR 0004、0007）：任务的 title 与 prompt 含登记的 Secret（经 HTTP 新建与模型的 schedule_create）。定时任务引入的
// 通道——schedules 表行、schedule_fire 条目、HTTP 响应、WebSocket 帧（含 schedule_update 进度）、到期 Run 的 <scheduled_task> 输入（faux requestLog）——
// 以及日志与库文件中都不得出现明文；保存的任务带脱敏占位。本功能不读取文件，不涉及符号链接越界。
import { randomBytes } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { API_ROUTES, apiPaths, permissionPaths, schedulePaths } from '@coko/protocol'
import { advanceClock, client, connect, exchange, fauxScript, sidecarDirs, startSidecar, tempDir } from './sidecar-harness.ts'
import { leaksIn, persisted, recordingClient } from './secrets-gate-harness.ts'

describe('秘密不外泄总闸：定时任务', () => {
  it('title / prompt 含登记 Secret：表行、条目、HTTP、WS、requestLog 中的 <scheduled_task> 与日志中没有明文', { timeout: 90_000 }, async () => {
    // 不是凭据形态：只能靠登记明文的按值替换。
    const value = 'deploy-token-' + randomBytes(12).toString('hex')
    const root = await tempDir()
    const workspaceDir = join(root, 'ws')
    await mkdir(workspaceDir)
    const dirs = await sidecarDirs()
    const requestLog = join(root, 'requests.jsonl')
    await writeFile(requestLog, '')
    const script = await fauxScript(root, {
      requestLog,
      responses: [
        {
          match: 'make a schedule',
          content: [
            {
              type: 'toolCall',
              name: 'schedule_create',
              id: 'c1',
              arguments: { title: 'model ' + value, prompt: 'model-prompt use ' + value, after_seconds: 120 },
            },
          ],
        },
        { match: 'make a schedule', content: 'scheduled' },
        { match: 'http-prompt', content: 'http run done' },
        { match: 'model-prompt', content: 'model run done' },
      ],
    })
    const sidecar = await startSidecar({ dirs, ipc: false, env: { COKO_FAUX_SCRIPT: script, COKO_SECRET_DEPLOY_TOKEN: value, COKO_TEST_CLOCK: '1' } })
    const cookie = await exchange(sidecar)
    const bodies: string[] = []
    const api = recordingClient(sidecar, cookie, bodies)
    const plain = client(sidecar, cookie)
    const stream = await connect(sidecar, cookie)
    const workspaceId = (await api.post(API_ROUTES.workspaces, { path: workspaceDir })).body.id as string
    const sessionId = (await api.post(API_ROUTES.sessions, { workspaceId })).body.id as string
    await api.put(permissionPaths.sessionPermissionMode(sessionId), { mode: 'full-access' })
    stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
    await stream.waitFor((m) => m.type === 'subscribed' && m.sessionId === sessionId)
    const runEnds = (n: number) => stream.waitFor(() => stream.entries(sessionId).filter((e) => e.kind === 'run_end').length >= n)

    const created = await api.post(schedulePaths.sessionSchedules(sessionId), {
      title: 'http ' + value,
      prompt: 'http-prompt use ' + value,
      rule: { kind: 'after', seconds: 60 },
    })
    expect(created.status).toBe(201)
    await api.post(apiPaths.sessionMessages(sessionId), { text: 'make a schedule' })
    await runEnds(1)
    await advanceClock(plain, 60_000)
    await runEnds(2)
    await advanceClock(plain, 60_000)
    await runEnds(3)
    await api.get(schedulePaths.list(sessionId))
    await api.get(schedulePaths.list())
    await api.get(apiPaths.session(sessionId))

    // 前置：通道确实被驱动，保存的任务带占位，两次到期的 Run 都送达了 <scheduled_task>。
    const listed = (await plain.get(schedulePaths.list(sessionId))).body as { title: string; prompt: string; status: string }[]
    expect(listed.map((s) => [s.title, s.prompt, s.status])).toEqual([
      ['http [REDACTED:secret]', 'http-prompt use [REDACTED:secret]', 'inactive'],
      ['model [REDACTED:secret]', 'model-prompt use [REDACTED:secret]', 'inactive'],
    ])
    const requests = (await readFile(requestLog, 'utf8')).split('\n').filter(Boolean)
    const scheduled = requests.filter((line) => line.includes('<scheduled_task'))
    expect(scheduled).toHaveLength(2)
    expect(JSON.parse(scheduled[0]!).at(-1).content[0].text).toMatch(
      /title="http \[REDACTED:secret\]" occurrence="[^"]+">http-prompt use \[REDACTED:secret\]<\/scheduled_task>$/,
    )
    expect(stream.entries(sessionId).filter((e) => e.kind === 'schedule_fire')).toHaveLength(2)
    expect(stream.messages.some((m) => m.type === 'progress' && m.event.type === 'schedule_update')).toBe(true)

    sidecar.child.kill('SIGTERM')
    expect(await sidecar.exited).toEqual({ code: 0, signal: null })
    const db = new DatabaseSync(join(dirs.dataDir, 'coko.db'), { readOnly: true })
    const rows = db.prepare('SELECT title, prompt, rule FROM schedules').all() as Record<string, string>[]
    const fires = db.prepare("SELECT payload FROM session_entries WHERE kind = 'schedule_fire'").all() as { payload: string }[]
    db.close()
    expect(rows).toHaveLength(2)
    const files = await persisted(dirs)
    const channels: [string, string | Buffer][] = [
      ...stream.frames.map((frame, i): [string, string] => ['ws frame ' + i, frame]),
      ...bodies.map((body, i): [string, string] => ['http body ' + i, body]),
      ...requests.map((line, i): [string, string] => ['model request ' + i, line]),
      ...rows.map((row, i): [string, string] => ['schedule row ' + i, JSON.stringify(row)]),
      ...fires.map((row, i): [string, string] => ['schedule_fire row ' + i, row.payload]),
      ...files.map((f): [string, Buffer] => ['stopped ' + f.name, f.bytes]),
      ['sidecar stderr', sidecar.stderr()],
    ]
    expect(leaksIn(channels, { 'registered secret': value })).toEqual([])
  })
})
