// 秘密不外泄总闸的 Memory 通道（票 09，ADR 0004）：模型服务在错误中回显 Credential，模型把回显的错误文本写入记忆，用户也把它粘贴进
// 设置的 Memory 分区。Memory 引入的通道——memory_* 工具结果（条目与 tool_end 进度）、/api/memories 响应体、库中 memories 表、
// 之后 Session 的 <memory> system section——以及日志与 COKO_HOME 中都不得出现明文；保存的正文带脱敏占位。
// 模型自己的工具调用参数（assistant 消息、tool_start 进度与审批对象）是模型输出的原文，与其他工具相同，不属于本通道。
import { DatabaseSync } from 'node:sqlite'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { API_ROUTES, apiPaths, memoryPaths, permissionPaths } from '@coko/protocol'
import { connect, exchange, fauxScript, sidecarDirs, startSidecar, tempDir } from './sidecar-harness.ts'
import { leaksIn, marker, persisted, recordingClient } from './secrets-gate-harness.ts'

describe('秘密不外泄总闸：Memory', () => {
  it('回显 Credential 的错误文本经 memory_write 与 /api/memories 写入后，Memory 的各通道没有明文', { timeout: 120_000 }, async () => {
    const credential = marker('cred')
    const root = await tempDir()
    const dirs = await sidecarDirs()
    const echoed = `Incorrect API key provided: ${credential}`
    const requestLog = join(root, 'requests.jsonl')
    await writeFile(requestLog, '')
    const script = await fauxScript(root, {
      requestLog,
      responses: [
        // Run 1：模型服务的错误回显 Credential。
        { content: [], stopReason: 'error', errorMessage: echoed },
        // Run 2：模型把错误文本记下，并列出记忆。
        { content: [{ type: 'toolCall', name: 'memory_write', id: 'w1', arguments: { content: `Last provider error: ${echoed}`, scope: 'workspace' } }] },
        { content: [{ type: 'toolCall', name: 'memory_list', id: 'l1', arguments: {} }] },
        { content: 'noted' },
        // 新 Session：记忆注入系统提示。
        { content: 'hello again' },
      ],
    })
    const sidecar = await startSidecar({ dirs, ipc: false, env: { COKO_FAUX_SCRIPT: script, DEEPSEEK_API_KEY: credential } })
    const cookie = await exchange(sidecar)
    const bodies: string[] = []
    const api = recordingClient(sidecar, cookie, bodies)
    const stream = await connect(sidecar, cookie)
    const workspaceId = (await api.post(API_ROUTES.workspaces, { path: root })).body.id as string
    const runEnds = (sessionId: string) => stream.entries(sessionId).filter((e) => e.kind === 'run_end').length
    const turn = async (sessionId: string, text: string) => {
      const before = runEnds(sessionId)
      expect((await api.post(apiPaths.sessionMessages(sessionId), { text })).status).toBe(202)
      await stream.waitFor(() => runEnds(sessionId) > before)
    }
    const open = async () => {
      const sessionId = (await api.post(API_ROUTES.sessions, { workspaceId })).body.id as string
      expect((await api.put(permissionPaths.sessionPermissionMode(sessionId), { mode: 'accept-edits' })).status).toBe(200)
      stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
      await stream.waitFor((m) => m.type === 'subscribed' && m.sessionId === sessionId)
      return sessionId
    }

    const a = await open()
    await turn(a, 'hello')
    await turn(a, 'remember the error')
    // 用户把同一段文本粘贴进设置的 Memory 分区，再编辑一次。
    const pasted = await api.post(memoryPaths.memories, { scope: 'user', content: `Key in use: ${credential}` })
    expect(pasted.status).toBe(201)
    expect((await api.put(memoryPaths.memory(pasted.body.id), { content: `Still: ${echoed}` })).status).toBe(200)
    await api.get(`${memoryPaths.memories}?workspaceId=${workspaceId}`)
    const b = await open()
    await turn(b, 'hello')

    // 前置：各通道确实被驱动。
    const memoryResults = stream.entries(a).filter((e) => e.kind === 'message' && String((e.payload as { toolName?: string }).toolName).startsWith('memory_'))
    expect(memoryResults.map((e) => [(e.payload as { toolName: string }).toolName, (e.payload as { isError: boolean }).isError])).toEqual([
      ['memory_write', false],
      ['memory_list', false],
    ])
    expect(JSON.stringify(memoryResults)).toContain('Last provider error: Incorrect API key provided: [REDACTED]')
    const listed = (await api.get(`${memoryPaths.memories}?workspaceId=${workspaceId}`)).body.memories as { content: string }[]
    expect(listed.map((m) => m.content)).toEqual([
      'Still: Incorrect API key provided: [REDACTED]',
      'Last provider error: Incorrect API key provided: [REDACTED]',
    ])
    const requests = (await readFile(requestLog, 'utf8')).split('\n').filter(Boolean)
    const sections = requests.map((line) =>
      JSON.stringify((JSON.parse(line) as { role: string; sections?: unknown }[]).filter((m) => m.role === 'system').map((m) => m.sections ?? null)),
    )
    expect(sections.at(-1)).toContain('Last provider error')
    // Memory 的 WebSocket 通道：memory_* 的工具结果条目与 tool_end / tool_update 进度（不含模型自己的调用参数）。
    const memoryFrames = stream.frames.filter((frame) => {
      const m = JSON.parse(frame) as {
        type: string
        entry?: { kind: string; payload: { role?: string; toolName?: string } }
        event?: { type: string; toolName?: string }
      }
      if (m.type === 'entry') return m.entry!.payload.role === 'toolResult' && String(m.entry!.payload.toolName).startsWith('memory_')
      return m.type === 'progress' && (m.event!.type === 'tool_end' || m.event!.type === 'tool_update') && String(m.event!.toolName).startsWith('memory_')
    })
    expect(memoryFrames.length).toBeGreaterThanOrEqual(4)

    sidecar.child.kill('SIGTERM')
    expect(await sidecar.exited).toEqual({ code: 0, signal: null })
    const files = await persisted(dirs, { includeCokoHome: true })
    const db = new DatabaseSync(join(dirs.dataDir, 'coko.db'), { readOnly: true })
    const rows = db.prepare('SELECT content FROM memories').all() as { content: string }[]
    db.close()
    expect(rows).toHaveLength(2)

    const channels: [string, string | Buffer][] = [
      ...memoryFrames.map((frame, i): [string, string] => [`memory ws frame ${i}`, frame]),
      ...bodies.map((body, i): [string, string] => [`http body ${i}`, body]),
      ...rows.map((row, i): [string, string] => [`memories row ${i}`, row.content]),
      ...sections.map((s, i): [string, string] => [`request ${i} system sections`, s]),
      ...files.filter((f) => !f.name.startsWith('coko.db')).map((f): [string, Buffer] => [`stopped ${f.name}`, f.bytes]),
    ]
    expect(leaksIn(channels, { credential })).toEqual([])
  })
})
