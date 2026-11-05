// 插件清单（ADR 0017）：每种诊断、两种清单位置、路径数组与缺省目录、engines.coko 比较、${COKO_PLUGIN_ROOT} 替换、digest 的稳定性与敏感范围、
// 贡献名字与符号链接越界。真实临时目录。
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { engineSatisfied, listPluginContributions, loadPlugin } from './index.ts'

let base: string
let root: string

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'coko-plugin-manifest-'))
  root = join(base, 'plug')
  await mkdir(root)
})
afterEach(() => rm(base, { recursive: true, force: true }))

const put = async (relative: string, content: string | object) => {
  const path = join(root, relative)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, typeof content === 'string' ? content : JSON.stringify(content))
  return path
}
const manifest = (fields: Record<string, unknown> = {}) => put('.coko-plugin/plugin.json', { name: 'demo', version: '1.2.3', ...fields })
const load = (options: { appVersion?: string; installRoot?: string; portableDigest?: boolean } = {}) => loadPlugin(root, options)
const codes = (plugin: { diagnostics: { code: string }[] }) => plugin.diagnostics.map((d) => d.code)
const hookFile = (command: string) => ({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command }] }] } })

describe('清单位置与必填字段', () => {
  it('.coko-plugin/plugin.json 优先；缺失时读 .claude-plugin/plugin.json；两者都没有为 invalid-manifest', async () => {
    expect([(await load()).valid, codes(await load())]).toEqual([false, ['invalid-manifest']])
    await put('.claude-plugin/plugin.json', { name: 'from-claude', version: '0.1.0' })
    expect((await load()).name).toBe('from-claude')
    await manifest()
    const loaded = await load()
    expect([loaded.valid, loaded.name, loaded.version, loaded.manifestPath]).toEqual([true, 'demo', '1.2.3', join(root, '.coko-plugin', 'plugin.json')])
  })

  it.each([
    ['不是 JSON', '{ name: ', 'invalid-manifest'],
    ['不是对象', '[1]', 'invalid-manifest'],
    ['缺少 name', { version: '1.0.0' }, 'invalid-name'],
    ['name 含大写', { name: 'Demo', version: '1.0.0' }, 'invalid-name'],
    ['name 以数字开头', { name: '1demo', version: '1.0.0' }, 'invalid-name'],
    ['name 超过 48 个字符', { name: 'a'.repeat(49), version: '1.0.0' }, 'invalid-name'],
    ['缺少 version', { name: 'demo' }, 'invalid-manifest'],
    ['version 不是 x.y.z', { name: 'demo', version: '1.0' }, 'invalid-manifest'],
    ['skills 不是字符串或字符串数组', { name: 'demo', version: '1.0.0', skills: 3 }, 'invalid-manifest'],
    ['hooks 不是路径或对象', { name: 'demo', version: '1.0.0', hooks: 7 }, 'invalid-manifest'],
  ])('%s → 无效（%s）', async (_label, content, code) => {
    await put('.coko-plugin/plugin.json', content)
    const loaded = await load()
    expect(loaded.valid).toBe(false)
    expect(codes(loaded)).toContain(code)
    expect(loaded.diagnostics.every((d) => d.source === 'plugin')).toBe(true)
  })

  it('version 可带预发布；未知字段与 claude-code 的 userConfig / channels / outputStyles / settings 为 unsupported-field 且不使清单无效', async () => {
    await manifest({
      version: '1.0.0-beta.1',
      userConfig: {},
      channels: [],
      outputStyles: './styles',
      settings: {},
      bogus: 1,
      homepage: 'https://x',
      license: 'MIT',
    })
    const loaded = await load()
    expect(loaded.valid).toBe(true)
    expect(loaded.diagnostics.filter((d) => d.code === 'unsupported-field').map((d) => /"(\w+)"/.exec(d.message)?.[1])).toEqual([
      'userConfig',
      'channels',
      'outputStyles',
      'settings',
      'bogus',
    ])
  })
})

