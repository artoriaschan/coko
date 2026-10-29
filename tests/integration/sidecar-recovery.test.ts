// 启动恢复与结果确认：真实 Sidecar（faux）。SIGKILL 前以已提交条目（经 WebSocket 推送）与 Workspace 文件同步，
// 不用固定 sleep；重启复用同一数据目录。另验证迁移 v2（v1 库启动）与正常关闭不进入恢复。
import { existsSync } from 'node:fs'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { API_ROUTES, apiPaths, permissionPaths, runPaths, type SessionEntryRecord } from '@coko/protocol'
import { writeV1Database } from '../fixtures/v1-database.ts'
import { client, connect, exchange, fauxScript, isRunEnd, sidecarDirs, startSidecar, tempDir, waitApproval, type SidecarDirs } from './sidecar-harness.ts'

const kindOf = (e: SessionEntryRecord) => (e.kind === 'message' ? (e.payload as { role: string }).role : e.kind)
const textOf = (e: SessionEntryRecord) => ((e.payload as { content?: { text?: string }[] }).content ?? []).map((b) => b.text ?? '').join('')

/** 启动 Sidecar 并建好 Workspace、Session 与订阅；env 另加 COKO_FAUX_SCRIPT。 */
async function boot(root: string, dirs: SidecarDirs, script: string, options: { mode?: string; env?: Record<string, string> } = {}) {
  const sidecar = await startSidecar({ dirs, env: { COKO_FAUX_SCRIPT: script, ...options.env } })
  const cookie = await exchange(sidecar)
  const api = client(sidecar, cookie)
  const workspace = await api.post(API_ROUTES.workspaces, { path: root })
  const sessionId = (await api.post(API_ROUTES.sessions, { workspaceId: workspace.body.id })).body.id as string
  if (options.mode) {
    const changed = await api.put(permissionPaths.sessionPermissionMode(sessionId), { mode: options.mode })
    if (changed.status !== 200) throw new Error('permission mode change failed: ' + changed.status)
  }
  const stream = await connect(sidecar, cookie)
  stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
  await stream.waitFor((m) => m.type === 'subscribed')
  return { sidecar, api, sessionId, stream }
}

/** 强杀并等进程退出，再以同一数据目录启动新 Sidecar。 */
async function killAndRestart(sidecar: Awaited<ReturnType<typeof startSidecar>>, dirs: SidecarDirs, env: Record<string, string>) {
  sidecar.child.kill('SIGKILL')
  expect(await sidecar.exited).toEqual({ code: null, signal: 'SIGKILL' })
  const next = await startSidecar({ dirs, env })
  const cookie = await exchange(next)
  return { sidecar: next, api: client(next, cookie), cookie }
}

const committed = (stream: Awaited<ReturnType<typeof boot>>['stream'], sessionId: string, kind: string) =>
  stream.waitFor((m) => m.type === 'entry' && m.sessionId === sessionId && m.entry.kind === kind)

async function sidecarLog(dirs: SidecarDirs): Promise<string> {
  return readFile(join(dirs.logDir, 'sidecar.jsonl'), 'utf8')
}

