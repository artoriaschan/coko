// worktree 会话的作用域（ADR 0016）：启动恢复的探测、项目的 deny / ask 规则与 MCP 连接都按会话的工作目录（SessionCwd），不按 Workspace 目录。
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createModelRegistry, InMemoryCredentialStore, SESSION_ENTRY_PAYLOADS } from '@coko/agent'
import { createPayloadRegistry } from '@coko/session'
import { createMemoryStore } from '@coko/session/memory'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ConfigService } from './config.ts'
import { McpManager } from './context/mcp.ts'
import { SessionHub } from './hub.ts'
import { PermissionService } from './permissions.ts'
import { SessionService } from './sessions.ts'

let base: string
let workspaceDir: string
let worktreeDir: string
beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'coko-cwd-scope-'))
  workspaceDir = join(base, 'ws')
  worktreeDir = join(base, 'wt')
  await mkdir(join(workspaceDir, '.coko'), { recursive: true })
  await mkdir(join(worktreeDir, '.coko'), { recursive: true })
})
afterEach(async () => {
  await rm(base, { recursive: true, force: true })
})

const store = () => createMemoryStore({ payloads: createPayloadRegistry(SESSION_ENTRY_PAYLOADS) })

describe('会话创建的唯一入口', () => {
  it('显式 cwd 与 directory 在 DTO 与实际运行目录中保留；旧式会话回退到 Workspace', async () => {
    const s = store()
    const workspace = await s.sessions.registerWorkspace({ path: workspaceDir })
    const service = new SessionService({
      store: s,
      registry: createModelRegistry({ credentials: new InMemoryCredentialStore() }),
      hub: new SessionHub(),
      runs: { launch: () => undefined },
    })
    const legacy = await service.create({ workspaceId: workspace.id })
    expect(legacy).toMatchObject({ cwd: workspaceDir, directory: null })
    const allocated = await service.createRecord({ workspaceId: workspace.id, directory: workspaceDir, cwd: join(workspaceDir, 'work') })
    expect(await service.toDto(allocated)).toMatchObject({ cwd: join(workspaceDir, 'work'), directory: workspaceDir })
    expect((await service.runs.cwd(allocated)).cwd).toBe(join(workspaceDir, 'work'))
  })

  it('绑定已移除的 worktree 时 409 worktree-removed，不写入；active 的照常创建', async () => {
    const s = store()
    const workspace = await s.sessions.registerWorkspace({ path: workspaceDir })
    const wt = (name: string) =>
      s.worktrees.create({
        workspaceId: workspace.id,
        name,
        path: join(base, name),
        branch: `coko/${name}`,
        baseCommit: 'b',
        repoRoot: base,
        createdBy: 'user',
      })
    const removed = await wt('gone')
    await s.worktrees.markRemoved(removed.id)
    const active = await wt('live')
    const service = new SessionService({
      store: s,
      registry: createModelRegistry({ credentials: new InMemoryCredentialStore() }),
      hub: new SessionHub(),
      runs: { launch: () => undefined },
    })
    await expect(service.create({ workspaceId: workspace.id, worktreeId: removed.id })).rejects.toMatchObject({ code: 'worktree-removed' })
    await expect(service.createRecord({ workspaceId: workspace.id, worktreeId: removed.id })).rejects.toMatchObject({ code: 'worktree-removed' })
    expect(await s.sessions.listSessions({ workspaceId: workspace.id })).toEqual([])
    expect((await service.create({ workspaceId: workspace.id, worktreeId: active.id })).worktree).toMatchObject({ id: active.id })
  })
})

describe('worktree 会话的作用域', () => {
  it('启动恢复对照会话的工作目录探测已执行的 write（worktree 中已写入 → applied，不对照主 checkout）', async () => {
    const s = store()
    const workspace = await s.sessions.registerWorkspace({ path: workspaceDir })
    const session = await s.sessions.createSession({ workspaceId: workspace.id, model: null })
    await writeFile(join(worktreeDir, 'w.txt'), 'W')
    await s.sessions.appendEntries(session.id, [
      { kind: 'run_start', runId: 'r1', payload: { trigger: 'submit' } },
      {
        kind: 'message',
        runId: 'r1',
        payload: {
          role: 'assistant',
          content: [{ type: 'toolCall', id: 'c1', name: 'write', arguments: { path: 'w.txt', content: 'W' } }],
          stopReason: 'toolUse',
          timestamp: 1,
        } as never,
      },
      { kind: 'tool_exec', runId: 'r1', payload: { toolCallId: 'c1', toolName: 'write', idempotencyKey: `${session.id}:c1` } },
    ])
    const service = new SessionService({
      store: s,
      registry: createModelRegistry({ credentials: new InMemoryCredentialStore() }),
      hub: new SessionHub(),
      runs: { launch: () => undefined },
      cwd: { resolve: async () => worktreeDir },
    })
    await service.recover({ listUnfinishedRuns: async () => [{ sessionId: session.id, runId: 'r1' }], listLatestEntries: async () => [] })
    const result = (await s.sessions.listEntries(session.id)).find((e) => e.kind === 'message' && (e.payload as { role: string }).role === 'toolResult')
    expect(result?.payload).toMatchObject({ toolCallId: 'c1', isError: false })
  })

  it('项目的 deny 规则从会话的工作目录读取（worktree 中的 .coko/settings.json）', async () => {
    const s = store()
    const workspace = await s.sessions.registerWorkspace({ path: workspaceDir })
    await writeFile(join(worktreeDir, '.coko', 'settings.json'), JSON.stringify({ permissions: { deny: ['Bash(rm *)'] } }))
    const config = new ConfigService({ store: s })
    const permissions = new PermissionService(s, () => ['bash', 'read', 'write', 'edit'])
    permissions.useProjectRules(config)
    await permissions.load()
    await permissions.loadWorkspace(workspace.id)
    await config.effective(worktreeDir)
    expect(permissions.rulesFor(workspace.id)).toEqual([])
    expect(permissions.rulesFor(workspace.id, worktreeDir)).toEqual([expect.objectContaining({ behavior: 'deny', content: 'rm *' })])
  })

  it('MCP 连接按 (Workspace, 工作目录) 分开：worktree 会话不复用主 checkout 的 stdio Server', async () => {
    const s = store()
    const workspace = await s.sessions.registerWorkspace({ path: workspaceDir })
    await s.settings.set('mcp.servers', { local: { command: 'node', args: ['server.js'] } }, 0)
    const started: string[] = []
    const manager = new McpManager({
      store: s,
      config: new ConfigService({ store: s }),
      secrets: { resolve: async () => undefined, redact: (t) => t, redactValues: (t) => t, onChange: () => () => {} },
      createTransport: (_config, { cwd }) => {
        started.push(cwd)
        throw new Error('no real server')
      },
      reconnectDelaysMs: [],
    })
    await manager.runTools({ workspaceId: workspace.id, cwd: workspaceDir })
    await manager.runTools({ workspaceId: workspace.id, cwd: worktreeDir })
    expect(started).toEqual([workspaceDir, worktreeDir])
    await manager.close()
  })
})
