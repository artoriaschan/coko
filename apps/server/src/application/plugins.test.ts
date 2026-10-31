// PluginService（ADR 0017）：目录来源安装、状态派生、digest 批准、启停的贡献快照、卸载的路径安全（记录被改到插件根外时拒绝删除）。
// 内存存储与真实临时目录；git 来源与进程在 tests/integration/sidecar-plugins*.test.ts。
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createPayloadRegistry, type SessionStore } from '@coko/session'
import { createMemoryStore } from '@coko/session/memory'
import { AppError } from './errors.ts'
import { PluginService } from './plugins.ts'

let base: string
let source: string
let cokoHome: string
let store: SessionStore

const put = async (relative: string, content: string | object) => {
  const path = join(source, relative)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, typeof content === 'string' ? content : JSON.stringify(content))
}

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'coko-plugin-service-'))
  source = join(base, 'source')
  cokoHome = join(base, 'home')
  store = createMemoryStore({ payloads: createPayloadRegistry([]) })
  await put('.coko-plugin/plugin.json', { name: 'demo', version: '1.0.0' })
  await put('skills/greet/SKILL.md', '---\nname: greet\ndescription: Greets\n---\nbody\n')
  await put('hooks/hooks.json', { hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: '${COKO_PLUGIN_ROOT}/guard.sh' }] }] } })
})
afterEach(() => rm(base, { recursive: true, force: true }))

const service = (options: Partial<ConstructorParameters<typeof PluginService>[0]> = {}) => new PluginService({ store, cokoHome, ...options })
const codeOf = async (promise: Promise<unknown>) => {
  try {
    await promise
  } catch (error) {
    return error instanceof AppError ? [error.code, error.status] : String(error)
  }
  return 'resolved'
}

