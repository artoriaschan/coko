// 审批闭环：真实 Sidecar（faux 模型）经协议驱动 approval_request / approval_decision、回答路由、activity 与 inspect-quit。
import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { API_ROUTES, apiPaths, type SessionEntryRecord } from '@coko/protocol'
import { client, connect, exchange, fauxScript, isRunEnd, sidecarDirs, startSidecar, tempDir, waitApproval } from './sidecar-harness.ts'

async function boot(responses: unknown[]) {
  const root = await tempDir()
  const script = await fauxScript(root, { responses })
  const sidecar = await startSidecar({ dirs: await sidecarDirs(), env: { COKO_FAUX_SCRIPT: script } })
  const cookie = await exchange(sidecar)
  const api = client(sidecar, cookie)
  const workspace = await api.post(API_ROUTES.workspaces, { path: root })
  const sessionId = (await api.post(API_ROUTES.sessions, { workspaceId: workspace.body.id })).body.id as string
  const stream = await connect(sidecar, cookie)
  stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
  await stream.waitFor((m) => m.type === 'subscribed')
  return { root, sidecar, cookie, api, sessionId, stream }
}

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  )
const kindOf = (e: SessionEntryRecord) => (e.kind === 'message' ? (e.payload as { role: string }).role : e.kind)
const toolResults = (entries: SessionEntryRecord[]) =>
  entries.filter((e) => kindOf(e) === 'toolResult').map((e) => e.payload as { toolCallId: string; isError: boolean; content: { text?: string }[] })
const text = (result: { content: { text?: string }[] }) => result.content.map((b) => b.text ?? '').join('')
const bashWrite = (id: string, name: string) => ({ type: 'toolCall', name: 'bash', id, arguments: { command: `printf hi > ${name}` } })

