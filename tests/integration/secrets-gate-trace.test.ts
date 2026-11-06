// 秘密不外泄总闸的追踪通道（ADR 0004、0007）：GET …/trace、…/audit 与 …/export（含 ?children=1）是新的输出通道。工具输出与 Hook 的反馈中
// 回显登记的 Secret（入库时已替换），用户在提示中输入的 Secret 按原文入库（ADR 0007）；导出、追踪与审计的响应中都不得出现两者的明文，
// faux requestLog 中同样没有。
import { randomBytes } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { API_ROUTES, apiPaths, hookPaths, permissionPaths, tracePaths } from '@coko/protocol'
import { connect, exchange, fauxScript, sidecarDirs, startSidecar, tempDir } from './sidecar-harness.ts'
import { leaksIn, recordingClient } from './secrets-gate-harness.ts'

describe('秘密不外泄总闸：追踪、审计与导出', () => {
  it('工具输出、Hook 反馈与用户输入中的登记 Secret 不出现在 trace、audit、export 与 requestLog 中', { timeout: 90_000 }, async () => {
    const value = 'trace-token-' + randomBytes(12).toString('hex')
    const typed = 'typed-token-' + randomBytes(12).toString('hex')
    const root = await tempDir()
    const dirs = await sidecarDirs()
    const requestLog = join(root, 'requests.jsonl')
    await writeFile(requestLog, '')
    const call = (id: string, command: string) => ({ type: 'toolCall', name: 'bash', id, arguments: { command } })
    const script = await fauxScript(root, {
      requestLog,
      responses: [{ content: [call('b1', 'printf "token=%s\\n" "$(cat .value)"')] }, { content: [call('b2', `printf '%s' '${value}'`)] }, { content: 'done' }],
    })
    const sidecar = await startSidecar({ dirs, ipc: false, env: { COKO_FAUX_SCRIPT: script, COKO_SECRET_TRACE_TOKEN: value, COKO_SECRET_TYPED_TOKEN: typed } })
    const cookie = await exchange(sidecar)
    const bodies: string[] = []
    const api = recordingClient(sidecar, cookie, bodies)
    const stream = await connect(sidecar, cookie)
    await writeFile(join(root, '.value'), value)
    // PostToolUse：把 Workspace 中的值作为 exit 2 的反馈交回（hook_run.message 与审计的 message）。
    const hooks = { PostToolUse: [{ hooks: [{ type: 'command', command: `printf 'feedback=%s' "$(cat .value)" >&2; exit 2` }] }] }
    expect((await api.put(hookPaths.hooks, { hooks, expectedRevision: 0 })).status).toBe(200)
    const workspaceId = (await api.post(API_ROUTES.workspaces, { path: root })).body.id as string
    const sessionId = (await api.post(API_ROUTES.sessions, { workspaceId })).body.id as string
    expect((await api.put(permissionPaths.sessionPermissionMode(sessionId), { mode: 'full-access' })).status).toBe(200)
    stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
    await stream.waitFor((m) => m.type === 'subscribed' && m.sessionId === sessionId)
    expect((await api.post(apiPaths.sessionMessages(sessionId), { text: `deploy with ${typed}` })).status).toBe(202)
    await stream.waitFor(() => stream.entries(sessionId).some((e) => e.kind === 'run_end'), 30_000)

    bodies.length = 0
    const trace = await api.get(tracePaths.trace(sessionId))
    const audit = await api.get(tracePaths.audit(sessionId))
    const exported = await api.get(tracePaths.export(sessionId))
    const withChildren = await api.get(tracePaths.export(sessionId, true))
    expect([trace.status, audit.status, exported.status, withChildren.status]).toEqual([200, 200, 200, 200])

    // 前置：每个通道确实带有这些条目（替换后的标记、Hook 反馈与用户消息）。
    expect(JSON.stringify(audit.body)).toContain('feedback=[REDACTED:secret]')
    const exportText = String(exported.body)
    expect(exportText).toContain('token=[REDACTED:secret]')
    expect(exportText).toContain('deploy with [REDACTED:secret]')
    expect((trace.body as { totals: { toolCalls: number } }).totals.toolCalls).toBe(2)
    // 用户输入的明文仍在库中按原样保存（ADR 0007），HTTP 读回的会话详情中可见：导出不是读回原文。
    const detail = (await api.get(apiPaths.session(sessionId))).body
    expect(JSON.stringify(detail)).toContain(typed)
    const requestEntries = detail.entries.filter((entry: { kind: string }) => entry.kind === 'model_request')
    expect(requestEntries).toHaveLength(3)
    for (const entry of requestEntries) {
      expect(entry.payload.snapshot.system).toContain('You are Coko')
      expect(entry.payload.snapshot.tools.length).toBeGreaterThan(0)
      expect(JSON.stringify(entry.payload.snapshot)).not.toContain(value)
      expect(JSON.stringify(entry.payload.snapshot)).not.toContain(typed)
    }
    bodies.pop()

    const requests = (await readFile(requestLog, 'utf8')).split('\n').filter(Boolean)
    const channels: [string, string][] = [
      ...bodies.map((body, i): [string, string] => ['http body ' + i, body]),
      ...requests.map((line, i): [string, string] => ['model request ' + i, line]),
    ]
    expect(bodies).toHaveLength(4)
    expect(leaksIn(channels, { 'registered secret': value })).toEqual([])
    expect(
      leaksIn(
        bodies.map((body, i): [string, string] => ['http body ' + i, body]),
        { 'typed secret': typed },
      ),
    ).toEqual([])
    sidecar.child.kill('SIGTERM')
    expect(await sidecar.exited).toEqual({ code: 0, signal: null })
  })
})
