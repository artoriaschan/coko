// MCP 连接与工具：真实 Sidecar + 仓库内的 stdio 与 HTTP 测试 Server。覆盖工具进入模型请求、审批与权限类 external、
// mcp__<server> 规则、disabledTools、isError、截断、超时与 _meta.idempotencyKey；项目 .mcp.json 的批准（ADR 0008）；连接失败不阻止 Run、
// 崩溃后 failed 带 stderr 尾部与自动重连、手动重连、有序关闭后子进程退出。
import { existsSync } from 'node:fs'
import { mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import { API_ROUTES, apiPaths, mcpPaths, permissionPaths, type McpResponse, type McpServerInfo } from '@coko/protocol'
import { startHttpFixture, stdioServerConfig, stdioServerEntry } from '../fixtures/mcp/index.ts'
import { client, connect, exchange, fauxScript, isRunEnd, sidecarDirs, startSidecar, tempDir, waitApproval, type Stream } from './sidecar-harness.ts'

type Api = ReturnType<typeof client>

const readJsonl = async (path: string): Promise<Record<string, any>[]> =>
  existsSync(path)
    ? (await readFile(path, 'utf8'))
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, any>)
    : []

const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function setup(responses: unknown[], extra: { env?: Record<string, string> } = {}) {
  const root = await tempDir()
  const workspaceDir = join(root, 'ws')
  await mkdir(workspaceDir)
  const dirs = await sidecarDirs()
  const requestLog = join(root, 'requests.jsonl')
  await writeFile(requestLog, '')
  const script = await fauxScript(root, { requestLog, responses })
  const sidecar = await startSidecar({ dirs, env: { COKO_FAUX_SCRIPT: script, ...extra.env } })
  const cookie = await exchange(sidecar)
  const api = client(sidecar, cookie)
  const stream = await connect(sidecar, cookie)
  const workspace = (await api.post(API_ROUTES.workspaces, { path: workspaceDir })).body as { id: string; path: string }
  return { root, workspaceDir, dirs, requestLog, sidecar, api, stream, workspace }
}

async function newSession(api: Api, stream: Stream, workspaceId: string): Promise<string> {
  const sessionId = (await api.post(API_ROUTES.sessions, { workspaceId })).body.id as string
  stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
  await stream.waitFor((m) => m.type === 'subscribed' && m.sessionId === sessionId)
  return sessionId
}

const runEnds = (stream: Stream, sessionId: string) => stream.entries(sessionId).filter((e) => e.kind === 'run_end')
const waitRunEnds = (stream: Stream, sessionId: string, n: number) => stream.waitFor(() => runEnds(stream, sessionId).length >= n)
const toolResults = (stream: Stream, sessionId: string) =>
  stream
    .entries(sessionId)
    .filter((e) => e.kind === 'message' && (e.payload as { role: string }).role === 'toolResult')
    .map((e) => e.payload as { toolCallId: string; toolName: string; isError: boolean; content: { type: string; text?: string }[] })
const resultText = (result: { content: { text?: string }[] } | undefined) => (result?.content ?? []).map((c) => c.text ?? '').join('')

const view = async (api: Api, workspaceId: string) => (await api.get(`${mcpPaths.mcp}?workspaceId=${workspaceId}`)).body as McpResponse
const server = async (api: Api, workspaceId: string, name: string) => (await view(api, workspaceId)).servers.find((s) => s.name === name)
async function waitServer(api: Api, workspaceId: string, name: string, match: (s: McpServerInfo) => boolean, timeoutMs = 20_000): Promise<McpServerInfo> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const found = await server(api, workspaceId, name)
    if (found && match(found)) return found
    if (Date.now() > deadline) throw new Error(`server ${name} never matched; last: ${JSON.stringify(found)}`)
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

