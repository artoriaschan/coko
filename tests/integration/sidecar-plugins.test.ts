// 插件（ADR 0017）：真实 Sidecar（faux）+ 仓库内夹具。目录来源安装后待批准、批准前不加载任何资源（Skill 不在索引、Hook 不运行、MCP / 语言服务器
// 进程不启动：夹具的记录文件不存在）；批准后各类资源以 <plugin>: 或 plugin-<plugin>- 命名可用，用户的同名 Skill 与命令照常可用；禁用、卸载与
// plugins.enabled: false；git 来源（file:// 夹具仓库）的 commit、#tag 与更新后重新批准。
import { existsSync } from 'node:fs'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  API_ROUTES,
  apiPaths,
  commandPaths,
  configPaths,
  mcpPaths,
  permissionPaths,
  pluginPaths,
  skillPaths,
  type McpResponse,
  type PluginInfo,
  type SessionEntryRecord,
} from '@coko/protocol'
import { loadPlugin } from '@coko/agent'
import { createGitWorkspace } from '../fixtures/git/index.ts'
import { preToolUseHooks, writePlugin } from '../fixtures/plugins/index.ts'
import {
  client,
  connect,
  exchange,
  fauxScript,
  hookCommand,
  lspFixturePath,
  pollUntil,
  preparePluginFixture,
  sidecarDirs,
  startSidecar,
  tempDir,
  waitProcessesGone,
  writeCokoHome,
  type SidecarDirs,
} from './sidecar-harness.ts'

const call = (id: string, name: string, args: Record<string, unknown>) => ({ type: 'toolCall', name, id, arguments: args })
const bash = (id: string, command: string) => call(id, 'bash', { command })

async function boot(responses: unknown[], options: { env?: Record<string, string>; dirs?: SidecarDirs } = {}) {
  const root = await tempDir()
  const dirs = options.dirs ?? (await sidecarDirs())
  const requestLog = join(root, '.requests.jsonl')
  await writeFile(requestLog, '')
  const script = await fauxScript(root, { requestLog, responses }, '.faux.json')
  const sidecar = await startSidecar({ dirs, env: { COKO_FAUX_SCRIPT: script, ...options.env } })
  const cookie = await exchange(sidecar)
  const api = client(sidecar, cookie)
  const stream = await connect(sidecar, cookie)
  const workspaceId = (await api.post(API_ROUTES.workspaces, { path: root })).body.id as string
  const open = async () => {
    const sessionId = (await api.post(API_ROUTES.sessions, { workspaceId })).body.id as string
    expect((await api.put(permissionPaths.sessionPermissionMode(sessionId), { mode: 'full-access' })).status).toBe(200)
    stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
    await stream.waitFor((m) => m.type === 'subscribed' && m.sessionId === sessionId)
    return sessionId
  }
  const runEnds = (sessionId: string, n: number) => stream.waitFor(() => stream.entries(sessionId).filter((e) => e.kind === 'run_end').length >= n, 30_000)
  const send = async (sessionId: string, text: string) => expect((await api.post(apiPaths.sessionMessages(sessionId), { text })).status).toBe(202)
  const requests = async () => (await readFile(requestLog, 'utf8')).split('\n').filter(Boolean)
  const commands = async () =>
    ((await api.get(commandPaths.commands + '?workspaceId=' + workspaceId)).body as { commands: { name: string }[] }).commands.map((c) => c.name)
  const mcp = async () => (await api.get(mcpPaths.mcp + '?workspaceId=' + workspaceId)).body as McpResponse
  const install = async (source: unknown) => api.post(pluginPaths.plugins, { source })
  const approve = async (info: PluginInfo) => api.post(pluginPaths.approve(info.name), { digest: info.digest })
  const plugins = async () => (await api.get(pluginPaths.plugins)).body as PluginInfo[]
  const mcpRows = () => {
    const path = join(dirs.dataDir, 'coko.db')
    if (!existsSync(path)) return []
    const db = new DatabaseSync(path, { readOnly: true })
    try {
      return db.prepare("SELECT pid FROM host_processes WHERE kind = 'mcp'").all() as { pid: number }[]
    } finally {
      db.close()
    }
  }
  return { root, dirs, sidecar, api, stream, workspaceId, open, runEnds, send, requests, commands, mcp, install, approve, plugins, mcpRows }
}

