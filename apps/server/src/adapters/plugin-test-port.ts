// 仅测试（COKO_TEST_PLUGINS=<目录>，测试构建且未 --packaged）：把该目录当作一个已批准、已启用的插件提供贡献，供插件消费 seam 的接线用例。
// 只认清单的 name 与缺省位置（skills/、commands/、agents/、hooks/hooks.json、.mcp.json、.lsp.json），${COKO_PLUGIN_ROOT} 替换为该目录；
// 清单的完整解析、诊断与 digest 属于插件核心，产品装配不使用本文件。
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { PluginContributionsPort, PluginContributionsSnapshot } from '@coko/agent'

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

const substitute = (value: unknown, root: string): unknown => {
  if (typeof value === 'string') return value.replaceAll('${COKO_PLUGIN_ROOT}', root).replaceAll('${CLAUDE_PLUGIN_ROOT}', root)
  if (Array.isArray(value)) return value.map((item) => substitute(item, root))
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, substitute(item, root)]))
  return value
}

async function json(path: string): Promise<Record<string, unknown> | undefined> {
  const text = await readFile(path, 'utf8').catch(() => undefined)
  if (text === undefined) return undefined
  const parsed: unknown = JSON.parse(text)
  return isRecord(parsed) ? parsed : undefined
}

const isDir = async (path: string) => (await stat(path).catch(() => undefined))?.isDirectory() === true

export async function readTestPlugin(root: string): Promise<PluginContributionsSnapshot> {
  const manifest = (await json(join(root, '.coko-plugin', 'plugin.json'))) ?? (await json(join(root, '.claude-plugin', 'plugin.json')))
  const plugin = typeof manifest?.name === 'string' ? manifest.name : undefined
  if (!plugin) throw new Error(`COKO_TEST_PLUGINS: ${root} has no plugin manifest with a name`)
  const rootOf = async (dir: string) => ((await isDir(join(root, dir))) ? [{ plugin, path: join(root, dir) }] : [])
  const hooksFile = await json(join(root, 'hooks', 'hooks.json'))
  const hooks = hooksFile ? (isRecord(hooksFile.hooks) ? hooksFile.hooks : hooksFile) : undefined
  const servers = (file: Record<string, unknown> | undefined, key: string) => {
    const map = file && isRecord(file[key]) ? file[key] : (file ?? {})
    return Object.entries(map as Record<string, unknown>).flatMap(([name, config]) =>
      isRecord(config) ? [{ plugin, name, config: substitute(config, root) as Record<string, unknown> }] : [],
    )
  }
  return {
    skillRoots: await rootOf('skills'),
    commandRoots: await rootOf('commands'),
    agentRoots: await rootOf('agents'),
    hooks: hooks ? [{ plugin, root, hooks: substitute(hooks, root) as Record<string, unknown> }] : [],
    mcpServers: servers(await json(join(root, '.mcp.json')), 'mcpServers'),
    lspServers: servers(await json(join(root, '.lsp.json')), 'lspServers'),
  }
}

/** 每次 snapshot 重新读取目录（与已安装插件每个 Run 读一次快照相同）。 */
export function createTestPluginPort(root: string): PluginContributionsPort {
  return { snapshot: () => readTestPlugin(root), onChange: () => () => {} }
}