describe('PluginService', () => {
  it('安装：复制到 <COKO_HOME>/plugins/<name>、needs-approval、贡献为空；批准后 enabled 且快照带插件根；源目录之后的改动不生效', async () => {
    const plugins = service()
    const info = await plugins.install({ kind: 'dir', path: source })
    const installed = join(cokoHome, 'plugins', 'demo')
    expect(info).toMatchObject({
      name: 'demo',
      status: 'needs-approval',
      source: { kind: 'dir', location: source },
      contributions: { skills: ['demo:greet'], commands: [], agents: [] },
      executables: { hooks: [{ event: 'PreToolUse', command: join(installed, 'guard.sh') }] },
    })
    expect(existsSync(join(installed, 'skills', 'greet', 'SKILL.md'))).toBe(true)
    expect(await plugins.snapshot()).toEqual({ skillRoots: [], commandRoots: [], agentRoots: [], hooks: [], mcpServers: [], lspServers: [] })
    expect(await codeOf(plugins.install({ kind: 'dir', path: source }))).toEqual(['plugin-exists', 409])

    expect(await codeOf(plugins.approve('demo', 'f'.repeat(64)))).toEqual(['digest-mismatch', 409])
    const changes: string[] = []
    plugins.onChange(() => void changes.push('change'))
    expect((await plugins.approve('demo', info.digest)).status).toBe('enabled')
    expect(changes).toEqual(['change'])
    const snapshot = await plugins.snapshot()
    expect(snapshot.skillRoots).toEqual([{ plugin: 'demo', path: join(installed, 'skills') }])
    expect(snapshot.hooks).toEqual([
      { plugin: 'demo', root: installed, hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: join(installed, 'guard.sh') }] }] } },
    ])

    await put('hooks/hooks.json', { hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'changed' }] }] } })
    expect((await plugins.list())[0]!.status).toBe('enabled')
    expect((await plugins.setEnabled('demo', false)).status).toBe('disabled')
    expect((await plugins.snapshot()).skillRoots).toEqual([])
  })

  it('安装目录被改动（Hook 命令）时 digest 变化，回到 needs-approval，不再提供贡献', async () => {
    const plugins = service()
    const info = await plugins.install({ kind: 'dir', path: source })
    await plugins.approve('demo', info.digest)
    await writeFile(
      join(cokoHome, 'plugins', 'demo', 'hooks', 'hooks.json'),
      JSON.stringify({ PreToolUse: [{ hooks: [{ type: 'command', command: 'curl evil' }] }] }),
    )
    const [listed] = await plugins.list()
    expect([listed!.status, listed!.digest === info.digest]).toEqual(['needs-approval', false])
    expect((await plugins.snapshot()).hooks).toEqual([])
  })

  it.each([
    ['相对路径', { kind: 'dir' as const, path: 'relative/dir' }, ['bad-request', 400]],
    ['不存在的目录', { kind: 'dir' as const, path: '/nonexistent/coko-plugin' }, ['plugin-source-unreachable', 400]],
    ['ssh 地址', { kind: 'git' as const, url: 'ssh://host/repo.git' }, ['bad-request', 400]],
    ['带凭据的地址', { kind: 'git' as const, url: 'https://user:token@example.test/repo.git' }, ['bad-request', 400]],
  ])('来源校验：%s', async (_label, src, expected) => {
    expect(await codeOf(service().install(src))).toEqual(expected)
  })

  it('无效清单 400 plugin-invalid（details.diagnostics）；超出上限 400 plugin-too-large；都不留下安装目录', async () => {
    await put('.coko-plugin/plugin.json', { name: 'Bad Name', version: '1.0.0' })
    const error = await service()
      .install({ kind: 'dir', path: source })
      .catch((e: AppError) => e)
    expect([error.code, (error.details!.diagnostics as { code: string }[]).map((d) => d.code)]).toEqual(['plugin-invalid', ['invalid-name']])
    await put('.coko-plugin/plugin.json', { name: 'demo', version: '1.0.0' })
    expect(await codeOf(service({ limits: { maxFiles: 2, maxBytes: 1_000_000 } }).install({ kind: 'dir', path: source }))).toEqual(['plugin-too-large', 400])
    expect(existsSync(join(cokoHome, 'plugins', 'demo'))).toBe(false)
    expect(await store.plugins.list()).toEqual([])
  })

  it('engines.coko 不满足：安装成功、状态 incompatible，批准后仍不提供贡献', async () => {
    await put('.coko-plugin/plugin.json', { name: 'demo', version: '1.0.0', engines: { coko: '>=99.0.0' } })
    const plugins = service({ appVersion: '0.5.0' })
    const info = await plugins.install({ kind: 'dir', path: source })
    expect(info.status).toBe('incompatible')
    expect(info.diagnostics.map((d) => d.code)).toContain('incompatible-engine')
    expect((await plugins.approve('demo', info.digest)).status).toBe('incompatible')
    expect((await plugins.snapshot()).skillRoots).toEqual([])
  })

  it('卸载：先通知（快照中已没有该插件），再删除目录与记录；未安装 404', async () => {
    const plugins = service()
    await plugins.approve('demo', (await plugins.install({ kind: 'dir', path: source })).digest)
    const seen: number[] = []
    plugins.onChange(async () => {
      seen.push((await plugins.snapshot()).skillRoots.length)
      expect(existsSync(join(cokoHome, 'plugins', 'demo'))).toBe(true)
    })
    await plugins.uninstall('demo')
    expect(seen).toEqual([0])
    expect(existsSync(join(cokoHome, 'plugins', 'demo'))).toBe(false)
    expect(await store.plugins.get('demo')).toBeUndefined()
    expect(await codeOf(plugins.uninstall('demo'))).toEqual(['plugin-not-found', 404])
  })

  it('对手用例：记录中的 path 被改成插件根外的目录时，卸载与更新拒绝（403），该目录不被删除', async () => {
    const plugins = service()
    const record = await plugins.install({ kind: 'dir', path: source }).then(() => store.plugins.get('demo'))
    const victim = join(base, 'victim')
    await mkdir(victim)
    await writeFile(join(victim, 'keep.txt'), 'keep')
    for (const path of [victim, join(cokoHome, 'plugins', '..', '..', 'victim')]) {
      await store.plugins.upsert({ ...record!, path })
      expect(await codeOf(plugins.uninstall('demo'))).toEqual(['forbidden', 403])
      expect(await codeOf(plugins.update('demo'))).toEqual(['forbidden', 403])
      expect(await readFile(join(victim, 'keep.txt'), 'utf8')).toBe('keep')
    }
    expect(await store.plugins.get('demo')).toBeDefined()
  })
})
