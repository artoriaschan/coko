// 上下文用量：真实 Sidecar（faux 模型，临时 COKO_HOME）。GET /api/workspaces/:id/context 与 /api/sessions/:id/context 的分项、
// 指令文件与截断、诊断；一次 Run 后 tokens 等于 faux usage（加其后消息的 chars/4）；context_usage progress 在 assistant 条目之后。
// 另覆盖规则校验接受贡献工具名：PUT /api/permissions 写入 Memory 与 MCP 资源工具的拒绝规则后生效。
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  API_ROUTES,
  apiPaths,
  contextPaths,
  mcpPaths,
  memoryPaths,
  permissionPaths,
  type ContextUsageResponse,
  type McpResponse,
  type ServerMessage,
} from '@coko/protocol'
import { stdioServerConfig } from '../fixtures/mcp/index.ts'
import { FIXTURE_PNG } from '../fixtures/mcp/server-core.ts'
import {
  client,
  connect,
  exchange,
  fauxScript,
  isRunEnd,
  sidecarDirs,
  startSidecar,
  tempDir,
  waitApproval,
  writeCokoHome,
  type Stream,
} from './sidecar-harness.ts'

type Api = ReturnType<typeof client>
type Usage = { input: number; output: number; cacheRead: number; cacheWrite: number }

async function boot(responses: unknown[], extra: Record<string, unknown> = {}) {
  const root = await tempDir()
  const workspaceDir = join(root, 'ws')
  await mkdir(workspaceDir)
  const dirs = await sidecarDirs()
  const script = await fauxScript(root, { responses, ...extra })
  const sidecar = await startSidecar({ dirs, env: { COKO_FAUX_SCRIPT: script } })
  const cookie = await exchange(sidecar)
  const api = client(sidecar, cookie)
  const stream = await connect(sidecar, cookie)
  return { root, workspaceDir, dirs, sidecar, api, stream }
}

async function openSession(api: Api, stream: Stream, workspaceId: string, mode?: string): Promise<string> {
  const sessionId = (await api.post(API_ROUTES.sessions, { workspaceId })).body.id as string
  if (mode) {
    const changed = await api.put(permissionPaths.sessionPermissionMode(sessionId), { mode })
    if (changed.status !== 200) throw new Error(`permission mode not set: ${changed.status}`)
  }
  stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
  await stream.waitFor((m) => m.type === 'subscribed' && m.sessionId === sessionId)
  return sessionId
}

const runEnds = (stream: Stream, sessionId: string) => stream.entries(sessionId).filter((e) => e.kind === 'run_end').length
const waitRunEnds = (stream: Stream, sessionId: string, n: number) => stream.waitFor(() => runEnds(stream, sessionId) >= n)
const usageOf = (payload: unknown) => {
  const u = (payload as { usage: Usage }).usage
  return u.input + u.cacheRead + u.cacheWrite + u.output
}
const assistants = (stream: Stream, sessionId: string) =>
  stream.entries(sessionId).filter((e) => e.kind === 'message' && (e.payload as { role: string }).role === 'assistant')
const call = (id: string, name: string, args: Record<string, unknown> = {}) => ({ type: 'toolCall', id, name, arguments: args })