describe('审批闭环', () => {
  it('bash 写文件 → approval_request、awaiting-approval、文件不存在；允许一次后写入并记录 allowed once；再次回答 409', async () => {
    const { root, api, sessionId, stream } = await boot([{ content: [bashWrite('b1', 'out.txt')] }, { content: 'done' }])
    await api.post(apiPaths.sessionMessages(sessionId), { text: 'write it' })
    const request = await waitApproval(stream, sessionId)

    expect(request).toMatchObject({ toolCallId: 'b1', toolName: 'bash', kind: 'tool', subject: 'printf hi > out.txt' })
    expect((await api.get(apiPaths.session(sessionId))).body.session).toMatchObject({ running: true, activity: 'awaiting-approval' })
    expect((await api.get(API_ROUTES.sessions)).body.sessions[0]).toMatchObject({ id: sessionId, activity: 'awaiting-approval' })
    expect(await exists(join(root, 'out.txt'))).toBe(false)

    const path = apiPaths.sessionApproval(sessionId, request.requestId)
    expect((await api.post(path, { decision: 'maybe' })).status).toBe(400)
    expect((await api.post(path, { decision: 'allow', scope: 'forever' })).body).toMatchObject({ error: { code: 'bad-request' } })
    expect((await api.post(path, { decision: 'allow', scope: 'once' })).status).toBe(204)
    expect(await api.post(path, { decision: 'allow', scope: 'once' })).toMatchObject({ status: 409, body: { error: { code: 'approval-not-pending' } } })
    await stream.waitFor(isRunEnd(sessionId))

    expect(await readFile(join(root, 'out.txt'), 'utf8')).toBe('hi')
    const entries = stream.entries(sessionId)
    expect(entries.map(kindOf)).toEqual([
      'permission_mode',
      'run_start',
      'user',
      'assistant',
      'approval_request',
      'approval_decision',
      'tool_exec',
      'toolResult',
      'assistant',
      'run_end',
    ])
    expect(entries.find((e) => e.kind === 'approval_decision')?.payload).toEqual({ requestId: request.requestId, outcome: 'allowed', scope: 'once' })
    expect(stream.invalidEntries).toEqual([])
    expect((await api.get(apiPaths.session(sessionId))).body.session).toMatchObject({ running: false, activity: 'idle' })
    expect((await api.post(apiPaths.sessionApproval('missing', 'x'), { decision: 'deny' })).status).toBe(404)
  })

  it('无反馈拒绝 → toolResult 为拒绝错误，Run 以 aborted 结束，文件不存在', async () => {
    const { root, api, sessionId, stream } = await boot([{ content: [bashWrite('b1', 'out.txt')] }, { content: 'should not be used' }])
    await api.post(apiPaths.sessionMessages(sessionId), { text: 'write it' })
    const request = await waitApproval(stream, sessionId)
    expect((await api.post(apiPaths.sessionApproval(sessionId, request.requestId), { decision: 'deny' })).status).toBe(204)
    await stream.waitFor(isRunEnd(sessionId))

    const entries = stream.entries(sessionId)
    const [result] = toolResults(entries)
    expect(result).toMatchObject({ toolCallId: 'b1', isError: true })
    expect(text(result!)).toMatch(/rejected/)
    expect(entries.at(-1)?.payload).toEqual({ status: 'aborted' })
    expect(entries.filter((e) => kindOf(e) === 'assistant')).toHaveLength(1)
    expect(await exists(join(root, 'out.txt'))).toBe(false)
  })

  it('带反馈拒绝 → 反馈出现在 toolResult 中，Run 继续到下一次模型请求', async () => {
    const { root, api, sessionId, stream } = await boot([{ content: [bashWrite('b1', 'out.txt')] }, { content: 'Understood, trying notes/ instead.' }])
    await api.post(apiPaths.sessionMessages(sessionId), { text: 'write it' })
    const request = await waitApproval(stream, sessionId)
    await api.post(apiPaths.sessionApproval(sessionId, request.requestId), { decision: 'deny', feedback: 'write under notes/ please' })
    await stream.waitFor(isRunEnd(sessionId))

    const entries = stream.entries(sessionId)
    expect(text(toolResults(entries)[0]!)).toContain('write under notes/ please')
    expect(entries.find((e) => e.kind === 'approval_decision')?.payload).toEqual({
      requestId: request.requestId,
      outcome: 'denied',
      feedback: 'write under notes/ please',
    })
    expect(entries.map(kindOf).slice(-2)).toEqual(['assistant', 'run_end'])
    expect(JSON.stringify(entries.at(-2)?.payload)).toContain('trying notes/ instead')
    expect(entries.at(-1)?.payload).toEqual({ status: 'completed' })
    expect(await exists(join(root, 'out.txt'))).toBe(false)
  })

  it('同批两个需审批的调用按调用顺序逐个出现；等待审批时停止 → cancelled，本批调用都不执行', async () => {
    const { root, api, sessionId, stream } = await boot([
      { content: [bashWrite('b1', 'one.txt'), bashWrite('b2', 'two.txt')] },
      { content: 'should not be used' },
    ])
    await api.post(apiPaths.sessionMessages(sessionId), { text: 'write both' })
    const first = await waitApproval(stream, sessionId, 1)
    expect(first.toolCallId).toBe('b1')
    expect(stream.entries(sessionId).filter((e) => e.kind === 'approval_request')).toHaveLength(1)
    await api.post(apiPaths.sessionApproval(sessionId, first.requestId), { decision: 'allow' })
    const second = await waitApproval(stream, sessionId, 2)
    expect(second.toolCallId).toBe('b2')

    expect((await api.post(apiPaths.sessionAbort(sessionId))).body).toEqual({ aborted: true })
    await stream.waitFor(isRunEnd(sessionId))
    const entries = stream.entries(sessionId)
    const decisions = entries.filter((e) => e.kind === 'approval_decision').map((e) => e.payload)
    expect(decisions).toEqual([
      { requestId: first.requestId, outcome: 'allowed', scope: 'once' },
      { requestId: second.requestId, outcome: 'cancelled' },
    ])
    expect(entries.at(-1)?.payload).toEqual({ status: 'aborted' })
    // pi 先逐个准备整批调用再执行：停止发生在第二个调用的审批中，已允许的第一个调用也还没开始，一并不执行。
    expect(toolResults(entries).map((r) => [r.toolCallId, r.isError])).toEqual([
      ['b1', true],
      ['b2', true],
    ])
    expect(await exists(join(root, 'one.txt'))).toBe(false)
    expect(await exists(join(root, 'two.txt'))).toBe(false)
    expect((await api.post(apiPaths.sessionApproval(sessionId, second.requestId), { decision: 'allow' })).status).toBe(409)
  })

  it('等待审批时重新订阅（afterSeq 0）能看到 pending 请求；inspect-quit 把等待审批的 Run 计为 1', async () => {
    const { sidecar, cookie, api, sessionId, stream } = await boot([{ content: [bashWrite('b1', 'out.txt')] }, { content: 'done' }])
    await api.post(apiPaths.sessionMessages(sessionId), { text: 'write it' })
    const request = await waitApproval(stream, sessionId)

    const again = await connect(sidecar, cookie)
    again.send({ type: 'subscribe', sessionId, afterSeq: 0 })
    expect(await again.waitFor((m) => m.type === 'subscribed')).toMatchObject({ running: true })
    const replayed = again.entries(sessionId)
    expect(replayed.find((e) => e.kind === 'approval_request')?.payload).toEqual(request)
    expect(replayed.some((e) => e.kind === 'approval_decision')).toBe(false)

    sidecar.send({ type: 'inspect-quit', requestId: 7 })
    expect(await sidecar.waitMessage('inspect-quit.result')).toEqual({ type: 'inspect-quit.result', requestId: 7, activeRuns: 1 })

    await api.post(apiPaths.sessionApproval(sessionId, request.requestId), { decision: 'allow' })
    await again.waitFor(isRunEnd(sessionId))
  })
})
