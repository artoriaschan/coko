// 命令贡献经 SessionService 的动作路径与登记来源（真实 Sidecar 上还没有内置命令与 Skill / MCP 来源，见 sidecar-commands.test.ts）。
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SESSION_ENTRY_PAYLOADS, createBuiltinToolRegistry, createLocalExecPort, createModelRegistry, InMemoryCredentialStore } from '@coko/agent'
import { createPayloadRegistry } from '@coko/session'
import { createMemoryStore } from '@coko/session/memory'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installFauxProvider } from '../../adapters/faux.ts'
import { ConfigService } from '../config.ts'
import { AppError } from '../errors.ts'
import { SessionHub } from '../hub.ts'
import { SessionService } from '../sessions.ts'
import { commandsContribution } from './commands.ts'
import { createContextAssembly, type ContextAction, type ContextContribution } from './index.ts'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'coko-commands-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function setup(options: { slow?: boolean } = {}) {
  const act = vi.fn<ContextAction>(async () => ({ runId: 'action-run' }))
  const expand = vi.fn<(args: string) => Promise<string>>(async (args) => {
    if (args === '') throw new AppError('bad-request', 'Missing required argument: file')
    return `<skill name="pdf">${args}</skill>`
  })
  const fake: ContextContribution = {
    name: 'fake',
    actions: { act },
    commandSources: [
      {
        source: 'skill',
        list: async () => [{ name: 'pdf', description: 'Read PDFs', source: 'skill', path: '/skills/pdf/SKILL.md', expand }, { name: 'bogus' }],
      },
      { source: 'mcp', list: async () => Promise.reject(new Error('server down')) },
    ],
  }
  const contributions: ContextContribution[] = [
    commandsContribution({
      cokoHome: '',
      builtins: [
        { name: 'act', description: 'Run the action', argumentHint: '[note]', action: 'act' },
        { name: 'ghost', description: 'Not wired', action: 'missing' },
      ],
      siblings: () => contributions,
    }),
    fake,
  ]
  const context = createContextAssembly({ contributions, config: new ConfigService(), cokoHome: '' })
  // 慢速 faux：Run 在测试期间保持进行中。
  const script = join(dir, 'faux.json')
  await writeFile(
    script,
    JSON.stringify(options.slow ? { tokensPerSecond: 20, responses: [{ content: 'x'.repeat(400) }] } : { responses: [{ content: 'ok' }] }),
  )
  const registry = createModelRegistry({ credentials: new InMemoryCredentialStore() })
  const fallbackModel = await installFauxProvider(registry, script)
  const store = createMemoryStore({ payloads: createPayloadRegistry(SESSION_ENTRY_PAYLOADS) })
  const workspace = await store.sessions.registerWorkspace({ path: dir, name: 'ws' })
  const runs: Promise<unknown>[] = []
  const abort: (() => void)[] = []
  const service = new SessionService({
    store,
    registry,
    hub: new SessionHub(),
    fallbackModel,
    runs: {
      launch: (_key, run, stop) => {
        runs.push(run)
        abort.push(stop)
      },
    },
    tools: (cwd) => createBuiltinToolRegistry({ cwd, exec: createLocalExecPort() }),
    context,
  })
  const session = await service.create({ workspaceId: workspace.id })
  const finish = async () => {
    for (const stop of abort) stop()
    await Promise.all(runs)
  }
  return { service, store, session, act, expand, context, workspace, finish }
}

describe('命令贡献：内置命令的动作与登记来源', () => {
  it('内置命令展开为动作并调用之；Run 进行中 409 run-in-progress；steer 中 400 bad-request', async () => {
    const { service, session, act, expand, finish } = await setup({ slow: true })
    expect(await service.submit(session.id, '/act now please')).toEqual({ runId: 'action-run' })
    expect(act).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ sessionId: session.id, args: 'now please' }))

    await service.submit(session.id, 'start a slow run')
    await expect(service.submit(session.id, '/act')).rejects.toMatchObject({ code: 'run-in-progress' })
    await expect(service.steer(session.id, '/act')).rejects.toMatchObject({ code: 'bad-request' })
    expect(act).toHaveBeenCalledOnce()
    // Run 进行中先 409，不展开输入：来源的 expand（例如 MCP prompts/get）不被调用。
    await expect(service.submit(session.id, '/pdf report.pdf')).rejects.toMatchObject({ code: 'run-in-progress' })
    await expect(service.submit(session.id, 'plain text')).rejects.toMatchObject({ code: 'run-in-progress' })
    expect(expand).not.toHaveBeenCalled()
    await finish()
  })

  it('Skill 来源的命令由来源展开并带 command 条目；来源抛出的 AppError 使提交失败；未接入动作的内置命令与不合格的条目不进目录', async () => {
    const { service, store, session, expand, context, workspace, finish } = await setup()
    await expect(service.submit(session.id, '/pdf')).rejects.toMatchObject({ code: 'bad-request', message: 'Missing required argument: file' })
    await service.submit(session.id, '/pdf report.pdf')
    expect(expand).toHaveBeenLastCalledWith('report.pdf', expect.objectContaining({ workspaceId: workspace.id }))
    await finish()
    const entries = await store.sessions.listEntries(session.id)
    const kinds = entries.map((e) => (e.kind === 'message' ? (e.payload as { role: string }).role : e.kind))
    expect(kinds.slice(0, 4)).toEqual(['permission_mode', 'run_start', 'command', 'user'])
    expect(entries[2]!.payload).toEqual({ name: 'pdf', args: 'report.pdf', source: 'skill' })
    expect(JSON.stringify(entries[3]!.payload)).toContain('<skill name=\\"pdf\\">report.pdf</skill>')

    const commands = context.contributions.find((c) => c.name === 'commands') as ReturnType<typeof commandsContribution>
    const listed = await commands.list(await context.scope({ workspaceId: workspace.id, cwd: workspace.path }))
    expect(listed.commands).toEqual([
      { name: 'act', description: 'Run the action', argumentHint: '[note]', source: 'builtin', enabled: true },
      { name: 'pdf', description: 'Read PDFs', source: 'skill', path: '/skills/pdf/SKILL.md', enabled: true },
    ])
    expect(listed.diagnostics).toEqual([])
  })
})