describe('上下文用量接口', () => {
  it('State Update 计入 system，用户输入中的同名文本计入 prompt', async () => {
    const { workspaceDir, api, stream, sidecar } = await boot([
      { content: 'done', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
      { content: 'done', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
    ])
    const workspaceId = (await api.post(API_ROUTES.workspaces, { path: workspaceDir })).body.id as string
    const results: ContextUsageResponse[] = []
    for (const text of ['abcd', '<state_update name="date">\n2026-11-05\n</state_update>']) {
      const sessionId = await openSession(api, stream, workspaceId)
      expect((await api.post(apiPaths.sessionMessages(sessionId), { text })).status).toBe(202)
      await waitRunEnds(stream, sessionId, 1)
      const usage = await api.get(contextPaths.session(sessionId))
      expect(usage.status).toBe(200)
      results.push(usage.body as ContextUsageResponse)
    }
    expect(results.map((result) => result.breakdown.prompt)).toEqual([1, 14])
    expect(results[0]!.breakdown.system).toBeGreaterThan(0)
    expect(results[1]!.breakdown.system).toBe(results[0]!.breakdown.system)
    expect(results.map((result) => result.estimated)).toEqual([true, true])
    expect(await sidecar.stop()).toEqual({ code: 0, signal: null })
  })

  it('含思考、调用、图片结果的会话，五类之和等于 usage，窗口与压缩阈值保持原值', async () => {
    const { workspaceDir, api, stream, sidecar } = await boot(
      [
        { content: [{ type: 'thinking', thinking: 'Inspect the image first.' }, call('image', 'read', { path: 'dot.png' })] },
        {
          content: [
            { type: 'thinking', thinking: 'The image is available.' },
            { type: 'text', text: 'Image inspected.' },
          ],
          usage: { input: 12_000, output: 300 },
        },
      ],
      { contextWindow: 40_000, maxTokens: 4_000 },
    )
    await writeFile(join(workspaceDir, 'dot.png'), Buffer.from(FIXTURE_PNG, 'base64'))
    const workspace = (await api.post(API_ROUTES.workspaces, { path: workspaceDir })).body as { id: string }
    const sessionId = await openSession(api, stream, workspace.id)
    expect((await api.post(apiPaths.sessionMessages(sessionId), { text: 'Inspect dot.png' })).status).toBe(202)
    await stream.waitFor(isRunEnd(sessionId))
    const imageResult = stream.entries(sessionId).find((e) => e.kind === 'message' && (e.payload as { toolCallId?: string }).toolCallId === 'image')
    expect(imageResult?.payload).toMatchObject({
      role: 'toolResult',
      isError: false,
      content: expect.arrayContaining([expect.objectContaining({ type: 'image' })]),
    })
    const result = (await api.get(contextPaths.session(sessionId))).body as ContextUsageResponse
    expect(result).toMatchObject({ tokens: 12_300, contextWindow: 40_000, threshold: 32_000, warning: 12_000, estimated: false })
    expect(Object.keys(result.breakdown).sort()).toEqual(['assistant', 'prompt', 'system', 'thinking', 'tools'])
    for (const value of Object.values(result.breakdown)) expect(value).toBeGreaterThan(0)
    expect(Object.values(result.breakdown).reduce((sum, value) => sum + value, 0)).toBe(12_300)
    expect(await sidecar.stop()).toEqual({ code: 0, signal: null })
  })

  it('分项、已加载指令与截断、诊断；Run 后 tokens 为 faux usage 加其后估算；context_usage 在 assistant 条目之后', { timeout: 60_000 }, async () => {
    const { workspaceDir, dirs, api, stream, sidecar } = await boot(
      [{ content: 'done' }, { content: [call('w1', 'write', { path: 'a.txt', content: 'x' })] }],
      { contextWindow: 40_000, maxTokens: 4_000 },
    )
    const userAgents = await writeCokoHome(dirs, 'AGENTS.md', 'USER-RULE\n')
    await writeFile(join(workspaceDir, 'AGENTS.md'), 'P'.repeat(41_000))
    await mkdir(join(workspaceDir, '.coko', 'skills', 'deploy'), { recursive: true })
    await writeFile(join(workspaceDir, '.coko', 'skills', 'deploy', 'SKILL.md'), '---\nname: deploy\ndescription: Deploy the app.\n---\nSteps.\n')
    await mkdir(join(workspaceDir, '.coko', 'skills', 'wrong'), { recursive: true })
    await writeFile(join(workspaceDir, '.coko', 'skills', 'wrong', 'SKILL.md'), '---\nname: other\ndescription: Mismatch.\n---\n')
    const workspace = (await api.post(API_ROUTES.workspaces, { path: workspaceDir })).body as { id: string; path: string }
    expect((await api.post(memoryPaths.memories, { scope: 'user', content: 'The user prefers tabs' })).status).toBe(201)

    expect((await api.get(contextPaths.workspace('missing'))).status).toBe(404)
    expect((await api.get(contextPaths.session('missing'))).status).toBe(404)

    const draft = (await api.get(contextPaths.workspace(workspace.id))).body as ContextUsageResponse
    // 有效窗口 = 40 000 − 4 000；阈值 = 36 000 − 13 000；预警 = 阈值 − 20 000。
    expect(draft).toMatchObject({ contextWindow: 40_000, threshold: 32_000, warning: 12_000, estimated: true, autoCompact: { enabled: true, paused: false } })
    const b = draft.breakdown
    expect(Object.keys(b).sort()).toEqual(['assistant', 'prompt', 'system', 'thinking', 'tools'])
    // 指令、Skills 与 Memory 已合入系统；单文件截断后的系统至少 10k。
    expect(b.system).toBeGreaterThanOrEqual(10_000)
    expect(b.system).toBeGreaterThan(0)
    expect(b.tools).toBeGreaterThan(0)
    expect(b.prompt).toBe(0)
    expect(b.assistant).toBe(0)
    expect(b.thinking).toBe(0)
    expect(draft.tokens).toBe(Object.values(b).reduce((sum, tokens) => sum + tokens, 0))
    expect(draft.instructions).toEqual([
      { path: userAgents, scope: 'user', chars: 'USER-RULE\n'.length, truncated: false },
      expect.objectContaining({ path: join(workspace.path, 'AGENTS.md'), scope: 'project', truncated: true }),
    ])
    expect(draft.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ source: 'skills', code: 'name-mismatch', path: join(workspace.path, '.coko/skills/wrong/SKILL.md') })]),
    )

    // Run 1：一条 assistant 回复。tokens 等于其 usage（之后没有消息）。
    const sessionId = await openSession(api, stream, workspace.id)
    expect((await api.post(apiPaths.sessionMessages(sessionId), { text: 'hello' })).status).toBe(202)
    await stream.waitFor(isRunEnd(sessionId))
    const [reply] = assistants(stream, sessionId)
    const replyAt = stream.messages.findIndex((m) => m.type === 'entry' && m.entry.seq === reply!.seq)
    const usageAt = stream.messages.findIndex((m) => m.type === 'progress' && m.sessionId === sessionId && m.event.type === 'context_usage')
    expect(replyAt).toBeGreaterThanOrEqual(0)
    expect(usageAt).toBeGreaterThan(replyAt)
    const progress = stream.messages[usageAt] as Extract<ServerMessage, { type: 'progress' }>
    expect(progress.event).toEqual({ type: 'context_usage', tokens: usageOf(reply!.payload), contextWindow: 40_000 })
    const afterFirst = (await api.get(contextPaths.session(sessionId))).body as ContextUsageResponse
    expect(afterFirst).toMatchObject({ tokens: usageOf(reply!.payload), estimated: false, contextWindow: 40_000 })
    expect(afterFirst.breakdown.prompt).toBeGreaterThan(0)
    expect(afterFirst.breakdown.assistant).toBeGreaterThan(0)
    expect(Object.values(afterFirst.breakdown).reduce((sum, tokens) => sum + tokens, 0)).toBe(afterFirst.tokens)

    // Run 2：write 需审批，拒绝 → 其后有 user message 与被拒绝的 toolResult，tokens = 该 assistant 的 usage + 其后 chars/4。
    expect((await api.post(apiPaths.sessionMessages(sessionId), { text: 'write it' })).status).toBe(202)
    const request = await waitApproval(stream, sessionId)
    expect((await api.post(apiPaths.sessionApproval(sessionId, request.requestId), { decision: 'deny' })).status).toBe(204)
    await waitRunEnds(stream, sessionId, 2)
    const second = assistants(stream, sessionId)[1]!
    const after = stream.entries(sessionId).filter((e) => e.seq > second.seq && e.kind === 'message')
    expect(after.map((e) => (e.payload as { role: string }).role)).toEqual(['toolResult'])
    const trailing = (after[0]!.payload as { content: { type: string; text: string }[] }).content.reduce((n, c) => n + c.text.length, 0)
    const afterSecond = (await api.get(contextPaths.session(sessionId))).body as ContextUsageResponse
    expect(afterSecond).toMatchObject({ tokens: usageOf(second.payload) + Math.ceil(trailing / 4), estimated: true })
    expect(stream.invalidEntries).toEqual([])
    expect(await sidecar.stop()).toEqual({ code: 0, signal: null })
  })
})

