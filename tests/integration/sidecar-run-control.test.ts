// 运行控制（票 06）：真实 Sidecar（faux 模型）经协议驱动追加指令、暂停与继续。
// bash 在 full-access 下运行（不经审批与沙箱）；以标记文件与 tool_start 进度确定命令已在执行。
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { API_ROUTES, apiPaths, permissionPaths, runPaths, type SessionEntryRecord } from '@coko/protocol'
import { client, connect, exchange, fauxScript, isRunEnd, sidecarDirs, startSidecar, tempDir, waitApproval } from './sidecar-harness.ts'

async function boot(responses: unknown[], options: { mode?: string } = {}) {
  const root = await tempDir()
  const requestLog = join(root, 'requests.jsonl')
  await writeFile(requestLog, '')
  const script = await fauxScript(root, { responses, requestLog })
  const sidecar = await startSidecar({ dirs: await sidecarDirs(), env: { COKO_FAUX_SCRIPT: script } })
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
  /** 已发出的模型请求（每行一次请求的上下文消息）。 */
  const requests = async () => (await readFile(requestLog, 'utf8')).split('\n').filter(Boolean)
  return { root, api, sessionId, stream, requests }
}

const kindOf = (e: SessionEntryRecord) => (e.kind === 'message' ? (e.payload as { role: string }).role : e.kind)
const userTexts = (entries: SessionEntryRecord[]) =>
  entries.filter((e) => kindOf(e) === 'user').map((e) => ((e.payload as { content: { text?: string }[] }).content ?? []).map((b) => b.text ?? '').join(''))
/** 等标记文件出现后 sleep 一段时间的命令：标记出现即表示命令正在执行。 */
const sleepCall = (id: string, marker: string, seconds = 2) => ({
  type: 'toolCall',
  name: 'bash',
  id,
  arguments: { command: 'touch ' + marker + ' && sleep ' + seconds + ' && echo slept' },
})
const toolStarted = (sessionId: string) => (m: { type: string; sessionId?: string; event?: { type: string } }) =>
  m.type === 'progress' && m.sessionId === sessionId && m.event?.type === 'tool_start'

