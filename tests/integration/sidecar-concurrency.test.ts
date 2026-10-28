// 工具调度与执行记录（票 04）：真实 Sidecar（faux 模型）中 side-effect 调用的 tool_exec 条目位置、幂等键与持久化。
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { API_ROUTES, apiPaths, permissionPaths, type SessionEntryRecord } from '@coko/protocol'
import { client, connect, exchange, fauxScript, isRunEnd, sidecarDirs, startSidecar, tempDir, waitApproval } from './sidecar-harness.ts'

const kindOf = (e: SessionEntryRecord) => (e.kind === 'message' ? (e.payload as { role: string }).role : e.kind)

describe('工具调度与执行记录', () => {
  it('bash 的 tool_exec 位于 toolCall 所在 assistant 之后、toolResult 之前，幂等键为 <sessionId>:<toolCallId>；read 调用没有 tool_exec；重启后读回', async () => {
    const root = await tempDir()
    const script = await fauxScript(root, {
      responses: [
        {
          content: [
            { type: 'toolCall', name: 'ls', id: 'l1', arguments: {} },
            { type: 'toolCall', name: 'bash', id: 'b1', arguments: { command: 'printf hi > out.txt' } },
          ],
        },
        { content: 'done' },
      ],
    })
    const dirs = await sidecarDirs()
    const sidecar = await startSidecar({ dirs, env: { COKO_FAUX_SCRIPT: script } })
    const cookie = await exchange(sidecar)
    const api = client(sidecar, cookie)
    const workspace = await api.post(API_ROUTES.workspaces, { path: root })
    const sessionId = (await api.post(API_ROUTES.sessions, { workspaceId: workspace.body.id })).body.id as string
    const stream = await connect(sidecar, cookie)
    stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
    await stream.waitFor((m) => m.type === 'subscribed')

    await api.post(apiPaths.sessionMessages(sessionId), { text: 'list and write' })
    const request = await waitApproval(stream, sessionId)
    expect(stream.entries(sessionId).some((e) => e.kind === 'tool_exec')).toBe(false)
    await api.post(apiPaths.sessionApproval(sessionId, request.requestId), { decision: 'allow', scope: 'once' })
    await stream.waitFor(isRunEnd(sessionId))

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
      'toolResult',
      'assistant',
      'run_end',
    ])
    const execs = entries.filter((e) => e.kind === 'tool_exec')
    expect(execs.map((e) => e.payload)).toEqual([{ toolCallId: 'b1', toolName: 'bash', idempotencyKey: `${sessionId}:b1` }])
    const runId = entries.find((e) => e.kind === 'run_start')!.runId
    expect(execs[0]!.runId).toBe(runId)
    const assistantSeq = entries.find((e) => kindOf(e) === 'assistant')!.seq
    const bashResultSeq = entries.find((e) => kindOf(e) === 'toolResult' && (e.payload as { toolCallId: string }).toolCallId === 'b1')!.seq
    expect(assistantSeq).toBeLessThan(execs[0]!.seq)
    expect(execs[0]!.seq).toBeLessThan(bashResultSeq)
    expect(stream.invalidEntries).toEqual([])
    expect(await readFile(join(root, 'out.txt'), 'utf8')).toBe('hi')

    await stream.close()
    await sidecar.stop()
    const again = await startSidecar({ dirs, env: { COKO_FAUX_SCRIPT: script } })
    const detail = await client(again, await exchange(again)).get(apiPaths.session(sessionId))
    expect(detail.body.entries).toEqual(entries)
  })

  it('并发观察：同批中 bash 是独占屏障，之前的 read 看到旧状态、之后的 read 看到它的结果；进度事件中屏障前后的调用不交叠', async () => {
    const root = await tempDir()
    await writeFile(join(root, 'before.txt'), 'original\n')
    const read = (id: string, path: string) => ({ type: 'toolCall', name: 'read', id, arguments: { path } })
    const script = await fauxScript(root, {
      responses: [
        {
          content: [
            read('r1', 'before.txt'),
            read('r2', 'before.txt'),
            { type: 'toolCall', name: 'bash', id: 'b1', arguments: { command: 'mv before.txt after.txt' } },
            read('r3', 'after.txt'),
            read('r4', 'before.txt'),
          ],
        },
        { content: 'done' },
      ],
    })
    const sidecar = await startSidecar({ dirs: await sidecarDirs(), env: { COKO_FAUX_SCRIPT: script } })
    const cookie = await exchange(sidecar)
    const api = client(sidecar, cookie)
    const workspace = await api.post(API_ROUTES.workspaces, { path: root })
    const sessionId = (await api.post(API_ROUTES.sessions, { workspaceId: workspace.body.id })).body.id as string
    await api.put(permissionPaths.sessionPermissionMode(sessionId), { mode: 'full-access' })
    const stream = await connect(sidecar, cookie)
    stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
    await stream.waitFor((m) => m.type === 'subscribed')
    await api.post(apiPaths.sessionMessages(sessionId), { text: 'move it' })
    await stream.waitFor(isRunEnd(sessionId))

    const results = new Map(
      stream
        .entries(sessionId)
        .filter((e) => kindOf(e) === 'toolResult')
        .map((e) => {
          const payload = e.payload as { toolCallId: string; isError: boolean; content: { text?: string }[] }
          return [payload.toolCallId, { isError: payload.isError, text: payload.content.map((b) => b.text ?? '').join('') }]
        }),
    )
    expect(results.get('r1')).toMatchObject({ isError: false, text: expect.stringContaining('original') })
    expect(results.get('r2')).toMatchObject({ isError: false, text: expect.stringContaining('original') })
    expect(results.get('b1')?.isError).toBe(false)
    expect(results.get('r3')).toMatchObject({ isError: false, text: expect.stringContaining('original') })
    expect(results.get('r4')?.isError).toBe(true)

    // 进度：bash 的 tool_end 在 r1、r2 的 tool_end 之后；r3、r4 在 bash 结束之前没有结束。
    const ends = stream.messages.flatMap((m) => (m.type === 'progress' && m.event.type === 'tool_end' ? [m.event.toolCallId] : []))
    const at = (id: string) => ends.indexOf(id)
    expect(at('r1')).toBeLessThan(at('b1'))
    expect(at('r2')).toBeLessThan(at('b1'))
    expect(at('b1')).toBeLessThan(at('r3'))
    expect(at('b1')).toBeLessThan(at('r4'))
  })
})