describe('规则校验接受贡献工具名', () => {
  it('PUT /api/permissions 写入 Memory、memory_list 与 MCP 资源工具的拒绝规则（含未注册的 mcp__ 名字），之后生效', { timeout: 60_000 }, async () => {
    const { api, stream, workspaceDir, sidecar } = await boot([
      {
        content: [
          call('mw', 'memory_write', { content: 'x', scope: 'user' }),
          call('ml', 'memory_list'),
          call('rr', 'read_mcp_resource', { server: 'docs', uri: 'fixture://notes/readme' }),
          call('lr', 'list_mcp_resources', { server: 'docs' }),
        ],
      },
      { content: 'ok' },
    ])
    const workspace = (await api.post(API_ROUTES.workspaces, { path: workspaceDir })).body as { id: string }
    const docs = stdioServerConfig({ MCP_FIXTURE_FEATURES: 'resources' })
    expect((await api.put(mcpPaths.servers, { servers: { docs }, expectedRevision: 0, workspaceId: workspace.id })).status).toBe(200)

    const rules = ['memory_write', 'memory_list', 'read_mcp_resource', 'mcp__later'].map((tool) => ({ behavior: 'deny', tool }))
    const saved = await api.put(permissionPaths.permissions, { target: 'global', rules, expectedRevision: 0 })
    expect(saved.status).toBe(200)
    expect(saved.body.global.rules.map((r: { tool: string }) => r.tool)).toEqual(['Memory', 'memory_list', 'read_mcp_resource', 'mcp__later'])
    // 不是工具名的仍被拒绝。
    const unknown = await api.put(permissionPaths.permissions, { target: 'global', rules: [{ behavior: 'deny', tool: 'no_such_tool' }], expectedRevision: 1 })
    expect(unknown.status).toBe(400)
    expect(unknown.body.error.details).toMatchObject({ reason: 'unknown-tool' })

    const deadline = Date.now() + 20_000
    while (((await api.get(`${mcpPaths.mcp}?workspaceId=${workspace.id}`)).body as McpResponse).servers[0]?.status !== 'connected') {
      if (Date.now() > deadline) throw new Error('docs never connected')
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    const sessionId = await openSession(api, stream, workspace.id, 'full-access')
    expect((await api.post(apiPaths.sessionMessages(sessionId), { text: 'go' })).status).toBe(202)
    await stream.waitFor(isRunEnd(sessionId))
    const results = Object.fromEntries(
      stream
        .entries(sessionId)
        .filter((e) => e.kind === 'message' && (e.payload as { role: string }).role === 'toolResult')
        .map((e) => {
          const p = e.payload as { toolCallId: string; isError: boolean; content: { text?: string }[] }
          return [p.toolCallId, { isError: p.isError, text: p.content.map((c) => c.text ?? '').join('') }]
        }),
    )
    expect(results.mw).toEqual({ isError: true, text: 'Permission denied by rule Memory.' })
    expect(results.ml).toEqual({ isError: true, text: 'Permission denied by rule memory_list.' })
    expect(results.rr).toEqual({ isError: true, text: 'Permission denied by rule read_mcp_resource.' })
    expect(results.lr!.isError).toBe(false)
    expect(await sidecar.stop()).toEqual({ code: 0, signal: null })
  })
})
