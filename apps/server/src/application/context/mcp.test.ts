// MCP 贡献每个 Run 的取值：配置（.mcp.json 与有效配置）只读取一次。
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { emptyPluginContributions, SESSION_ENTRY_PAYLOADS } from '@coko/agent'
import { createPayloadRegistry } from '@coko/session'
import { createMemoryStore } from '@coko/session/memory'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ConfigService } from '../config.ts'
import { McpManager, mcpContribution } from './mcp.ts'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'coko-mcp-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('MCP 贡献', () => {
  it('一个 Run 的工具取值中 .mcp.json 与有效配置各只读取一次', async () => {
    await writeFile(join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { local: { command: 'node', args: ['server.js'] } } }))
    const store = createMemoryStore({ payloads: createPayloadRegistry(SESSION_ENTRY_PAYLOADS) })
    const workspace = await store.sessions.registerWorkspace({ path: dir, name: 'ws' })
    const config = new ConfigService({ store })
    let effective = 0
    const reads: string[] = []
    const manager = new McpManager({
      store,
      config: {
        effective: (path) => {
          effective++
          return config.effective(path)
        },
      },
      secrets: { resolve: async () => undefined, redact: (t) => t, redactValues: (t) => t, onChange: () => () => {} },
      createTransport: () => {
        throw new Error('no server should start')
      },
      readFile: (path) => {
        reads.push(path)
        return readFile(path, 'utf8')
      },
    })
    const contribution = mcpContribution({ cokoHome: '', mcp: manager })
    const scope = { workspaceId: workspace.id, cwd: dir, config: await config.effective(dir), cokoHome: '', plugins: emptyPluginContributions() }
    // 项目 Server 未批准：不连接，没有工具。
    expect(await contribution.tools!(scope)).toEqual([])
    expect(reads).toEqual([join(dir, '.mcp.json')])
    expect(effective).toBe(1)
    await manager.close()
  })
})