describe('MCP 连接与工具', () => {
  it('stdio 与 HTTP：工具进入模型请求；default 审批、mcp__<server> 规则、full-access 免审批；isError、截断、超时与幂等键', { timeout: 90_000 }, async () => {
    const http = await startHttpFixture({ name: 'remote' })
    onTestFinished(() => http.close())
    const ctx = await setup([
      { content: [{ type: 'toolCall', name: 'mcp__local__echo', id: 'l1', arguments: { text: 'hi' } }] },
      { content: 'local done' },
      { content: [{ type: 'toolCall', name: 'mcp__remote__echo', id: 'r1', arguments: { text: 'there' } }] },
      { content: 'remote done' },
      {
        content: [
          { type: 'toolCall', name: 'mcp__local__fail', id: 'f1', arguments: {} },
          { type: 'toolCall', name: 'mcp__local__big', id: 'b1', arguments: { lines: 3000 } },
          { type: 'toolCall', name: 'mcp__local__sleep', id: 's1', arguments: { ms: 5000 } },
        ],
      },
      { content: 'batch done' },
    ])
    const { api, stream, workspace } = ctx
    const log = join(ctx.root, 'local.jsonl')
    const saved = await api.put(mcpPaths.servers, {
      servers: {
        local: stdioServerConfig({ MCP_FIXTURE_LOG: log }, { timeout: 1, disabledTools: ['hidden'], alwaysLoad: true }),
        remote: { url: http.url, alwaysLoad: true },
      },
      expectedRevision: 0,
      workspaceId: workspace.id,
    })
    expect(saved.status).toBe(200)
    // 非法配置以 400 拒绝且写明原因；通用设置接口不能改 mcp.servers。
    expect((await api.put(mcpPaths.servers, { servers: { 'bad name': { command: 'x' } }, expectedRevision: 1 })).body).toMatchObject({
      error: { code: 'bad-request', message: expect.stringContaining('bad name') },
    })
    expect((await api.put(apiPaths.setting('mcp.servers'), { value: {}, expectedRevision: 1 })).status).toBe(400)

    const local = await waitServer(api, workspace.id, 'local', (s) => s.status === 'connected')
    expect(local).toMatchObject({ scope: 'global', transport: 'stdio' })
    expect(local.tools.map((t) => t.name)).toEqual([
      'mcp__local__echo',
      'mcp__local__env_sha',
      'mcp__local__env_raw',
      'mcp__local__fail',
      'mcp__local__big',
      'mcp__local__sleep',
    ])
    await waitServer(api, workspace.id, 'remote', (s) => s.status === 'connected' && s.transport === 'http')

    // Run 1（default）：MCP 工具需要审批，允许后结果回到模型。
    const sessionId = await newSession(api, stream, workspace.id)
    await api.post(apiPaths.sessionMessages(sessionId), { text: 'use local' })
    const approval = await waitApproval(stream, sessionId)
    expect(approval).toMatchObject({ toolCallId: 'l1', toolName: 'mcp__local__echo' })
    expect((await api.post(apiPaths.sessionApproval(sessionId, approval.requestId), { decision: 'allow' })).status).toBe(204)
    await waitRunEnds(stream, sessionId, 1)
    expect(resultText(toolResults(stream, sessionId).find((r) => r.toolCallId === 'l1'))).toBe('echo:hi')
    const requests = (await readFile(ctx.requestLog, 'utf8')).split('\n').filter(Boolean)
    expect(requests[0]).toContain('"mcp__local__echo"')
    expect(requests[0]).toContain('"mcp__remote__echo"')
    expect(requests[0]).not.toContain('mcp__local__hidden')
    // 第二次请求带着工具结果回到模型。
    expect(requests[1]).toContain('echo:hi')
    const localCalls = (await readJsonl(log)).filter((e) => e.event === 'call')
    expect(localCalls[0]!.params).toMatchObject({ name: 'echo', _meta: { idempotencyKey: `${sessionId}:l1` } })

    // Run 2：Session 规则 mcp__remote 放行该 Server 的全部工具。
    const rule = await api.post(permissionPaths.sessionPermissionRules(sessionId), { rule: { behavior: 'allow', tool: 'mcp__remote' } })
    expect(rule.status).toBe(200)
    await api.post(apiPaths.sessionMessages(sessionId), { text: 'use remote' })
    await waitRunEnds(stream, sessionId, 2)
    expect(stream.entries(sessionId).filter((e) => e.kind === 'approval_request')).toHaveLength(1)
    expect(resultText(toolResults(stream, sessionId).find((r) => r.toolCallId === 'r1'))).toBe('echo:there')
    expect(http.calls[0]).toMatchObject({ name: 'echo', _meta: { idempotencyKey: `${sessionId}:r1` } })

    // Run 3（full-access）：免审批；isError、超长截断与超时都是该次调用的结果，不中断 Run。
    expect((await api.put(permissionPaths.sessionPermissionMode(sessionId), { mode: 'full-access' })).status).toBe(200)
    await api.post(apiPaths.sessionMessages(sessionId), { text: 'batch' })
    await waitRunEnds(stream, sessionId, 3)
    expect(stream.entries(sessionId).filter((e) => e.kind === 'approval_request')).toHaveLength(1)
    const results = toolResults(stream, sessionId)
    const fail = results.find((r) => r.toolCallId === 'f1')!
    expect(fail.isError).toBe(true)
    expect(resultText(fail)).toBe('fixture failure')
    const big = resultText(results.find((r) => r.toolCallId === 'b1'))
    expect(big).toContain('row 2000\n')
    expect(big).not.toContain('row 2001')
    expect(big).toContain('[MCP output truncated: showing 2000 of 3000 lines]')
    expect(await readFile(join(ctx.dirs.dataDir, 'tool-results', sessionId, 'b1.txt'), 'utf8')).toBe(
      Array.from({ length: 3000 }, (_, i) => `row ${i + 1}`).join('\n'),
    )
    const slow = results.find((r) => r.toolCallId === 's1')!
    expect(slow.isError).toBe(true)
    expect(resultText(slow)).toMatch(/timed out after 1000ms/)
    expect((runEnds(stream, sessionId).at(-1)!.payload as { status: string }).status).toBe('completed')
    expect(await ctx.sidecar.stop()).toEqual({ code: 0, signal: null })
  })

  it('项目 .mcp.json：批准前不启动，批准后启动，改动 args 后回到 pending；${…} 拒绝加载；与全局同名被忽略', { timeout: 60_000 }, async () => {
    const ctx = await setup([{ content: 'first' }, { content: 'second' }])
    const { api, stream, workspace, workspaceDir, root } = ctx
    const projectLog = join(root, 'project.jsonl')
    const sharedLog = join(root, 'shared-global.jsonl')
    const evilLog = join(root, 'evil.jsonl')
    const project = (args: string[]) => ({
      mcpServers: {
        proj: { command: process.execPath, args, env: { MCP_FIXTURE_LOG: projectLog } },
        secretive: { command: process.execPath, args: [stdioServerEntry], env: { TOKEN: '${MY_TOKEN}' } },
        shared: { command: process.execPath, args: [stdioServerEntry], env: { MCP_FIXTURE_LOG: evilLog } },
      },
    })
    await writeFile(join(workspaceDir, '.mcp.json'), JSON.stringify(project([stdioServerEntry])))
    expect((await api.put(mcpPaths.servers, { servers: { shared: stdioServerConfig({ MCP_FIXTURE_LOG: sharedLog }) }, expectedRevision: 0 })).status).toBe(200)

    const initial = await view(api, workspace.id)
    expect(initial.servers.map((s) => [s.name, s.scope])).toEqual([
      ['shared', 'global'],
      ['proj', 'project'],
    ])
    const pending = initial.servers.find((s) => s.name === 'proj')!
    expect(pending.status).toBe('pending-approval')
    // 项目文件不能引用 Secret（${…} 整项拒绝），env 只有字面值：批准时显示完整的键值，看得到实际执行什么。
    expect(pending.approval).toEqual({
      digest: expect.any(String),
      approved: false,
      launch: { command: process.execPath, args: [stdioServerEntry], env: { MCP_FIXTURE_LOG: projectLog } },
    })
    expect(initial.diagnostics.map((d) => d.code)).toEqual(['project-secret-reference', 'shadowed-by-global'])
    expect(initial.project).toMatchObject({ exists: true })

    // 一个 Run 之后：全局 Server 已启动；未批准的项目 Server 没有启动（标记文件不存在），同名的项目项也没有。
    const sessionId = await newSession(api, stream, workspace.id)
    await api.post(apiPaths.sessionMessages(sessionId), { text: 'hello' })
    await stream.waitFor(isRunEnd(sessionId))
    expect((await readJsonl(sharedLog)).some((e) => e.event === 'start')).toBe(true)
    expect(existsSync(projectLog)).toBe(false)
    expect(existsSync(evilLog)).toBe(false)

    const approved = await api.post(mcpPaths.approvals, { workspaceId: workspace.id, name: 'proj', digest: pending.approval!.digest, approve: true })
    expect(approved.status).toBe(200)
    await waitServer(api, workspace.id, 'proj', (s) => s.status === 'connected' && s.approval?.approved === true)
    const started = (await readJsonl(projectLog)).filter((e) => e.event === 'start')
    expect(started).toHaveLength(1)
    // stdio 的工作目录缺省为按 Server 分配的数据目录。
    expect(await realpath(started[0]!.cwd)).toBe(await realpath(join(ctx.dirs.dataDir, 'mcp', 'proj')))

    // 改动 args：摘要变化，回到 pending，已有连接关闭；用旧摘要批准得到 409。
    await writeFile(join(workspaceDir, '.mcp.json'), JSON.stringify(project([stdioServerEntry, '--changed'])))
    const changed = (await view(api, workspace.id)).servers.find((s) => s.name === 'proj')!
    expect(changed.status).toBe('pending-approval')
    expect(changed.approval?.approved).toBe(false)
    expect(changed.approval?.digest).not.toBe(pending.approval!.digest)
    await expect.poll(() => alive(started[0]!.pid)).toBe(false)
    const stale = await api.post(mcpPaths.approvals, { workspaceId: workspace.id, name: 'proj', digest: pending.approval!.digest, approve: true })
    expect(stale).toMatchObject({ status: 409, body: { error: { code: 'revision-conflict' } } })
    await api.post(apiPaths.sessionMessages(sessionId), { text: 'again' })
    await waitRunEnds(stream, sessionId, 2)
    expect((await readJsonl(projectLog)).filter((e) => e.event === 'start')).toHaveLength(1)
    expect(await ctx.sidecar.stop()).toEqual({ code: 0, signal: null })
  })

  it('连接失败不阻止 Run；崩溃后 failed 带 stderr 尾部并自动重连；重连用尽后 /api/mcp/reconnect 恢复；有序关闭后子进程退出', { timeout: 90_000 }, async () => {
    const ctx = await setup([{ content: 'still works' }])
    const { api, stream, workspace, root } = ctx
    const log = join(root, 'lifecycle.jsonl')
    const flag = join(root, 'fail.flag')
    await api.put(mcpPaths.servers, {
      servers: {
        local: stdioServerConfig({ MCP_FIXTURE_LOG: log, MCP_FIXTURE_STDERR: 'fixture booted', MCP_FIXTURE_FAIL_IF: flag }),
        broken: { command: join(root, 'no-such-mcp-server') },
      },
      expectedRevision: 0,
      workspaceId: workspace.id,
    })
    await waitServer(api, workspace.id, 'local', (s) => s.status === 'connected')
    const broken = await waitServer(api, workspace.id, 'broken', (s) => s.status === 'failed')
    expect(broken.error).toMatch(/ENOENT/)

    const sessionId = await newSession(api, stream, workspace.id)
    await api.post(apiPaths.sessionMessages(sessionId), { text: 'hello' })
    const end = await stream.waitFor(isRunEnd(sessionId))
    expect((end as { entry: { payload: { status: string } } }).entry.payload.status).toBe('completed')

    const starts = async () => (await readJsonl(log)).filter((e) => e.event === 'start').map((e) => e.pid as number)
    const [first] = await starts()
    process.kill(first!, 'SIGKILL')
    const crashed = await waitServer(api, workspace.id, 'local', (s) => s.status === 'failed')
    expect(crashed.error).toBe('Connection closed')
    expect(crashed.stderrTail).toContain('fixture booted')
    await waitServer(api, workspace.id, 'local', (s) => s.status === 'connected')
    const [, second] = await starts()
    expect(second).toBeDefined()
    expect(second).not.toBe(first)

    // 之后每次启动都失败：1、2、4 秒退避的 3 次重连用尽，停在 failed。
    await writeFile(flag, '')
    process.kill(second!, 'SIGKILL')
    await expect.poll(async () => (await starts()).length, { timeout: 20_000 }).toBe(5)
    const exhausted = await waitServer(api, workspace.id, 'local', (s) => s.status === 'failed')
    expect(exhausted.stderrTail).toContain('fail flag present')
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect((await starts()).length).toBe(5)

    await rm(flag)
    const reconnected = await api.post(mcpPaths.reconnect, { workspaceId: workspace.id, name: 'local' })
    expect(reconnected.status).toBe(200)
    expect((reconnected.body as McpResponse).servers.find((s) => s.name === 'local')?.status).toBe('connected')
    const last = (await starts()).at(-1)!
    expect(alive(last)).toBe(true)

    expect(await ctx.sidecar.stop()).toEqual({ code: 0, signal: null })
    await expect.poll(() => alive(last), { timeout: 5_000 }).toBe(false)
  })
})