describe('启动恢复与结果确认', () => {
  it('full-access 下 bash 执行中 SIGKILL → 重启后 confirmation_request 与 run_end interrupted；待确认时 submit / continue 409；回答 not-applied 后 continue 的上下文含补齐的结果', async () => {
    const root = await tempDir()
    const dirs = await sidecarDirs()
    const requestLog = join(root, 'requests.jsonl')
    await writeFile(requestLog, '')
    const call = { type: 'toolCall', name: 'bash', id: 'b1', arguments: { command: 'sleep 30; touch done' } }
    const script = await fauxScript(root, { responses: [{ content: [call] }], requestLog })
    const first = await boot(root, dirs, script, { mode: 'full-access' })
    await first.api.post(apiPaths.sessionMessages(first.sessionId), { text: 'run it' })
    // 执行记录已提交：命令即将或已经在运行，结果不明。
    await committed(first.stream, first.sessionId, 'tool_exec')

    // 重启后的模型脚本：继续时的回复。
    const resumed = await fauxScript(root, { responses: [{ content: 'resumed' }], requestLog }, 'faux-2.json')
    const { sidecar, api, cookie } = await killAndRestart(first.sidecar, dirs, { COKO_FAUX_SCRIPT: resumed })
    expect(existsSync(join(root, 'done'))).toBe(false)

    // 列表在读详情之前就反映待确认（来自启动扫描）。
    expect((await api.get(API_ROUTES.sessions)).body.sessions[0]).toMatchObject({ id: first.sessionId, running: false, activity: 'awaiting-confirmation' })
    const detail = await api.get(apiPaths.session(first.sessionId))
    const entries = detail.body.entries as SessionEntryRecord[]
    expect(entries.map(kindOf).slice(2)).toEqual(['run_start', 'user', 'assistant', 'tool_exec', 'confirmation_request', 'run_end'])
    const runId = entries.find((e) => e.kind === 'run_start')!.runId
    expect(entries.slice(-2).every((e) => e.runId === runId)).toBe(true)
    expect(entries.at(-2)!.payload).toEqual({ toolCallId: 'b1' })
    expect(entries.at(-1)!.payload).toEqual({ status: 'interrupted' })
    expect(detail.body.session).toMatchObject({ activity: 'awaiting-confirmation' })

    expect(await api.post(apiPaths.sessionMessages(first.sessionId), { text: 'again' })).toMatchObject({
      status: 409,
      body: { error: { code: 'confirmation-pending' } },
    })
    expect(await api.post(runPaths.sessionContinue(first.sessionId))).toMatchObject({ status: 409, body: { error: { code: 'confirmation-pending' } } })
    expect(await api.post(apiPaths.sessionRetry(first.sessionId))).toMatchObject({ status: 409, body: { error: { code: 'confirmation-pending' } } })
    expect((await api.post(runPaths.sessionConfirmation(first.sessionId, 'b1'), { answer: 'maybe' })).status).toBe(400)
    expect((await api.post(runPaths.sessionConfirmation(first.sessionId, 'nope'), { answer: 'applied' })).status).toBe(404)

    const stream = await connect(sidecar, cookie)
    stream.send({ type: 'subscribe', sessionId: first.sessionId, afterSeq: entries.at(-1)!.seq })
    await stream.waitFor((m) => m.type === 'subscribed')
    expect((await api.post(runPaths.sessionConfirmation(first.sessionId, 'b1'), { answer: 'not-applied' })).status).toBe(204)
    expect((await api.post(runPaths.sessionConfirmation(first.sessionId, 'b1'), { answer: 'applied' })).status).toBe(404)
    await stream.waitFor(() => stream.entries(first.sessionId).length >= 2)
    const answered = stream.entries(first.sessionId)
    expect(answered.map(kindOf)).toEqual(['confirmation_answer', 'toolResult'])
    expect(answered[0]!.payload).toEqual({ toolCallId: 'b1', answer: 'not-applied' })
    expect(answered[1]!.payload).toMatchObject({ toolCallId: 'b1', toolName: 'bash', isError: true })
    expect(textOf(answered[1]!)).toMatch(/^Not applied \(confirmed by the user\)/)
    expect(answered.every((e) => e.runId === runId)).toBe(true)
    expect((await api.get(apiPaths.session(first.sessionId))).body.session).toMatchObject({ activity: 'interrupted' })
    expect((await api.get(API_ROUTES.sessions)).body.sessions[0]).toMatchObject({ activity: 'interrupted' })

    const continued = await api.post(runPaths.sessionContinue(first.sessionId))
    expect(continued.status).toBe(202)
    await stream.waitFor(isRunEnd(first.sessionId))
    const second = stream.entries(first.sessionId).filter((e) => e.runId === continued.body.runId)
    expect(second.map(kindOf)).toEqual(['run_start', 'assistant', 'run_end'])
    expect(second[0]!.payload).toEqual({ trigger: 'continue' })
    const sent = (await readFile(requestLog, 'utf8')).split('\n').filter(Boolean)
    expect(sent).toHaveLength(2)
    expect(sent[1]).toContain('Not applied (confirmed by the user)')
    expect(stream.invalidEntries).toEqual([])
    // 文件日志在关闭时刷新。
    expect(await sidecar.stop()).toEqual({ code: 0, signal: null })
    expect(await sidecarLog(dirs)).toContain('interrupted run recovered')
  })

  it('等待审批时 SIGKILL → 重启后 approval_decision expired、补"未执行"结果、文件不存在，没有 confirmation_request', async () => {
    const root = await tempDir()
    const dirs = await sidecarDirs()
    const call = { type: 'toolCall', name: 'bash', id: 'b1', arguments: { command: 'printf hi > out.txt' } }
    const script = await fauxScript(root, { responses: [{ content: [call] }] })
    const first = await boot(root, dirs, script)
    await first.api.post(apiPaths.sessionMessages(first.sessionId), { text: 'write it' })
    const request = await waitApproval(first.stream, first.sessionId)
    const { api } = await killAndRestart(first.sidecar, dirs, { COKO_FAUX_SCRIPT: script })

    expect((await api.get(API_ROUTES.sessions)).body.sessions[0]).toMatchObject({ id: first.sessionId, activity: 'interrupted' })
    const entries = (await api.get(apiPaths.session(first.sessionId))).body.entries as SessionEntryRecord[]
    // 默认模式：只有创建时的一条 permission_mode。
    expect(entries.map(kindOf).slice(1)).toEqual(['run_start', 'user', 'assistant', 'approval_request', 'approval_decision', 'toolResult', 'run_end'])
    expect(entries.find((e) => e.kind === 'approval_decision')!.payload).toEqual({ requestId: request.requestId, outcome: 'expired' })
    const result = entries.find((e) => kindOf(e) === 'toolResult')!
    expect(result.payload).toMatchObject({ toolCallId: 'b1', isError: true })
    expect(textOf(result)).toMatch(/^Not run: /)
    expect(entries.at(-1)!.payload).toEqual({ status: 'interrupted' })
    expect(entries.some((e) => e.kind === 'confirmation_request' || e.kind === 'tool_exec')).toBe(false)
    expect(existsSync(join(root, 'out.txt'))).toBe(false)
    // 过期的请求不能再回答。
    expect((await api.post(apiPaths.sessionApproval(first.sessionId, request.requestId), { decision: 'allow' })).status).toBe(409)
  })

  it('write 执行后、toolResult 提交前被杀 → probeOutcome 判定已生效，直接补结果，没有确认', async () => {
    const root = await tempDir()
    const dirs = await sidecarDirs()
    const call = { type: 'toolCall', name: 'write', id: 'w1', arguments: { path: 'notes.txt', content: 'written before the crash\n' } }
    const script = await fauxScript(root, { responses: [{ content: [call] }] })
    // 测试钩子：write 完成、file_change 提交之后挂起，toolResult 不提交。
    const env = { COKO_TEST_TOOLS: '1', COKO_TEST_HOLD_AFTER_TOOL: 'write' }
    const first = await boot(root, dirs, script, { mode: 'accept-edits', env })
    await first.api.post(apiPaths.sessionMessages(first.sessionId), { text: 'write notes' })
    await committed(first.stream, first.sessionId, 'file_change')
    expect(await readFile(join(root, 'notes.txt'), 'utf8')).toBe('written before the crash\n')
    expect(first.stream.entries(first.sessionId).some((e) => kindOf(e) === 'toolResult')).toBe(false)

    const { api } = await killAndRestart(first.sidecar, dirs, { COKO_FAUX_SCRIPT: script })
    const entries = (await api.get(apiPaths.session(first.sessionId))).body.entries as SessionEntryRecord[]
    expect(entries.map(kindOf).slice(2)).toEqual(['run_start', 'user', 'assistant', 'file_backup', 'tool_exec', 'file_change', 'toolResult', 'run_end'])
    const result = entries.find((e) => kindOf(e) === 'toolResult')!
    expect(result.payload).toMatchObject({ toolCallId: 'w1', toolName: 'write', isError: false })
    expect(textOf(result)).toMatch(/^Applied: /)
    expect(entries.some((e) => e.kind === 'confirmation_request')).toBe(false)
    expect(entries.at(-1)!.payload).toEqual({ status: 'interrupted' })
    expect((await api.get(apiPaths.session(first.sessionId))).body.session).toMatchObject({ activity: 'interrupted' })
    // 恢复不重跑调用：文件内容不变。
    expect(await readFile(join(root, 'notes.txt'), 'utf8')).toBe('written before the crash\n')
  })

  it('正常关闭（shutdown 消息）中断的 Run 仍是 aborted，重启后不产生 interrupted', async () => {
    const root = await tempDir()
    const dirs = await sidecarDirs()
    const call = { type: 'toolCall', name: 'bash', id: 'b1', arguments: { command: 'sleep 30' } }
    const script = await fauxScript(root, { responses: [{ content: [call] }] })
    const first = await boot(root, dirs, script, { mode: 'full-access' })
    await first.api.post(apiPaths.sessionMessages(first.sessionId), { text: 'run it' })
    await committed(first.stream, first.sessionId, 'tool_exec')
    expect(await first.sidecar.stop()).toEqual({ code: 0, signal: null })

    const second = await startSidecar({ dirs, env: { COKO_FAUX_SCRIPT: script } })
    const api = client(second, await exchange(second))
    expect((await api.get(API_ROUTES.sessions)).body.sessions[0]).toMatchObject({ id: first.sessionId, activity: 'idle' })
    const entries = (await api.get(apiPaths.session(first.sessionId))).body.entries as SessionEntryRecord[]
    expect(entries.filter((e) => e.kind === 'run_end').map((e) => e.payload)).toEqual([{ status: 'aborted' }])
    expect(entries.some((e) => e.kind === 'confirmation_request')).toBe(false)
    expect(await second.stop()).toEqual({ code: 0, signal: null })
    expect(await sidecarLog(dirs)).not.toContain('interrupted run recovered')
  })

  it('迁移：用 v1 库启动 Sidecar → 当前版本（M3 起为 3）、生成 .backup-v1-*、原有 Session 与条目可读', async () => {
    const root = await tempDir()
    const dirs = await sidecarDirs()
    const db = join(dirs.dataDir, 'coko.db')
    const v1Entries = [
      { kind: 'message', runId: 'r1', payload: { role: 'user', content: [{ type: 'text', text: 'hello from v1' }], timestamp: 1 } },
      { kind: 'message', runId: 'r1', payload: { role: 'assistant', content: [{ type: 'text', text: 'hi' }], stopReason: 'stop', timestamp: 2 } },
      { kind: 'run_end', runId: 'r1', payload: { status: 'completed' } },
    ]
    await writeV1Database(db, { workspacePath: root, sessionId: 's-v1', title: 'kept from v1', entries: v1Entries })

    const sidecar = await startSidecar({ dirs })
    const api = client(sidecar, await exchange(sidecar))
    const sessions = (await api.get(API_ROUTES.sessions)).body.sessions
    expect(sessions).toHaveLength(1)
    expect(sessions[0]).toMatchObject({ id: 's-v1', title: 'kept from v1', activity: 'idle' })
    const entries = (await api.get(apiPaths.session('s-v1'))).body.entries as SessionEntryRecord[]
    expect(entries.map((e) => [e.seq, e.kind, e.payload])).toEqual(v1Entries.map((e, i) => [i + 1, e.kind, e.payload]))
    expect(await sidecar.stop()).toEqual({ code: 0, signal: null })

    const backups = (await readdir(dirs.dataDir)).filter((name) => name.startsWith('coko.db.backup-v1-'))
    expect(backups).toHaveLength(1)
    const version = (path: string) => {
      const raw = new DatabaseSync(path, { readOnly: true })
      try {
        return (raw.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
      } finally {
        raw.close()
      }
    }
    expect(version(db)).toBe(3)
    expect(version(join(dirs.dataDir, backups[0]!))).toBe(1)
  })
})
