// 浏览器预设与图像结果（docs/subsystems/mcp.md）：真实 Sidecar。GET /api/mcp/presets 返回 Playwright 预设（精确版本与 --isolated）；
// 预设原样保存后的全局配置形状；Sidecar 的 PATH 以假 npx（仓库内的 stdio 测试 Server）开头，不从网络下载，证明它以预设的参数启动。
// 测试 Server 的 screenshot 结果在条目中为 image 块，faux 的 requestLog 中原样传给模型。找不到 npx 时诊断写明需要 Node.js。
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { API_ROUTES, apiPaths, mcpPaths, permissionPaths, type McpPresetsResponse, type McpResponse, type McpServerInfo } from '@coko/protocol'
import { FIXTURE_SCREENSHOT_PNG, fakeNpx } from '../fixtures/mcp/index.ts'
import { client, connect, exchange, fauxScript, isRunEnd, sidecarDirs, startSidecar, tempDir } from './sidecar-harness.ts'

const readJsonl = async (path: string): Promise<Record<string, any>[]> =>
  existsSync(path)
    ? (await readFile(path, 'utf8'))
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, any>)
    : []

async function setup(responses: unknown[], env: Record<string, string>) {
  const root = await tempDir()
  const workspaceDir = join(root, 'ws')
  await mkdir(workspaceDir)
  const requestLog = join(root, 'requests.jsonl')
  await writeFile(requestLog, '')
  const script = await fauxScript(root, { requestLog, responses })
  const sidecar = await startSidecar({ dirs: await sidecarDirs(), env: { COKO_FAUX_SCRIPT: script, ...env } })
  const cookie = await exchange(sidecar)
  const api = client(sidecar, cookie)
  const stream = await connect(sidecar, cookie)
  const workspace = (await api.post(API_ROUTES.workspaces, { path: workspaceDir })).body as { id: string }
  const waitServer = async (name: string, match: (s: McpServerInfo) => boolean): Promise<McpServerInfo> => {
    const deadline = Date.now() + 20_000
    for (;;) {
      const found = ((await api.get(`${mcpPaths.mcp}?workspaceId=${workspace.id}`)).body as McpResponse).servers.find((s) => s.name === name)
      if (found && match(found)) return found
      if (Date.now() > deadline) throw new Error(`server ${name} never matched; last: ${JSON.stringify(found)}`)
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }
  return { root, requestLog, sidecar, api, stream, workspace, waitServer }
}

describe('MCP 预设与图像结果', () => {
  it(
    'Playwright 预设：精确版本与 --isolated；原样保存后以预设参数启动（假 npx）；screenshot 的 image 块进入条目并原样交给模型',
    { timeout: 90_000 },
    async () => {
      const tmp = await tempDir()
      const log = join(tmp, 'npx.jsonl')
      const bin = await fakeNpx(join(tmp, 'bin'), { MCP_FIXTURE_FEATURES: 'screenshot', MCP_FIXTURE_LOG: log })
      const ctx = await setup(
        [
          { content: [{ type: 'toolCall', name: 'tool_search', id: 'load-screenshot', arguments: { query: 'select:mcp__playwright__screenshot' } }] },
          { content: [{ type: 'toolCall', name: 'mcp__playwright__screenshot', id: 's1', arguments: { url: 'https://example.test' } }] },
          { content: 'Looks fine.' },
        ],
        { PATH: `${bin}:${process.env.PATH ?? ''}` },
      )
      const { api, stream, workspace } = ctx

      const presets = await api.get(mcpPaths.presets)
      expect(presets.status).toBe(200)
      expect(presets.body as McpPresetsResponse).toEqual({
        presets: [
          { id: 'playwright', name: 'playwright', label: expect.any(String), config: { command: 'npx', args: ['-y', '@playwright/mcp@0.0.83', '--isolated'] } },
        ],
      })

      // 界面确认后经全局保存接口原样写入。
      const preset = (presets.body as McpPresetsResponse).presets[0]!
      expect((await api.put(mcpPaths.servers, { servers: { [preset.name]: preset.config }, expectedRevision: 0, workspaceId: workspace.id })).status).toBe(200)
      const saved = (await api.get(`${mcpPaths.mcp}?workspaceId=${workspace.id}`)).body as McpResponse
      expect(saved.global).toEqual({ playwright: { command: 'npx', args: ['-y', '@playwright/mcp@0.0.83', '--isolated'] } })
      const server = await ctx.waitServer('playwright', (s) => s.status === 'connected')
      expect(server).toMatchObject({ scope: 'global', transport: 'stdio' })
      expect(server.tools.map((t) => t.name)).toContain('mcp__playwright__screenshot')
      const [start] = (await readJsonl(log)).filter((e) => e.event === 'start')
      expect(start!.argv).toEqual(['-y', '@playwright/mcp@0.0.83', '--isolated'])

      // 图像结果：条目中为 image 块；下一次模型请求中原样（base64 与 mimeType）。
      const sessionId = (await api.post(API_ROUTES.sessions, { workspaceId: workspace.id })).body.id as string
      expect((await api.put(permissionPaths.sessionPermissionMode(sessionId), { mode: 'full-access' })).status).toBe(200)
      stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
      await stream.waitFor((m) => m.type === 'subscribed' && m.sessionId === sessionId)
      await api.post(apiPaths.sessionMessages(sessionId), { text: 'take a screenshot' })
      await stream.waitFor(isRunEnd(sessionId))
      // 读回库中的条目（不只看推送）。
      const entries = ((await api.get(apiPaths.session(sessionId))).body as { entries: { kind: string; payload: any }[] }).entries
      const result = entries.find((e) => e.kind === 'message' && e.payload.role === 'toolResult' && e.payload.toolCallId === 's1')!.payload
      expect(result.isError).toBe(false)
      expect(result.content).toEqual([
        { type: 'text', text: 'Screenshot of https://example.test' },
        { type: 'image', data: FIXTURE_SCREENSHOT_PNG, mimeType: 'image/png' },
      ])
      const requests = (await readFile(ctx.requestLog, 'utf8'))
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { role: string; toolCallId?: string; content: unknown }[])
      expect(requests).toHaveLength(3)
      expect(requests[2]!.find((m) => m.role === 'toolResult' && m.toolCallId === 's1')?.content).toEqual(result.content)
      expect(await ctx.sidecar.stop()).toEqual({ code: 0, signal: null })
    },
  )

  it('找不到 npx：failed，诊断 mcp-npx-missing 写明需要 Node.js', { timeout: 60_000 }, async () => {
    const empty = join(await tempDir(), 'empty-bin')
    await mkdir(empty)
    const ctx = await setup([], {})
    const { api, workspace } = ctx
    const preset = ((await api.get(mcpPaths.presets)).body as McpPresetsResponse).presets[0]!
    // 只有这个 Server 的 PATH 是空目录：npx 不可解析（与本机是否安装 Node.js 无关）。
    const config = { ...preset.config, env: { PATH: empty } }
    expect((await api.put(mcpPaths.servers, { servers: { playwright: config }, expectedRevision: 0, workspaceId: workspace.id })).status).toBe(200)
    const failed = await ctx.waitServer('playwright', (s) => s.status === 'failed')
    expect(failed.error).toMatch(/ENOENT/)
    const view = (await api.get(`${mcpPaths.mcp}?workspaceId=${workspace.id}`)).body as McpResponse
    expect(view.diagnostics.filter((d) => d.code === 'mcp-npx-missing')).toEqual([
      { source: 'mcp', code: 'mcp-npx-missing', message: expect.stringMatching(/"playwright".*Node\.js \(npx\)/) },
    ])
    expect(await ctx.sidecar.stop()).toEqual({ code: 0, signal: null })
  })
})

// 真实 Playwright MCP（经 npx 从网络下载）：只在 COKO_REAL_PLAYWRIGHT_MCP=1 时运行，默认跳过，报告为未验证（人工验证清单）。
describe('真实 Playwright MCP', () => {
  it.skipIf(process.env.COKO_REAL_PLAYWRIGHT_MCP !== '1')('预设经 npx 启动真实的 @playwright/mcp 并列出浏览器工具', { timeout: 180_000 }, async () => {
    const ctx = await setup([], { PATH: process.env.PATH ?? '' })
    const { api, workspace } = ctx
    const preset = ((await api.get(mcpPaths.presets)).body as McpPresetsResponse).presets[0]!
    expect((await api.put(mcpPaths.servers, { servers: { [preset.name]: preset.config }, expectedRevision: 0, workspaceId: workspace.id })).status).toBe(200)
    const server = await ctx.waitServer('playwright', (s) => s.status === 'connected' || s.status === 'failed')
    expect(server.status).toBe('connected')
    expect(server.tools.map((t) => t.name)).toEqual(expect.arrayContaining(['mcp__playwright__browser_navigate', 'mcp__playwright__browser_take_screenshot']))
    expect(await ctx.sidecar.stop()).toEqual({ code: 0, signal: null })
  })
})