const userText = (entries: SessionEntryRecord[], n: number) => {
  const users = entries.filter((e) => e.kind === 'message' && (e.payload as { role: string }).role === 'user')
  const content = (users[n]!.payload as { content: unknown }).content
  return typeof content === 'string' ? content : (content as { text?: string }[]).map((b) => b.text ?? '').join('')
}

/** sample 夹具，语言服务器另带 --record（进程启动时写记录文件）。 */
async function sampleWithLspRecord() {
  const plugin = await preparePluginFixture()
  const lspRecord = join(dirname(plugin.root), 'lsp.jsonl')
  await writeFile(
    join(plugin.root, '.lsp.json'),
    JSON.stringify({
      lspServers: { ts: { command: process.execPath, args: [lspFixturePath, '--record', lspRecord], extensionToLanguage: { '.ts': 'typescript' } } },
    }),
  )
  return { ...plugin, lspRecord }
}

describe('插件：目录来源', { timeout: 120_000 }, () => {
  it('安装 201 待批准：任何资源都不加载；批准后 Skill、命令、子代理、Hook 与 MCP 带插件名可用，用户的同名 Skill 与命令照常可用', async () => {
    const plugin = await sampleWithLspRecord()
    const dirs = await sidecarDirs()
    await writeCokoHome(dirs, 'skills/greet/SKILL.md', '---\nname: greet\ndescription: The user greet skill\n---\nUSER-GREET-BODY\n')
    await writeCokoHome(dirs, 'commands/hello.md', 'USER HELLO $ARGUMENTS\n')
    const h = await boot(
      [
        { content: [bash('b0', 'echo before')] },
        { content: 'before done' },
        { content: 'hello done' },
        { content: 'user hello done' },
        { content: [bash('b1', 'echo plugin-hook'), call('m1', 'mcp__plugin-sample-echo__echo', { text: 'via plugin' })] },
        { content: 'tools done' },
        { content: [call('a1', 'agent', { description: 'review', prompt: 'CHILD-R review it', subagent_type: 'sample:reviewer' })] },
        { match: 'CHILD-R', content: 'reviewed' },
        { content: 'dispatched' },
      ],
      { dirs },
    )
    const installed = await h.install({ kind: 'dir', path: plugin.root })
    expect(installed.status).toBe(201)
    const info = installed.body as PluginInfo
    expect(info).toMatchObject({
      name: 'sample',
      status: 'needs-approval',
      source: { kind: 'dir', location: plugin.root },
      contributions: { skills: ['sample:greet'], commands: ['sample:hello'], agents: ['sample:reviewer'] },
      executables: {
        hooks: [{ event: 'PreToolUse', matcher: 'Bash', command: expect.stringContaining('hook.mjs') }],
        mcpServers: [{ name: 'plugin-sample-echo', command: process.execPath, envKeys: ['MCP_FIXTURE_LOG', 'MCP_FIXTURE_NAME'] }],
        lspServers: [{ name: 'sample:ts', command: process.execPath, extensions: ['.ts'] }],
      },
    })
    expect(existsSync(join(dirs.cokoHome, 'plugins', 'sample', '.coko-plugin', 'plugin.json'))).toBe(true)

    // 批准前：命令目录、MCP 视图、Run 的请求与 Hook 都没有插件的资源。
    expect(await h.commands()).not.toContain('sample:hello')
    expect((await h.mcp()).servers).toEqual([])
    const sessionId = await h.open()
    await h.send(sessionId, 'go')
    await h.runEnds(sessionId, 1)
    expect((await h.requests())[0]).not.toContain('sample:greet')
    expect(h.stream.entries(sessionId).some((e) => e.kind === 'hook_run')).toBe(false)
    for (const file of [plugin.hookRecord, plugin.mcpLog, plugin.lspRecord]) expect(existsSync(file)).toBe(false)

    const approved = await h.approve(info)
    expect([approved.status, (approved.body as PluginInfo).status]).toEqual([200, 'enabled'])

    // 命令：插件的 /sample:hello 与用户自己的 /hello 都可用。
    const names = await h.commands()
    expect(names).toEqual(expect.arrayContaining(['sample:hello', 'hello']))
    await h.send(sessionId, '/sample:hello World')
    await h.runEnds(sessionId, 2)
    expect(userText(h.stream.entries(sessionId), 1)).toBe('Hello from the sample plugin, World.')
    await h.send(sessionId, '/hello Me')
    await h.runEnds(sessionId, 3)
    expect(userText(h.stream.entries(sessionId), 2)).toMatch(/^USER HELLO Me\s*$/)
    // Skill：两者都在 <available_skills> 与 /api/skills 中，用户的保持原名。
    const second = (await h.requests())[2]!
    expect(second).toContain('sample:greet')
    expect(second).toContain('The user greet skill')
    const skills = ((await h.api.get(skillPaths.skills + '?workspaceId=' + h.workspaceId)).body as { skills: { name: string; description: string }[] }).skills
    expect(skills.map((s) => [s.name, s.description])).toEqual(
      expect.arrayContaining([
        ['greet', 'The user greet skill'],
        ['sample:greet', 'Greet the user by name (sample plugin skill)'],
      ]),
    )

    // Hook 与 MCP（接收侧：Hook 夹具记录的 stdin、MCP 夹具日志）。
    await h.send(sessionId, 'PLUGIN-GO')
    await h.runEnds(sessionId, 4)
    const stdin = (await readFile(plugin.hookRecord, 'utf8')).split('\n').filter(Boolean)
    expect(stdin.map((line) => (JSON.parse(line) as { tool_input: { command: string } }).tool_input.command)).toEqual(['echo plugin-hook'])
    expect(
      h.stream
        .entries(sessionId)
        .filter((e) => e.kind === 'hook_run')
        .map((e) => e.payload),
    ).toEqual([expect.objectContaining({ event: 'PreToolUse', source: 'plugin', plugin: 'sample', outcome: 'allowed' })])
    const mcpResult = h.stream.entries(sessionId).find((e) => e.kind === 'message' && (e.payload as { toolCallId?: string }).toolCallId === 'm1')
    expect(mcpResult?.payload).toMatchObject({ isError: false })
    expect(await readFile(plugin.mcpLog, 'utf8')).toContain('"event":"start"')
    expect((await h.mcp()).servers.find((s) => s.name === 'plugin-sample-echo')).toMatchObject({ scope: 'global', status: 'connected' })

    // 子代理定义：sample:reviewer 可派发。
    await h.send(sessionId, 'DISPATCH')
    await h.runEnds(sessionId, 5)
    expect(h.stream.entries(sessionId).find((e) => e.kind === 'agent_start')?.payload).toMatchObject({ agentType: 'sample:reviewer' })
    expect(await h.sidecar.stop()).toEqual({ code: 0, signal: null })
  })

  it('整体移动 COKO_HOME 后已批准的插件保持启用、资源与进程可用；更新声明仍要求批准且能在新根卸载', async () => {
    const plugin = await preparePluginFixture()
    await writeFile(
      join(plugin.root, 'hooks', 'hooks.json'),
      JSON.stringify(preToolUseHooks(hookCommand('--record', '${COKO_PLUGIN_ROOT}/hook-stdin.jsonl'), 'Bash')),
    )
    const h = await boot([])
    const installed = await h.install({ kind: 'dir', path: plugin.root })
    expect(installed.status).toBe(201)
    const info = installed.body as PluginInfo
    expect((await h.approve(info)).status).toBe(200)
    expect(await h.sidecar.stop()).toEqual({ code: 0, signal: null })

    const cokoHome = join(await tempDir('coko-relocated-'), 'home')
    await rename(h.dirs.cokoHome, cokoHome)
    const dataDir = join(cokoHome, 'data')
    const moved = await boot(
      [
        { content: [bash('relocated-bash', 'echo relocated'), call('relocated-mcp', 'mcp__plugin-sample-echo__echo', { text: 'relocated' })] },
        { content: 'done' },
      ],
      { dirs: { cokoHome, dataDir, logDir: join(dataDir, 'logs') } },
    )
    expect(await moved.plugins()).toEqual([expect.objectContaining({ name: 'sample', status: 'enabled', digest: info.digest, approvedDigest: info.digest })])
    expect(await moved.commands()).toContain('sample:hello')
    const sessionId = await moved.open()
    await moved.send(sessionId, 'run relocated plugin')
    await moved.runEnds(sessionId, 1)
    const entries = moved.stream.entries(sessionId)
    expect(
      entries.find((entry) => entry.kind === 'message' && (entry.payload as { toolCallId?: string }).toolCallId === 'relocated-mcp')?.payload,
    ).toMatchObject({ isError: false })
    expect(await readFile(join(cokoHome, 'plugins', 'sample', 'hook-stdin.jsonl'), 'utf8')).toContain('echo relocated')
    expect(await readFile(plugin.mcpLog, 'utf8')).toContain('"event":"start"')

    await writeFile(join(plugin.root, 'hooks', 'hooks.json'), JSON.stringify(preToolUseHooks('printf changed', 'Bash')))
    const updated = await moved.api.post(pluginPaths.update('sample'))
    expect([updated.status, (updated.body as PluginInfo).status]).toEqual([200, 'needs-approval'])
    expect((updated.body as PluginInfo).digest).not.toBe(info.digest)
    expect((await moved.api.delete(pluginPaths.plugin('sample'))).status).toBe(204)
    expect(existsSync(join(cokoHome, 'plugins', 'sample'))).toBe(false)
    expect(await moved.plugins()).toEqual([])
    expect(await moved.sidecar.stop()).toEqual({ code: 0, signal: null })
  })

  it('旧绝对安装记录与已批准摘要继续可读；缺失目录正常报错，越界绝对记录允许读取但更新与卸载被拒', async () => {
    const plugin = await preparePluginFixture()
    const h = await boot([])
    expect((await h.install({ kind: 'dir', path: plugin.root })).status).toBe(201)
    expect(await h.sidecar.stop()).toEqual({ code: 0, signal: null })
    const installedPath = join(h.dirs.cokoHome, 'plugins', 'sample')
    const legacy = await loadPlugin(installedPath)
    const seed = (path: string, digest: string) => {
      const db = new DatabaseSync(join(h.dirs.dataDir, 'coko.db'))
      try {
        db.prepare('UPDATE plugins SET path = ?, digest = ?, approved_digest = ?, enabled = 1 WHERE name = ?').run(path, digest, digest, 'sample')
      } finally {
        db.close()
      }
    }
    seed(installedPath, legacy.digest)
    const compatible = await boot([], { dirs: h.dirs })
    expect(await compatible.plugins()).toEqual([expect.objectContaining({ name: 'sample', status: 'enabled', digest: legacy.digest })])
    expect(await compatible.commands()).toContain('sample:hello')
    const updated = await compatible.api.post(pluginPaths.update('sample'))
    expect([updated.status, (updated.body as PluginInfo).status]).toEqual([200, 'enabled'])
    expect(await compatible.sidecar.stop()).toEqual({ code: 0, signal: null })

    seed(join(h.dirs.cokoHome, 'missing'), legacy.digest)
    const missing = await boot([], { dirs: h.dirs })
    expect(await missing.plugins()).toEqual([
      expect.objectContaining({ status: 'invalid', diagnostics: [expect.objectContaining({ code: 'invalid-manifest' })] }),
    ])
    expect(await missing.sidecar.stop()).toEqual({ code: 0, signal: null })

    const outside = await loadPlugin(plugin.root)
    seed(plugin.root, outside.digest)
    const external = await boot([], { dirs: h.dirs })
    expect(await external.plugins()).toEqual([expect.objectContaining({ name: 'sample', status: 'enabled' })])
    expect((await external.api.post(pluginPaths.update('sample'))).status).toBe(403)
    expect((await external.api.delete(pluginPaths.plugin('sample'))).status).toBe(403)
    expect(await readFile(join(plugin.root, '.coko-plugin', 'plugin.json'), 'utf8')).toContain('sample')
    expect(await external.sidecar.stop()).toEqual({ code: 0, signal: null })
  })

  it('禁用后下一个 Run 不再加载且 MCP 进程退出；卸载 204、目录与记录不存在、进程退出；plugins.enabled: false 时全部不加载', async () => {
    const plugin = await preparePluginFixture()
    const h = await boot([{ content: 'one' }, { content: 'two' }])
    const connected = async () => {
      await h.commands()
      await pollUntil(async () => ((await h.mcp()).servers.some((s) => s.name === 'plugin-sample-echo' && s.status === 'connected') ? true : undefined), {
        timeoutMs: 30_000,
      })
      return (await pollUntil(() => (h.mcpRows().length === 1 ? h.mcpRows() : undefined), { timeoutMs: 10_000 }))!
    }
    const gone = (pids: number[]) => pollUntil(() => (h.mcpRows().length === 0 ? true : undefined), { timeoutMs: 10_000 }).then(() => waitProcessesGone(pids))
    await h.approve((await h.install({ kind: 'dir', path: plugin.root })).body as PluginInfo)
    const first = await connected()

    const disabled = await h.api.patch(pluginPaths.plugin('sample'), { enabled: false })
    expect([disabled.status, (disabled.body as PluginInfo).status]).toEqual([200, 'disabled'])
    await gone(first.map((r) => r.pid))
    expect(await h.commands()).not.toContain('sample:hello')
    const sessionId = await h.open()
    await h.send(sessionId, 'after disable')
    await h.runEnds(sessionId, 1)
    expect((await h.requests())[0]).not.toContain('sample:greet')
    expect(h.mcpRows()).toEqual([])

    expect((await h.api.patch(pluginPaths.plugin('sample'), { enabled: true })).status).toBe(200)
    const second = await connected()
    const removed = await h.api.delete(pluginPaths.plugin('sample'))
    expect(removed.status).toBe(204)
    await gone(second.map((r) => r.pid))
    expect(existsSync(join(h.dirs.cokoHome, 'plugins', 'sample'))).toBe(false)
    expect(await h.plugins()).toEqual([])
    expect((await h.api.delete(pluginPaths.plugin('sample'))).status).toBe(404)

    // plugins.enabled: false（全局）：已批准的插件也不加载。
    await h.approve((await h.install({ kind: 'dir', path: plugin.root })).body as PluginInfo)
    const third = await connected()
    const config = (await h.api.get(configPaths.config)).body as { globalRevision: number }
    expect((await h.api.put(configPaths.config, { values: { plugins: { enabled: false } }, expectedRevision: config.globalRevision })).status).toBe(200)
    expect(await h.commands()).not.toContain('sample:hello')
    expect((await h.mcp()).servers).toEqual([])
    await gone(third.map((r) => r.pid))
    await h.send(sessionId, 'plugins off')
    await h.runEnds(sessionId, 2)
    expect((await h.requests())[1]).not.toContain('sample:greet')
    expect(await h.sidecar.stop()).toEqual({ code: 0, signal: null })
  })
})

