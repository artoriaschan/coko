// 插件清单（ADR 0017）：<root>/.coko-plugin/plugin.json，缺失时 <root>/.claude-plugin/plugin.json（claude-code 插件的子集）。解析字段与诊断、
// 资源路径（含经符号链接）不得逃出插件根、engines.coko（只支持 >=x.y.z）、${COKO_PLUGIN_ROOT} / ${CLAUDE_PLUGIN_ROOT} 替换为安装目录，
// 以及批准所用的 digest：SHA-256（规范化 JSON，键排序）覆盖清单的 name / version / engines 与展开后的 hooks、mcpServers、lspServers 声明。
// Skills、命令与子代理定义的正文不进入 digest（它们不执行；改正文不需要重新批准）。
import { createHash } from 'node:crypto'
import { readFile, realpath, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { parseHooksConfig } from '../hooks/config.ts'
import { diagnostic, type ResourceDiagnostic } from '../../instructions/shared/diagnostics.ts'
import { pluginMcpServerName, pluginResourceName } from './types.ts'

/** 清单位置（按顺序查找）。 */
export const PLUGIN_MANIFEST_PATHS = ['.coko-plugin/plugin.json', '.claude-plugin/plugin.json'] as const
const NAME = /^[a-z][a-z0-9-]{0,47}$/
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const ENGINE_RANGE = /^>=\s*(\d+)\.(\d+)\.(\d+)$/
const RESOURCE_FIELDS = ['skills', 'commands', 'agents'] as const
const KNOWN_FIELDS = new Set(['name', 'version', 'description', 'author', 'engines', ...RESOURCE_FIELDS, 'hooks', 'mcpServers', 'lspServers'])
/** 只用于展示的元数据：接受并忽略，不给诊断。 */
const METADATA_FIELDS = new Set(['$schema', 'homepage', 'repository', 'license', 'keywords'])
const ROOT_PLACEHOLDERS = ['${COKO_PLUGIN_ROOT}', '${CLAUDE_PLUGIN_ROOT}'] as const

type Json = Record<string, unknown>
const isRecord = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** 批准对话框显示的全部可执行内容（与协议的 PluginExecutables 同形）。 */
export interface PluginExecutableSummary {
  hooks: { event: string; matcher?: string; command: string }[]
  mcpServers: { name: string; command?: string; args?: string[]; url?: string; envKeys: string[] }[]
  lspServers: { name: string; command: string; args?: string[]; extensions: string[] }[]
}

export interface LoadedPlugin {
  /** 读取文件的目录。 */
  root: string
  /** 替换 ${COKO_PLUGIN_ROOT} 所用的安装目录（缺省 root）。 */
  installRoot: string
  manifestPath?: string
  /** 清单可用（有合规的 name 与 version，引用的声明文件可读）；false 时状态为 invalid，不加载任何资源。 */
  valid: boolean
  name?: string
  version?: string
  description?: string
  /** engines.coko 满足当前应用版本（未声明时 true）。 */
  compatible: boolean
  diagnostics: ResourceDiagnostic[]
  /** 资源目录（绝对路径，已确认在插件根之内）。 */
  skillRoots: string[]
  commandRoots: string[]
  agentRoots: string[]
  /** Hook 配置（事件 → 组，形状与设置中的 Hook 相同；命令已替换插件根）。 */
  hooks: Json
  /** 声明的原名 → 配置（已替换插件根）。 */
  mcpServers: Record<string, Json>
  lspServers: Record<string, Json>
  executables: PluginExecutableSummary
  /** 64 位十六进制；valid 为 false 时为空串。 */
  digest: string
}

export interface LoadPluginOptions {
  /** 安装目录（替换与 digest 所用）；缺省为读取的目录。安装时在暂存目录中读取、按最终目录计算。 */
  installRoot?: string
  /** 应用版本（--app-version）；缺省或 0.0.0（源码运行）视为满足任何 engines.coko。 */
  appVersion?: string
}

const parseVersion = (text: string) => {
  const m = /^(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?/.exec(text)
  return m ? { parts: [Number(m[1]), Number(m[2]), Number(m[3])], prerelease: m[4] !== undefined } : undefined
}

/** engines.coko 是否满足：只支持 >=x.y.z（其他写法为不满足）；应用版本缺省或 0.0.0 时满足；预发布版本低于同号的正式版本。 */
export function engineSatisfied(range: string, appVersion: string | undefined): boolean {
  const m = ENGINE_RANGE.exec(range.trim())
  if (!m) return false
  if (appVersion === undefined || appVersion === '0.0.0') return true
  const app = parseVersion(appVersion)
  if (!app) return false
  const want = [Number(m[1]), Number(m[2]), Number(m[3])]
  for (let i = 0; i < 3; i++) if (app.parts[i] !== want[i]) return app.parts[i]! > want[i]!
  return !app.prerelease
}

/** 键排序的规范化 JSON（数组保持顺序）。 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']'
  if (isRecord(value))
    return (
      '{' +
      Object.keys(value)
        .filter((key) => value[key] !== undefined)
        .sort()
        .map((key) => JSON.stringify(key) + ':' + canonicalJson(value[key]))
        .join(',') +
      '}'
    )
  return JSON.stringify(value ?? null)
}

const inside = (root: string, path: string) => {
  const rel = relative(root, path)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

const replaceRoot = (text: string, installRoot: string) => ROOT_PLACEHOLDERS.reduce((t, p) => t.replaceAll(p, installRoot), text)

/** 只替换约定的位置：command、args、env 的值与 url。 */
function substituteServer(config: Json, installRoot: string): Json {
  const out: Json = { ...config }
  if (typeof config.command === 'string') out.command = replaceRoot(config.command, installRoot)
  if (typeof config.url === 'string') out.url = replaceRoot(config.url, installRoot)
  if (Array.isArray(config.args)) out.args = config.args.map((a) => (typeof a === 'string' ? replaceRoot(a, installRoot) : a))
  if (isRecord(config.env))
    out.env = Object.fromEntries(Object.entries(config.env).map(([k, v]) => [k, typeof v === 'string' ? replaceRoot(v, installRoot) : v]))
  return out
}

function substituteHooks(hooks: Json, installRoot: string): Json {
  const out: Json = {}
  for (const [event, groups] of Object.entries(hooks)) {
    out[event] = !Array.isArray(groups)
      ? groups
      : groups.map((group) =>
          !isRecord(group) || !Array.isArray(group.hooks)
            ? group
            : {
                ...group,
                hooks: group.hooks.map((hook) =>
                  isRecord(hook) && typeof hook.command === 'string' ? { ...hook, command: replaceRoot(hook.command, installRoot) } : hook,
                ),
              },
        )
  }
  return out
}

/** 声明文件或内联对象的外层键（{ hooks: … }、{ mcpServers: … }、{ lspServers: … }）可有可无。 */
const unwrap = (value: Json, key: string): Json => (isRecord(value[key]) ? (value[key] as Json) : value)

export async function loadPlugin(dir: string, options: LoadPluginOptions = {}): Promise<LoadedPlugin> {
  const root = resolve(dir)
  const installRoot = options.installRoot ?? root
  const diagnostics: ResourceDiagnostic[] = []
  const report = (code: string, text: string, path?: string) => diagnostics.push(diagnostic('plugin', code, text, path))
  const plugin: LoadedPlugin = {
    root,
    installRoot,
    valid: false,
    compatible: true,
    diagnostics,
    skillRoots: [],
    commandRoots: [],
    agentRoots: [],
    hooks: {},
    mcpServers: {},
    lspServers: {},
    executables: { hooks: [], mcpServers: [], lspServers: [] },
    digest: '',
  }
  const realRoot = await realpath(root).catch(() => root)

  // 清单
  let manifest: Json | undefined
  for (const candidate of PLUGIN_MANIFEST_PATHS) {
    const path = join(root, candidate)
    const text = await readFile(path, 'utf8').catch((error: NodeJS.ErrnoException) => (error.code === 'ENOENT' ? undefined : error))
    if (text === undefined) continue
    plugin.manifestPath = path
    if (text instanceof Error) {
      report('invalid-manifest', `Cannot read the manifest: ${text.message}`, path)
      return plugin
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch (error) {
      report('invalid-manifest', `The manifest is not valid JSON: ${message(error)}`, path)
      return plugin
    }
    if (!isRecord(parsed)) {
      report('invalid-manifest', 'The manifest must be a JSON object', path)
      return plugin
    }
    manifest = parsed
    break
  }
  if (!manifest) {
    report('invalid-manifest', `No manifest: expected ${PLUGIN_MANIFEST_PATHS.join(' or ')}`, root)
    return plugin
  }
  const manifestPath = plugin.manifestPath
  let valid = true
  const invalid = (code: string, text: string) => {
    valid = false
    report(code, text, manifestPath)
  }

  if (typeof manifest.name !== 'string' || !NAME.test(manifest.name)) invalid('invalid-name', 'name is required and must match [a-z][a-z0-9-]{0,47}')
  else plugin.name = manifest.name
  if (typeof manifest.version !== 'string' || !VERSION.test(manifest.version)) invalid('invalid-manifest', 'version is required and must be x.y.z')
  else plugin.version = manifest.version
  if (typeof manifest.description === 'string') plugin.description = manifest.description
  for (const key of Object.keys(manifest))
    if (!KNOWN_FIELDS.has(key) && !METADATA_FIELDS.has(key)) report('unsupported-field', `Field "${key}" is not supported and was ignored`, manifestPath)

  // engines.coko
  let engines: Json | undefined
  if (manifest.engines !== undefined) {
    if (!isRecord(manifest.engines)) invalid('invalid-manifest', 'engines must be an object')
    else {
      engines = manifest.engines
      const range = engines.coko
      if (range !== undefined) {
        if (typeof range !== 'string') invalid('invalid-manifest', 'engines.coko must be a string such as >=1.2.0')
        else if (!engineSatisfied(range, options.appVersion)) {
          plugin.compatible = false
          report(
            'incompatible-engine',
            ENGINE_RANGE.test(range.trim())
              ? `engines.coko ${range} is not satisfied by Coko ${options.appVersion ?? ''}`
              : `engines.coko ${range} is not supported; only >=x.y.z is`,
            manifestPath,
          )
        }
      }
    }
  }

  /** 相对插件根的路径：逃出插件根（含经符号链接）为 path-outside-plugin；不存在为 missing-path（declared 时）。 */
  const locate = async (value: string, kind: 'directory' | 'file', declared: boolean): Promise<string | undefined> => {
    const path = resolve(root, value)
    if (!inside(root, path)) {
      report('path-outside-plugin', `${value} is outside the plugin and was not loaded`, path)
      return undefined
    }
    const real = await realpath(path).catch(() => undefined)
    if (real === undefined) {
      if (declared) report('missing-path', `${value} does not exist`, path)
      return undefined
    }
    if (!inside(realRoot, real)) {
      report('path-outside-plugin', `${value} resolves outside the plugin and was not loaded: ${real}`, path)
      return undefined
    }
    const info = await stat(real).catch(() => undefined)
    if (kind === 'directory' ? !info?.isDirectory() : !info?.isFile()) {
      report('missing-path', `${value} is not a ${kind}`, path)
      return undefined
    }
    return path
  }

  const pathList = (key: string): string[] | undefined | false => {
    const value = manifest[key]
    if (value === undefined) return undefined
    if (typeof value === 'string') return [value]
    if (Array.isArray(value) && value.every((v) => typeof v === 'string')) return value
    return false
  }

  // Skills、命令与子代理定义的目录：缺省为同名目录（存在时）。
  for (const key of RESOURCE_FIELDS) {
    const list = pathList(key)
    if (list === false) {
      invalid('invalid-manifest', `${key} must be a path or an array of paths`)
      continue
    }
    const target = key === 'skills' ? plugin.skillRoots : key === 'commands' ? plugin.commandRoots : plugin.agentRoots
    for (const value of list ?? [key]) {
      const found = await locate(value, 'directory', list !== undefined)
      if (found !== undefined && !target.includes(found)) target.push(found)
    }
  }

  /** 声明：路径（或路径数组）指向 JSON 文件，或内联对象；缺省文件不存在时为空。 */
  const declarations = async (key: string, defaultFile: string): Promise<Json[]> => {
    const value = manifest[key]
    if (isRecord(value)) return [value]
    const list = value === undefined ? undefined : typeof value === 'string' ? [value] : Array.isArray(value) ? value : false
    if (list === false || (list !== undefined && !list.every((v) => typeof v === 'string' || isRecord(v)))) {
      invalid('invalid-manifest', `${key} must be a path, an array of paths or an object`)
      return []
    }
    const out: Json[] = []
    for (const item of (list as (string | Json)[] | undefined) ?? [defaultFile]) {
      if (isRecord(item)) {
        out.push(item)
        continue
      }
      const path = await locate(item, 'file', list !== undefined)
      if (path === undefined) continue
      let parsed: unknown
      try {
        parsed = JSON.parse(await readFile(path, 'utf8'))
      } catch (error) {
        invalid('invalid-manifest', `${item} is not valid JSON: ${message(error)}`)
        continue
      }
      if (!isRecord(parsed)) invalid('invalid-manifest', `${item} must contain a JSON object`)
      else out.push(parsed)
    }
    return out
  }

  // Hook：多个声明按顺序合并同一事件的组。
  const hooks: Json = {}
  for (const declaration of await declarations('hooks', 'hooks/hooks.json')) {
    for (const [event, groups] of Object.entries(unwrap(declaration, 'hooks'))) {
      if (event === 'description') continue
      const existing = hooks[event]
      hooks[event] = Array.isArray(existing) && Array.isArray(groups) ? [...existing, ...groups] : (existing ?? groups)
    }
  }
  plugin.hooks = substituteHooks(hooks, installRoot)
  const parsedHooks = parseHooksConfig(plugin.hooks, 'plugin', { plugin: plugin.name ?? 'plugin', ...(manifestPath ? { path: manifestPath } : {}) })
  diagnostics.push(...parsedHooks.diagnostics)
  plugin.executables.hooks = parsedHooks.hooks.map((h) => ({ event: h.event, ...(h.matcher === undefined ? {} : { matcher: h.matcher }), command: h.command }))

  const servers = async (key: 'mcpServers' | 'lspServers', defaultFile: string) => {
    const out: Record<string, Json> = {}
    for (const declaration of await declarations(key, defaultFile))
      for (const [name, config] of Object.entries(unwrap(declaration, key))) {
        if (!isRecord(config)) {
          report('invalid-server', `${key}.${name} must be an object`, manifestPath)
          continue
        }
        if (!(name in out)) out[name] = substituteServer(config, installRoot)
      }
    return out
  }
  plugin.mcpServers = await servers('mcpServers', '.mcp.json')
  plugin.lspServers = await servers('lspServers', '.lsp.json')

  const strings = (value: unknown) => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : undefined)
  const owner = plugin.name ?? 'plugin'
  for (const [name, config] of Object.entries(plugin.mcpServers)) {
    const args = strings(config.args)
    plugin.executables.mcpServers.push({
      name: pluginMcpServerName(owner, name),
      ...(typeof config.command === 'string' ? { command: config.command } : {}),
      ...(args ? { args } : {}),
      ...(typeof config.url === 'string' ? { url: config.url } : {}),
      envKeys: isRecord(config.env) ? Object.keys(config.env) : [],
    })
  }
  for (const [name, config] of Object.entries(plugin.lspServers)) {
    if (typeof config.command !== 'string' || config.command.trim() === '') {
      report('invalid-server', `lspServers.${name}.command must be a non-empty string`, manifestPath)
      continue
    }
    const args = strings(config.args)
    plugin.executables.lspServers.push({
      name: pluginResourceName(owner, name),
      command: config.command,
      ...(args ? { args } : {}),
      extensions: isRecord(config.extensionToLanguage) ? Object.keys(config.extensionToLanguage) : (strings(config.extensions) ?? []),
    })
  }

  plugin.valid = valid
  if (valid)
    plugin.digest = createHash('sha256')
      .update(
        canonicalJson({
          name: plugin.name,
          version: plugin.version,
          engines: engines ?? null,
          hooks: plugin.hooks,
          mcpServers: plugin.mcpServers,
          lspServers: plugin.lspServers,
        }),
      )
      .digest('hex')
  return plugin
}