describe('engines.coko', () => {
  it.each([
    ['>=1.2.0', '1.2.0', true],
    ['>=1.2.0', '1.10.0', true],
    ['>=1.2.0', '1.1.9', false],
    ['>=1.2.0', '2.0.0', true],
    ['>=1.2.0', '1.2.0-beta.1', false],
    ['>= 1.2.0', '1.3.0', true],
    ['>=99.0.0', '0.0.0', true],
    ['>=99.0.0', undefined, true],
    ['^1.0.0', '1.5.0', false],
    ['>=1.2', '1.5.0', false],
  ])('%s 对应用版本 %s → %s', (range, app, expected) => {
    expect(engineSatisfied(range, app)).toBe(expected)
  })

  it('不满足时 compatible 为 false、诊断 incompatible-engine，清单仍有效；不支持的写法同样为 incompatible-engine', async () => {
    await manifest({ engines: { coko: '>=99.0.0' } })
    const loaded = await load({ appVersion: '0.5.0' })
    expect([loaded.valid, loaded.compatible, codes(loaded)]).toEqual([true, false, ['incompatible-engine']])
    await manifest({ engines: { coko: '~1.0.0' } })
    expect([(await load({ appVersion: '0.5.0' })).compatible, codes(await load({ appVersion: '0.5.0' }))]).toEqual([false, ['incompatible-engine']])
    await manifest({ engines: { coko: '>=0.5.0' } })
    expect((await load({ appVersion: '0.5.0' })).compatible).toBe(true)
  })
})

describe('资源路径', () => {
  it('缺省目录存在时使用，不存在时没有；路径数组按顺序；声明的路径不存在为 missing-path', async () => {
    await manifest()
    expect((await load()).skillRoots).toEqual([])
    await mkdir(join(root, 'skills'))
    await mkdir(join(root, 'commands'))
    expect((await load()).skillRoots).toEqual([join(root, 'skills')])
    expect((await load()).commandRoots).toEqual([join(root, 'commands')])
    await mkdir(join(root, 'more', 'a'), { recursive: true })
    await manifest({ skills: ['./more/a', 'missing'], agents: './more/a' })
    const loaded = await load()
    expect(loaded.skillRoots).toEqual([join(root, 'more', 'a')])
    expect(loaded.agentRoots).toEqual([join(root, 'more', 'a')])
    expect(loaded.diagnostics).toEqual([expect.objectContaining({ code: 'missing-path', path: join(root, 'missing') })])
  })

  it('对手用例：../../outside 与指向插件根外的符号链接为 path-outside-plugin，该项不加载', async () => {
    const outside = join(base, 'outside')
    await mkdir(outside)
    await symlink(outside, join(root, 'linked'))
    await manifest({ skills: '../../outside', commands: ['linked'], agents: '/etc' })
    const loaded = await load()
    expect(loaded.valid).toBe(true)
    expect([loaded.skillRoots, loaded.commandRoots, loaded.agentRoots]).toEqual([[], [], []])
    expect(codes(loaded)).toEqual(['path-outside-plugin', 'path-outside-plugin', 'path-outside-plugin'])
  })

  it('hooks / mcpServers / lspServers 的文件路径逃出插件根同样不读取', async () => {
    await writeFile(join(base, 'evil.json'), JSON.stringify(hookFile('rm -rf /')))
    await manifest({ hooks: '../evil.json' })
    const loaded = await load()
    expect([loaded.hooks, codes(loaded)]).toEqual([{}, ['path-outside-plugin']])
  })
})

