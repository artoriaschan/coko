// 秘密不外泄总闸的 Memory 检索通道（ADR 0004）：用户把带 Credential 的文本粘贴进 Memory 后，检索结果——GET /api/memories?query= 的
// 响应体与 memory_list { query } 的工具结果（条目与 tool_end 进度）——以及之后请求中的工具结果、日志与 COKO_HOME 中都没有明文。
// 以 Credential 明文本身作为查询词时，检索得不到条目（库中只有脱敏后的正文），请求日志只记路径、不记查询串。
// 模型自己的工具调用参数（含 query）是模型输出的原文，与其他工具相同，不属于本通道。
import { randomBytes } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { API_ROUTES, apiPaths, memoryPaths, permissionPaths } from '@coko/protocol'
import { connect, exchange, fauxScript, sidecarDirs, startSidecar, tempDir } from './sidecar-harness.ts'
import { leaksIn, persisted, recordingClient } from './secrets-gate-harness.ts'

describe('秘密不外泄总闸：Memory 检索', () => {
  it('带 Credential 的条目经 HTTP 检索与 memory_list 的 query 返回时没有明文，查询串不进日志', { timeout: 120_000 }, async () => {
    const credential = `plain-cred-${randomBytes(12).toString('hex')}`
    const root = await tempDir()
    const dirs = await sidecarDirs()
    const requestLog = join(root, 'requests.jsonl')
    await writeFile(requestLog, '')
    const script = await fauxScript(root, {
      requestLog,
      responses: [{ content: [{ type: 'toolCall', name: 'memory_list', id: 'l1', arguments: { query: 'provider key' } }] }, { content: 'noted' }],
    })
    const sidecar = await startSidecar({ dirs, ipc: false, env: { COKO_FAUX_SCRIPT: script, COKO_CREDENTIAL_GATE_PROVIDER: credential } })
    const cookie = await exchange(sidecar)
    const bodies: string[] = []
    const api = recordingClient(sidecar, cookie, bodies)
    const stream = await connect(sidecar, cookie)
    const workspaceId = (await api.post(API_ROUTES.workspaces, { path: root })).body.id as string

    expect((await api.post(memoryPaths.memories, { scope: 'user', content: `The provider key is ${credential}` })).status).toBe(201)
    expect((await api.post(memoryPaths.memories, { scope: 'workspace', workspaceId, content: `Workspace provider key: ${credential}` })).status).toBe(201)
    const found = await api.get(apiPaths.memorySearch('provider key', { workspaceId }))
    expect((found.body.memories as { content: string }[]).map((m) => m.content).toSorted()).toEqual(
      ['The provider key is [REDACTED]', 'Workspace provider key: [REDACTED]'].toSorted(),
    )
    // 明文作查询词：库中没有明文，得不到条目。
    const byValue = await api.get(apiPaths.memorySearch(credential, { workspaceId }))
    expect(byValue.status).toBe(200)
    expect(byValue.body.memories).toEqual([])

    const sessionId = (await api.post(API_ROUTES.sessions, { workspaceId })).body.id as string
    expect((await api.put(permissionPaths.sessionPermissionMode(sessionId), { mode: 'accept-edits' })).status).toBe(200)
    stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
    await stream.waitFor((m) => m.type === 'subscribed' && m.sessionId === sessionId)
    expect((await api.post(apiPaths.sessionMessages(sessionId), { text: 'what is the key?' })).status).toBe(202)
    await stream.waitFor(() => stream.entries(sessionId).some((e) => e.kind === 'run_end'))

    // 前置：检索通道确实被驱动。
    const results = stream.entries(sessionId).filter((e) => e.kind === 'message' && (e.payload as { toolName?: string }).toolName === 'memory_list')
    expect(results).toHaveLength(1)
    expect(JSON.stringify(results)).toContain('Workspace provider key: [REDACTED]')
    const frames = stream.frames.filter((frame) => {
      const m = JSON.parse(frame) as { type: string; entry?: { payload: { role?: string; toolName?: string } }; event?: { type: string; toolName?: string } }
      if (m.type === 'entry') return m.entry!.payload.role === 'toolResult' && m.entry!.payload.toolName === 'memory_list'
      return m.type === 'progress' && m.event!.type === 'tool_end' && m.event!.toolName === 'memory_list'
    })
    expect(frames.length).toBeGreaterThanOrEqual(2)
    // 之后发给模型的请求中的工具结果（faux requestLog）。
    const requests = (await readFile(requestLog, 'utf8')).split('\n').filter(Boolean)
    expect(requests.at(-1)).toContain('Workspace provider key: [REDACTED]')

    sidecar.child.kill('SIGTERM')
    expect(await sidecar.exited).toEqual({ code: 0, signal: null })
    const files = await persisted(dirs, { includeCokoHome: true })
    expect(files.some((f) => f.name.endsWith('sidecar.jsonl'))).toBe(true)
    const channels: [string, string | Buffer][] = [
      ...frames.map((frame, i): [string, string] => [`memory_list ws frame ${i}`, frame]),
      ...bodies.map((body, i): [string, string] => [`http body ${i}`, body]),
      ...requests.map((line, i): [string, string] => [`model request ${i}`, line]),
      ...files.filter((f) => !f.name.startsWith('coko.db')).map((f): [string, Buffer] => [`stopped ${f.name}`, f.bytes]),
    ]
    expect(leaksIn(channels, { credential })).toEqual([])
  })
})
