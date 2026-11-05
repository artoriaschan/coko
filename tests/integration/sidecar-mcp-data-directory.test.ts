import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { API_ROUTES, apiPaths, mcpPaths, type McpResponse } from '@coko/protocol'
import { startHttpFixture, stdioServerConfig } from '../fixtures/mcp/index.ts'
import { client, exchange, sidecarDirs, startSidecar, tempDir } from './sidecar-harness.ts'

it('stdio MCP 获得稳定的数据目录和可信环境变量，缺省 cwd 不再污染 Workspace', async () => {
  const root = await tempDir()
  const workspacePath = join(root, 'workspace')
  await mkdir(workspacePath)
  const dirs = await sidecarDirs()
  const sidecar = await startSidecar({ dirs, env: { COKO_MCP_DATA_DIR: '/untrusted-parent-value' } })
  const api = client(sidecar, await exchange(sidecar))
  const workspace = (await api.post(API_ROUTES.workspaces, { path: workspacePath })).body as { id: string }
  const log = join(root, 'stdio.jsonl')
  expect(
    (
      await api.put(mcpPaths.servers, {
        servers: { local: stdioServerConfig({ MCP_FIXTURE_LOG: log, COKO_MCP_DATA_DIR: '/untrusted-config-value' }) },
        expectedRevision: 0,
        workspaceId: workspace.id,
      })
    ).status,
  ).toBe(200)
  await expect
    .poll(
      async () => {
        const response = (await api.get(`${mcpPaths.mcp}?workspaceId=${workspace.id}`)).body as McpResponse
        return response.servers.find((server) => server.name === 'local')?.status
      },
      { timeout: 10_000 },
    )
    .toBe('connected')
  const start = JSON.parse((await readFile(log, 'utf8')).split('\n')[0]!) as { cwd: string; dataDir?: string }
  const dataDir = await realpath(join(dirs.dataDir, 'mcp', 'local'))
  expect(start).toMatchObject({ cwd: dataDir, dataDir })
  const state = join(dataDir, 'state.json')
  await writeFile(state, 'retained server state')
  const session = (await api.post(API_ROUTES.sessions, { workspaceId: workspace.id })).body as { id: string }
  expect((await api.delete(apiPaths.session(session.id))).status).toBe(200)
  expect(await readFile(state, 'utf8')).toBe('retained server state')
  expect((await api.put(mcpPaths.servers, { servers: {}, expectedRevision: 1, workspaceId: workspace.id })).status).toBe(200)
  expect(await readFile(state, 'utf8')).toBe('retained server state')
  await sidecar.stop()

  const restarted = await startSidecar({ dirs })
  const after = client(restarted, await exchange(restarted))
  expect(
    (
      await after.put(mcpPaths.servers, {
        servers: { local: stdioServerConfig({ MCP_FIXTURE_LOG: log }) },
        expectedRevision: 2,
        workspaceId: workspace.id,
      })
    ).status,
  ).toBe(200)
  await expect
    .poll(
      async () => {
        const response = (await after.get(`${mcpPaths.mcp}?workspaceId=${workspace.id}`)).body as McpResponse
        return response.servers.find((server) => server.name === 'local')?.status
      },
      { timeout: 10_000 },
    )
    .toBe('connected')
  expect(await readFile(state, 'utf8')).toBe('retained server state')
  const starts = (await readFile(log, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as { event: string; cwd?: string; dataDir?: string })
    .filter((record) => record.event === 'start')
  expect(starts).toHaveLength(2)
  expect(starts[1]).toMatchObject({ cwd: dataDir, dataDir })
})

it('显式 cwd 保持 Workspace 相对和绝对路径语义，HTTP Server 无需配置 cwd', async () => {
  const root = await tempDir()
  const workspacePath = join(root, 'workspace')
  const relativeCwd = join(workspacePath, 'relative-server')
  const absoluteCwd = join(root, 'absolute-server')
  await mkdir(relativeCwd, { recursive: true })
  await mkdir(absoluteCwd)
  const dirs = await sidecarDirs()
  const sidecar = await startSidecar({ dirs })
  const api = client(sidecar, await exchange(sidecar))
  const workspace = (await api.post(API_ROUTES.workspaces, { path: workspacePath })).body as { id: string }
  const relativeLog = join(root, 'relative.jsonl')
  const absoluteLog = join(root, 'absolute.jsonl')
  const http = await startHttpFixture({ name: 'remote' })
  onTestFinished(() => http.close())
  expect(
    (
      await api.put(mcpPaths.servers, {
        servers: {
          relative: stdioServerConfig({ MCP_FIXTURE_LOG: relativeLog }, { cwd: 'relative-server' }),
          absolute: stdioServerConfig({ MCP_FIXTURE_LOG: absoluteLog }, { cwd: absoluteCwd }),
          remote: { url: http.url },
        },
        expectedRevision: 0,
        workspaceId: workspace.id,
      })
    ).status,
  ).toBe(200)
  await expect
    .poll(
      async () => {
        const response = (await api.get(`${mcpPaths.mcp}?workspaceId=${workspace.id}`)).body as McpResponse
        return response.servers.map((server) => server.status)
      },
      { timeout: 10_000 },
    )
    .toEqual(['connected', 'connected', 'connected'])
  const relativeStart = JSON.parse((await readFile(relativeLog, 'utf8')).split('\n')[0]!) as { cwd: string; dataDir: string }
  const absoluteStart = JSON.parse((await readFile(absoluteLog, 'utf8')).split('\n')[0]!) as { cwd: string; dataDir: string }
  expect(relativeStart).toMatchObject({ cwd: await realpath(relativeCwd), dataDir: await realpath(join(dirs.dataDir, 'mcp', 'relative')) })
  expect(absoluteStart).toMatchObject({ cwd: await realpath(absoluteCwd), dataDir: await realpath(join(dirs.dataDir, 'mcp', 'absolute')) })
  // 来自 HTTP 配置边界的非法名称不能改变目录层级。
  expect((await api.put(mcpPaths.servers, { servers: { '../escape': stdioServerConfig() }, expectedRevision: 1 })).status).toBe(400)
})