describe('可执行声明与替换', () => {
  it('缺省文件 hooks/hooks.json、.mcp.json、.lsp.json；${COKO_PLUGIN_ROOT} 与 ${CLAUDE_PLUGIN_ROOT} 替换为安装目录；executables 列出完整命令与 env 的键', async () => {
    await manifest()
    await put('hooks/hooks.json', hookFile('${COKO_PLUGIN_ROOT}/bin/guard --x ${CLAUDE_PLUGIN_ROOT}'))
    await put('.mcp.json', {
      mcpServers: {
        echo: { command: '${COKO_PLUGIN_ROOT}/srv', args: ['--root', '${CLAUDE_PLUGIN_ROOT}'], env: { TOKEN_DIR: '${COKO_PLUGIN_ROOT}/t', MODE: 'x' } },
        remote: { url: 'https://example.test/${COKO_PLUGIN_ROOT}' },
      },
    })
    await put('.lsp.json', {
      ts: { command: 'node', args: ['${COKO_PLUGIN_ROOT}/lsp.mjs'], extensionToLanguage: { '.ts': 'typescript', '.tsx': 'typescriptreact' } },
    })
    const loaded = await load({ installRoot: '/inst/demo' })
    expect(loaded.executables).toEqual({
      hooks: [{ event: 'PreToolUse', matcher: 'Bash', command: '/inst/demo/bin/guard --x /inst/demo' }],
      mcpServers: [
        { name: 'plugin-demo-echo', command: '/inst/demo/srv', args: ['--root', '/inst/demo'], envKeys: ['TOKEN_DIR', 'MODE'] },
        { name: 'plugin-demo-remote', url: 'https://example.test//inst/demo', envKeys: [] },
      ],
      lspServers: [{ name: 'demo:ts', command: 'node', args: ['/inst/demo/lsp.mjs'], extensions: ['.ts', '.tsx'] }],
    })
    expect(loaded.mcpServers.echo).toEqual({ command: '/inst/demo/srv', args: ['--root', '/inst/demo'], env: { TOKEN_DIR: '/inst/demo/t', MODE: 'x' } })
    expect(loaded.diagnostics).toEqual([])
  })

  it('内联声明；hooks 文件可不带外层 hooks 键；路径数组合并同一事件的组', async () => {
    await put('h1.json', hookFile('one'))
    await put('h2.json', { PreToolUse: [{ hooks: [{ type: 'command', command: 'two' }] }], Stop: [{ hooks: [{ type: 'command', command: 'three' }] }] })
    await manifest({ hooks: ['h1.json', 'h2.json'], mcpServers: { inline: { command: 'srv' } }, lspServers: { py: { command: 'pyls' } } })
    const loaded = await load()
    expect(loaded.executables.hooks.map((h) => [h.event, h.command])).toEqual([
      ['PreToolUse', 'one'],
      ['PreToolUse', 'two'],
      ['Stop', 'three'],
    ])
    expect(loaded.executables.mcpServers.map((s) => s.name)).toEqual(['plugin-demo-inline'])
    expect(loaded.executables.lspServers).toEqual([{ name: 'demo:py', command: 'pyls', extensions: [] }])
  })

  it('引用的文件不是 JSON 时清单无效；Hook 配置的诊断带 source plugin；缺 command 的语言服务器不列出', async () => {
    await manifest({ lspServers: { bad: { args: [] } } })
    await put('hooks/hooks.json', { Bogus: [] })
    const loaded = await load()
    expect(loaded.valid).toBe(true)
    expect(codes(loaded)).toEqual(['unknown-event', 'invalid-server'])
    expect(loaded.diagnostics.every((d) => d.source === 'plugin')).toBe(true)
    expect(loaded.executables.lspServers).toEqual([])
    await put('.mcp.json', '{ not json')
    expect([(await load()).valid, codes(await load())]).toEqual([false, ['unknown-event', 'invalid-manifest', 'invalid-server']])
  })
})

