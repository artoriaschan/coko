// 插件提供的 Skills、命令与子代理定义的名字（批准对话框与 GET /api/plugins 的 contributions）：用与 Run 相同的加载器读取插件目录，
// 名字为 <plugin>:<name>；加载器的诊断（含 path-outside-plugin）带 source plugin。
import { readdir, readFile, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative } from 'node:path'
import { parseAgentDefinition } from '../../agents/definitions.ts'
import { createCommandTemplateLoader } from '../../instructions/commands/loader.ts'
import { diagnostic, type ResourceDiagnostic } from '../../instructions/shared/diagnostics.ts'
import { createSkillLoader } from '../../instructions/skills/loader.ts'
import type { LoadedPlugin } from './manifest.ts'
import { pluginResourceName } from './types.ts'

export interface PluginContributionList {
  names: { skills: string[]; commands: string[]; agents: string[] }
  diagnostics: ResourceDiagnostic[]
}

const inside = (root: string, path: string) => {
  const rel = relative(root, path)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}
const asPlugin = (d: ResourceDiagnostic): ResourceDiagnostic => ({ ...d, source: 'plugin' })

export async function listPluginContributions(plugin: LoadedPlugin): Promise<PluginContributionList> {
  const empty: PluginContributionList = { names: { skills: [], commands: [], agents: [] }, diagnostics: [] }
  if (!plugin.valid || plugin.name === undefined) return empty
  const name = plugin.name
  const diagnostics: ResourceDiagnostic[] = []
  const skills = await createSkillLoader().discover(plugin.skillRoots.map((dir) => ({ dir, scope: 'user' as const, boundary: dir, plugin: name })))
  diagnostics.push(...skills.diagnostics.map(asPlugin))
  const loader = createCommandTemplateLoader()
  const commands: string[] = []
  for (const dir of plugin.commandRoots) {
    const loaded = await loader.load(dir, 'user', { plugin: name })
    commands.push(...loaded.templates.map((t) => t.name))
    diagnostics.push(...loaded.diagnostics.map(asPlugin))
  }
  const agents: string[] = []
  const realRoot = await realpath(plugin.root).catch(() => plugin.root)
  for (const dir of plugin.agentRoots) {
    const files = (await readdir(dir).catch(() => [] as string[])).filter((f) => f.endsWith('.md')).sort()
    for (const file of files) {
      const path = join(dir, file)
      const real = await realpath(path).catch(() => undefined)
      if (!real || !inside(realRoot, real)) {
        diagnostics.push(diagnostic('plugin', 'path-outside-plugin', `The definition of plugin ${name} resolves outside the plugin`, path))
        continue
      }
      const text = await readFile(real, 'utf8').catch(() => undefined)
      if (text === undefined) continue
      const parsed = parseAgentDefinition(text, { source: 'user', path })
      diagnostics.push(...parsed.diagnostics.map(asPlugin))
      if (parsed.definition) agents.push(pluginResourceName(name, parsed.definition.name))
    }
  }
  return {
    names: { skills: skills.skills.map((s) => s.name).sort(), commands: [...new Set(commands)].sort(), agents: [...new Set(agents)].sort() },
    diagnostics,
  }
}