describe('运行控制', () => {
  it('bash sleep 执行中 steer → user message 位于这次 toolResult 之后、下一条 assistant 之前；下一次模型请求上下文含该文本', async () => {
    const { api, sessionId, stream, requests } = await boot([{ content: [sleepCall('b1', 'started')] }, { content: 'adjusted' }], { mode: 'full-access' })
    await api.post(apiPaths.sessionMessages(sessionId), { text: 'run it' })
    await stream.waitFor(toolStarted(sessionId))
    expect((await api.post(runPaths.sessionSteer(sessionId), { text: 'also mention the README' })).status).toBe(204)
    await stream.waitFor(isRunEnd(sessionId))

    const entries = stream.entries(sessionId)
    expect(entries.map(kindOf)).toEqual([
      'permission_mode',
      'permission_mode',
      'run_start',
      'user',
      'assistant',
      'tool_exec',
      'toolResult',
      'user',
      'assistant',
      'run_end',
    ])
    expect(userTexts(entries)).toEqual(['run it', 'also mention the README'])
    const runId = entries.find((e) => e.kind === 'run_start')!.runId
    expect(entries.filter((e) => e.seq > entries.find((x) => x.kind === 'run_start')!.seq).every((e) => e.runId === runId)).toBe(true)
    expect(entries.at(-1)?.payload).toEqual({ status: 'completed' })
    const sent = await requests()
    expect(sent).toHaveLength(2)
    expect(sent[0]).not.toContain('also mention the README')
    expect(sent[1]).toContain('also mention the README')
    expect(stream.invalidEntries).toEqual([])
  })

  it('steer 后立刻 abort（未送达）→ run_end 带 undeliveredSteering，没有对应 user message', async () => {
    const { api, sessionId, stream, requests } = await boot([{ content: [sleepCall('b1', 'started', 30)] }, { content: 'never' }], { mode: 'full-access' })
    await api.post(apiPaths.sessionMessages(sessionId), { text: 'run it' })
    await stream.waitFor(toolStarted(sessionId))
    expect((await api.post(runPaths.sessionSteer(sessionId), { text: 'not delivered' })).status).toBe(204)
    expect((await api.post(apiPaths.sessionAbort(sessionId))).body).toEqual({ aborted: true })
    await stream.waitFor(isRunEnd(sessionId))

    const entries = stream.entries(sessionId)
    expect(entries.at(-1)?.payload).toEqual({ status: 'aborted', undeliveredSteering: ['not delivered'] })
    expect(userTexts(entries)).toEqual(['run it'])
    expect(await requests()).toHaveLength(1)
    expect(stream.invalidEntries).toEqual([])
  })

  it('工具执行中 pause → 工具完成且 toolResult 提交，之后没有新请求，run_end paused，activity paused；continue → 新 run_start（continue）并发起请求', async () => {
    const { api, sessionId, stream, requests } = await boot([{ content: [sleepCall('b1', 'started')] }, { content: 'continued' }], { mode: 'full-access' })
    await api.post(apiPaths.sessionMessages(sessionId), { text: 'run it' })
    await stream.waitFor(toolStarted(sessionId))
    expect((await api.post(runPaths.sessionPause(sessionId))).status).toBe(204)
    await stream.waitFor(isRunEnd(sessionId))

    const entries = stream.entries(sessionId)
    expect(entries.map(kindOf).slice(2)).toEqual(['run_start', 'user', 'assistant', 'tool_exec', 'toolResult', 'run_end'])
    const result = entries.find((e) => kindOf(e) === 'toolResult')!.payload as { isError: boolean; content: { text?: string }[] }
    expect(result.isError).toBe(false)
    expect(result.content.map((b) => b.text ?? '').join('')).toContain('slept')
    expect(entries.at(-1)?.payload).toEqual({ status: 'paused' })
    expect(await requests()).toHaveLength(1)
    expect((await api.get(apiPaths.session(sessionId))).body.session).toMatchObject({ running: false, activity: 'paused' })
    expect((await api.get(API_ROUTES.sessions)).body.sessions[0]).toMatchObject({ id: sessionId, activity: 'paused' })

    const continued = await api.post(runPaths.sessionContinue(sessionId))
    expect(continued.status).toBe(202)
    await stream.waitFor((m) => m.type === 'entry' && m.sessionId === sessionId && m.entry.kind === 'run_end' && m.entry.runId === continued.body.runId)
    const second = stream.entries(sessionId).filter((e) => e.runId === continued.body.runId)
    expect(second.map(kindOf)).toEqual(['run_start', 'assistant', 'run_end'])
    expect(second[0]!.payload).toEqual({ trigger: 'continue' })
    expect(second.at(-1)!.payload).toEqual({ status: 'completed' })
    const sent = await requests()
    expect(sent).toHaveLength(2)
    expect(sent[1]).toContain('slept')
    expect((await api.get(apiPaths.session(sessionId))).body.session).toMatchObject({ activity: 'idle' })
  })

  it('上一 Run completed 时 continue → 409 nothing-to-continue；无 Run 时 steer / pause → 409 no-active-run；非法请求 400、未知 Session 404', async () => {
    const { api, sessionId, stream } = await boot([{ content: 'hello' }])
    expect(await api.post(runPaths.sessionSteer(sessionId), { text: 'x' })).toMatchObject({ status: 409, body: { error: { code: 'no-active-run' } } })
    expect(await api.post(runPaths.sessionPause(sessionId))).toMatchObject({ status: 409, body: { error: { code: 'no-active-run' } } })
    expect(await api.post(runPaths.sessionContinue(sessionId))).toMatchObject({ status: 409, body: { error: { code: 'nothing-to-continue' } } })

    await api.post(apiPaths.sessionMessages(sessionId), { text: 'hi' })
    await stream.waitFor(isRunEnd(sessionId))
    expect(await api.post(runPaths.sessionContinue(sessionId))).toMatchObject({ status: 409, body: { error: { code: 'nothing-to-continue' } } })
    expect(await api.post(runPaths.sessionSteer(sessionId), { text: 'x' })).toMatchObject({ status: 409, body: { error: { code: 'no-active-run' } } })
    expect((await api.post(runPaths.sessionSteer(sessionId), { text: '' })).status).toBe(400)
    expect((await api.post(runPaths.sessionSteer('missing'), { text: 'x' })).status).toBe(404)
    expect((await api.post(runPaths.sessionContinue('missing'))).status).toBe(404)
  })

  it('等待审批时 pause → 请求 cancelled、调用未执行、run_end paused', async () => {
    const { root, api, sessionId, stream, requests } = await boot([
      { content: [{ type: 'toolCall', name: 'bash', id: 'b1', arguments: { command: 'printf hi > out.txt' } }] },
      { content: 'never' },
    ])
    await api.post(apiPaths.sessionMessages(sessionId), { text: 'write it' })
    const request = await waitApproval(stream, sessionId)
    expect((await api.post(runPaths.sessionPause(sessionId))).status).toBe(204)
    await stream.waitFor(isRunEnd(sessionId))

    const entries = stream.entries(sessionId)
    expect(entries.find((e) => e.kind === 'approval_decision')?.payload).toEqual({ requestId: request.requestId, outcome: 'cancelled' })
    expect(entries.some((e) => e.kind === 'tool_exec')).toBe(false)
    expect(entries.at(-1)?.payload).toEqual({ status: 'paused' })
    const result = entries.find((e) => kindOf(e) === 'toolResult')!.payload as { isError: boolean }
    expect(result.isError).toBe(true)
    await expect(readFile(join(root, 'out.txt'))).rejects.toThrow(/ENOENT/)
    expect(await requests()).toHaveLength(1)
    expect((await api.post(apiPaths.sessionApproval(sessionId, request.requestId), { decision: 'allow' })).status).toBe(409)
  })
})