describe('digest', () => {
  const setup = async () => {
    await put('hooks/hooks.json', hookFile('guard'))
    await put('.mcp.json', { mcpServers: { echo: { command: 'srv', args: ['a'] } } })
    await put('.lsp.json', { lspServers: { ts: { command: 'tsls', args: ['--stdio'] } } })
    await put('skills/greet/SKILL.md', '---\nname: greet\ndescription: d\n---\nbody one\n')
  }

  it('不受清单键顺序与描述影响；改 Skill 正文不变', async () => {
    await setup()
    await put('.coko-plugin/plugin.json', { name: 'demo', version: '1.0.0', description: 'a' })
    const first = (await load()).digest
    expect(first).toMatch(/^[0-9a-f]{64}$/)
    await put('.coko-plugin/plugin.json', { description: 'changed', version: '1.0.0', name: 'demo' })
    await put('skills/greet/SKILL.md', '---\nname: greet\ndescription: d\n---\nbody two, different\n')
    expect((await load()).digest).toBe(first)
  })

  it('Hook、MCP、LSP 声明的键顺序不影响', async () => {
    await setup()
    await manifest({ version: '1.0.0' })
    const before = (await load()).digest
    await put('.mcp.json', { mcpServers: { echo: { args: ['a'], command: 'srv' } } })
    await put('hooks/hooks.json', { hooks: { PreToolUse: [{ hooks: [{ command: 'guard', type: 'command' }], matcher: 'Bash' }] } })
    expect((await load()).digest).toBe(before)
  })

  it.each([
    ['Hook 命令', () => put('hooks/hooks.json', hookFile('guard --strict'))],
    ['MCP 参数', () => put('.mcp.json', { mcpServers: { echo: { command: 'srv', args: ['b'] } } })],
    ['MCP env 值', () => put('.mcp.json', { mcpServers: { echo: { command: 'srv', args: ['a'], env: { X: '1' } } } })],
    ['LSP 命令', () => put('.lsp.json', { lspServers: { ts: { command: 'other', args: ['--stdio'] } } })],
    ['version', () => put('.coko-plugin/plugin.json', { name: 'demo', version: '1.0.1' })],
    ['engines', () => put('.coko-plugin/plugin.json', { name: 'demo', version: '1.0.0', engines: { coko: '>=0.1.0' } })],
  ])('改 %s 时变化', async (_label, change) => {
    await setup()
    await manifest({ version: '1.0.0' })
    const before = (await load()).digest
    await change()
    expect((await load()).digest).not.toBe(before)
  })

  it('可移动摘要在根替换前计算，保留 Hook、MCP、LSP 原声明中的所有变化', async () => {
    await manifest()
    await put('hooks/hooks.json', hookFile('${COKO_PLUGIN_ROOT}/guard'))
    await put('.mcp.json', { echo: { command: 'srv', args: ['${COKO_PLUGIN_ROOT}/server'], env: { ROOT: '${CLAUDE_PLUGIN_ROOT}', MODE: 'one' } } })
    await put('.lsp.json', { ts: { command: 'node', args: ['${COKO_PLUGIN_ROOT}/language.mjs'] } })
    const first = await load({ installRoot: '/a', portableDigest: true })
    const moved = await load({ installRoot: '/b', portableDigest: true })
    expect(moved.digest).toBe(first.digest)
    expect(moved.executables.hooks[0]!.command).toBe('/b/guard')
    expect(moved.mcpServers.echo!.env).toEqual({ ROOT: '/b', MODE: 'one' })
    expect(moved.lspServers.ts!.args).toEqual(['/b/language.mjs'])
    await put('hooks/hooks.json', hookFile('/a/guard'))
    const absolute = (await load({ installRoot: '/a', portableDigest: true })).digest
    expect(absolute).not.toBe(first.digest)
    await put('.mcp.json', { echo: { command: 'srv', args: ['${COKO_PLUGIN_ROOT}/server'], env: { ROOT: '${CLAUDE_PLUGIN_ROOT}', MODE: 'two' } } })
    const changedEnv = (await load({ installRoot: '/a', portableDigest: true })).digest
    expect(changedEnv).not.toBe(absolute)
    await put('.lsp.json', { ts: { command: 'node', args: ['${COKO_PLUGIN_ROOT}/other.mjs'] } })
    expect((await load({ installRoot: '/a', portableDigest: true })).digest).not.toBe(changedEnv)
  })

  it('安装目录不同（替换结果不同）时变化：digest 覆盖实际运行的命令', async () => {
    await setup()
    await put('hooks/hooks.json', hookFile('${COKO_PLUGIN_ROOT}/guard'))
    await manifest()
    expect((await load({ installRoot: '/a' })).digest).not.toBe((await load({ installRoot: '/b' })).digest)
    expect((await load({ installRoot: '/a' })).digest).toBe((await load({ installRoot: '/a' })).digest)
  })
})

describe('贡献名字', () => {
  it('Skills、命令与子代理定义以 <plugin>:<name> 列出；指向插件根外的 Skill 不列出', async () => {
    await manifest()
    await put('skills/greet/SKILL.md', '---\nname: greet\ndescription: Greets\n---\nbody\n')
    await put('commands/hello.md', '---\ndescription: hi\n---\nHello $ARGUMENTS\n')
    await put('commands/group/deep.md', 'Deep command\n')
    await put('agents/reviewer.md', '---\nname: reviewer\ndescription: Reviews\n---\nRole\n')
    const outside = join(base, 'outside-skill')
    await mkdir(outside)
    await writeFile(join(outside, 'SKILL.md'), '---\nname: evil\ndescription: e\n---\nx\n')
    await symlink(outside, join(root, 'skills', 'evil'))
    const contributions = await listPluginContributions(await load())
    expect(contributions.names).toEqual({ skills: ['demo:greet'], commands: ['demo:group:deep', 'demo:hello'], agents: ['demo:reviewer'] })
    expect(contributions.diagnostics.map((d) => [d.source, d.code])).toEqual([['plugin', 'path-outside-plugin']])
  })
})