describe('插件：git 来源（file:// 夹具仓库）', { timeout: 120_000 }, () => {
  it('安装记录 commit；更新改动 Hook 命令 → needs-approval 且旧 Hook 不再运行；旧 digest 409，新 digest 批准后运行；#tag 取该 ref', async () => {
    const records = await tempDir('coko-plugin-hooks-')
    const rec1 = join(records, 'v1.jsonl')
    const rec2 = join(records, 'v2.jsonl')
    const repo = await createGitWorkspace({ files: { 'README.md': '# plugin\n' } })
    await writePlugin(repo.root, { name: 'gitplug', files: { 'hooks/hooks.json': preToolUseHooks(hookCommand('--record', rec1), 'Bash') } })
    await repo.git('add', '-A')
    await repo.git('commit', '-q', '-m', 'v1')
    await repo.git('tag', 'v1')
    const c1 = (await repo.git('rev-parse', 'HEAD')).trim()
    const url = pathToFileURL(repo.root).href
    const h = await boot(
      [
        { content: [bash('b1', 'echo one')] },
        { content: 'ok' },
        { content: [bash('b2', 'echo two')] },
        { content: 'ok' },
        { content: [bash('b3', 'echo three')] },
        { content: 'ok' },
      ],
      { env: repo.env },
    )
    const lines = async (file: string) => (existsSync(file) ? (await readFile(file, 'utf8')).split('\n').filter(Boolean).length : 0)

    expect([(await h.install({ kind: 'git', url: 'file:///nonexistent/coko-plugin.git' })).body]).toEqual([
      { error: expect.objectContaining({ code: 'plugin-source-unreachable' }) },
    ])
    const installed = await h.install({ kind: 'git', url })
    expect(installed.status).toBe(201)
    const v1 = installed.body as PluginInfo
    expect(v1).toMatchObject({ name: 'gitplug', status: 'needs-approval', source: { kind: 'git', location: url, commit: c1 } })
    expect(existsSync(join(h.dirs.cokoHome, 'plugins', 'gitplug', '.git'))).toBe(false)
    await h.approve(v1)
    const sessionId = await h.open()
    await h.send(sessionId, 'one')
    await h.runEnds(sessionId, 1)
    expect(await lines(rec1)).toBe(1)

    await writePlugin(repo.root, { name: 'gitplug', files: { 'hooks/hooks.json': preToolUseHooks(hookCommand('--record', rec2), 'Bash') } })
    await repo.git('commit', '-q', '-am', 'v2')
    const c2 = (await repo.git('rev-parse', 'HEAD')).trim()
    const updated = await h.api.post(pluginPaths.update('gitplug'))
    expect(updated.status).toBe(200)
    const v2 = updated.body as PluginInfo
    expect(v2).toMatchObject({ status: 'needs-approval', source: { commit: c2 }, executables: { hooks: [{ command: expect.stringContaining(rec2) }] } })
    expect(v2.digest).not.toBe(v1.digest)
    await h.send(sessionId, 'two')
    await h.runEnds(sessionId, 2)
    expect([await lines(rec1), await lines(rec2)]).toEqual([1, 0])

    const stale = await h.approve(v1)
    expect([stale.status, (stale.body as { error: { code: string } }).error.code]).toEqual([409, 'digest-mismatch'])
    expect((await h.approve(v2)).status).toBe(200)
    await h.send(sessionId, 'three')
    await h.runEnds(sessionId, 3)
    expect([await lines(rec1), await lines(rec2)]).toEqual([1, 1])

    expect((await h.api.delete(pluginPaths.plugin('gitplug'))).status).toBe(204)
    const tagged = (await h.install({ kind: 'git', url: url + '#v1' })).body as PluginInfo
    expect(tagged).toMatchObject({
      source: { kind: 'git', location: url, ref: 'v1', commit: c1 },
      executables: { hooks: [{ command: expect.stringContaining(rec1) }] },
    })
    expect(await h.sidecar.stop()).toEqual({ code: 0, signal: null })
    await repo.dispose()
  })
})
