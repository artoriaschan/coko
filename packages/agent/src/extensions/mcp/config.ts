// MCP Server 配置（M3 规格 D1、ADR 0007、0008）。形状沿用通用 mcpServers：stdio { command, args?, env?, cwd? }、
// HTTP { url, headers? }（type 可选），公共 { enabled?, timeout?（秒）, disabledTools? }。
// Adapted in part from pi coding-agent 1.4.0 core/mcp-servers.ts (MIT, Copyright (c) 2025 Mario Zechner). See THIRD_PARTY_NOTICES.md.
import { createHash } from 'node:crypto'
import { diagnostic, type ResourceDiagnostic } from '../../instructions/shared/diagnostics.ts'
import { MAX_MCP_SERVER_NAME_LENGTH, serverNameKey, serverNamesConflict } from './naming.ts'

/** Default per-request timeout in seconds; progress notifications reset it. */
export const DEFAULT_MCP_TIMEOUT_SECONDS = 60
/** Server names: letters, digits, `_` and `-`, without `__` (which separates server and tool in tool names). */
export const MCP_SERVER_NAME = /^[A-Za-z0-9_-]+$/
/** Registered Secret names (ADR 0007). */
export const SECRET_NAME = /^[A-Z][A-Z0-9_]{0,63}$/
/** `${NAME}` in env and header values. */
const SECRET_REF = /\$\{([^}]*)\}/g

interface McpServerConfigBase {
  /** false keeps the entry without connecting. Default: true. */
  enabled?: boolean
  /** Per-request timeout in seconds. Default: 60. */
  timeout?: number
  /** Tools of the server that are not registered (names as the server offers them). */
  disabledTools?: string[]
}

export interface McpStdioServerConfig extends McpServerConfigBase {
  type?: 'stdio'
  command: string
  args?: string[]
  /** Global config only: values may reference registered Secrets as `${NAME}`. */
  env?: Record<string, string>
  /** Relative to the Workspace. Default: the Workspace. */
  cwd?: string
}

export interface McpHttpServerConfig extends McpServerConfigBase {
  type?: 'http'
  url: string
  /** Global config only: values may reference registered Secrets as `${NAME}`. */
  headers?: Record<string, string>
}

export type McpServerConfig = McpStdioServerConfig | McpHttpServerConfig
export type McpTransportKind = 'stdio' | 'http'
export type McpServerScope = 'global' | 'project'

export interface McpServerEntry {
  name: string
  scope: McpServerScope
  config: McpServerConfig
  /** sha256 of the launch-relevant fields (see digestMcpServer). */
  digest: string
}

export const transportOf = (config: McpServerConfig): McpTransportKind => ('url' in config ? 'http' : 'stdio')

const COMMON_KEYS = ['type', 'enabled', 'timeout', 'disabledTools']
const STDIO_KEYS = new Set([...COMMON_KEYS, 'command', 'args', 'env', 'cwd'])
const HTTP_KEYS = new Set([...COMMON_KEYS, 'url', 'headers'])

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isStringRecord = (value: unknown): value is Record<string, string> => isRecord(value) && Object.values(value).every((v) => typeof v === 'string')
const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every((v) => typeof v === 'string')

export type ValidateResult = { ok: true; config: McpServerConfig } | { ok: false; message: string }

/** Validate one entry of the mcpServers shape. Unknown keys are rejected so typos do not pass silently. */
export function validateMcpServerConfig(name: string, raw: unknown): ValidateResult {
  const fail = (message: string): ValidateResult => ({ ok: false, message: `server "${name}": ${message}` })
  if (!MCP_SERVER_NAME.test(name) || name.includes('__') || name.length > MAX_MCP_SERVER_NAME_LENGTH)
    return { ok: false, message: `invalid server name "${name}" (letters, digits, "_" and "-", no "__", at most ${MAX_MCP_SERVER_NAME_LENGTH} characters)` }
  if (!isRecord(raw)) return fail('must be an object')
  const { type, enabled, timeout, disabledTools } = raw
  if (enabled !== undefined && typeof enabled !== 'boolean') return fail('enabled must be a boolean')
  if (timeout !== undefined && (typeof timeout !== 'number' || !Number.isFinite(timeout) || !(timeout > 0)))
    return fail('timeout must be a positive number of seconds')
  if (disabledTools !== undefined && !isStringArray(disabledTools)) return fail('disabledTools must be an array of tool names')
  if (type === 'sse') return fail('the SSE transport is not supported; use the streamable HTTP URL')
  if (type !== undefined && type !== 'stdio' && type !== 'http') return fail('type must be "stdio" or "http"')
  if (typeof raw.url === 'string' && type !== 'stdio') {
    const extra = Object.keys(raw).find((key) => !HTTP_KEYS.has(key))
    if (extra) return fail(`unknown key "${extra}"`)
    if (!URL.canParse(raw.url) || !/^https?:$/.test(new URL(raw.url).protocol)) return fail('url must be an http or https URL')
    if (raw.headers !== undefined && !isStringRecord(raw.headers)) return fail('headers must map names to strings')
    return { ok: true, config: structuredClone(raw) as unknown as McpHttpServerConfig }
  }
  if (typeof raw.command === 'string' && type !== 'http') {
    const extra = Object.keys(raw).find((key) => !STDIO_KEYS.has(key))
    if (extra) return fail(`unknown key "${extra}"`)
    if (raw.command.trim() === '') return fail('command must not be empty')
    if (raw.args !== undefined && !isStringArray(raw.args)) return fail('args must be an array of strings')
    if (raw.env !== undefined && !isStringRecord(raw.env)) return fail('env must map names to strings')
    if (raw.cwd !== undefined && typeof raw.cwd !== 'string') return fail('cwd must be a string')
    return { ok: true, config: structuredClone(raw) as unknown as McpStdioServerConfig }
  }
  return fail('needs either "command" (stdio) or "url" (streamable HTTP)')
}

/** JSON with object keys sorted at every level. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (isRecord(value))
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`
  return JSON.stringify(value)
}

/**
 * Digest of what the server runs or connects to (ADR 0008): transport, command, args, cwd, env, url and headers, with
 * keys in canonical order. Enabling, the timeout and disabledTools do not change it, so they need no re-approval.
 */
export function digestMcpServer(config: McpServerConfig): string {
  const launch =
    'url' in config
      ? { transport: 'http', url: config.url, headers: config.headers ?? {} }
      : { transport: 'stdio', command: config.command, args: config.args ?? [], cwd: config.cwd ?? '', env: config.env ?? {} }
  return createHash('sha256').update(canonicalJson(launch)).digest('hex')
}

/** Every string value of the config that may carry a `${…}` placeholder. */
function placeholderFields(config: McpServerConfig): string[] {
  if ('url' in config) return [config.url, ...Object.values(config.headers ?? {})]
  return [config.command, ...(config.args ?? []), config.cwd ?? '', ...Object.values(config.env ?? {})]
}

/** Whether any string of the config contains `${` (project files cannot reference Secrets, ADR 0007). */
export const hasPlaceholder = (config: McpServerConfig): boolean => placeholderFields(config).some((value) => value.includes('${'))

const refValues = (config: McpServerConfig) => Object.values(('url' in config ? config.headers : config.env) ?? {})

/** Secret names referenced as `${NAME}` in env (stdio) or header (HTTP) values, in first-use order. */
export function secretRefsOf(config: McpServerConfig): string[] {
  const names = new Set<string>()
  for (const value of refValues(config)) for (const match of value.matchAll(SECRET_REF)) names.add(match[1]!)
  return [...names]
}

export type ExpandResult = { ok: true; config: McpServerConfig } | { ok: false; missing: string[] }

/**
 * Replace `${NAME}` in env / header values with the registered Secret. A name that is not registered (or not a valid
 * Secret name) fails the whole server; there is no fallback to the process environment (ADR 0007).
 */
export async function expandSecretRefs(config: McpServerConfig, resolve: (name: string) => Promise<string | undefined>): Promise<ExpandResult> {
  const values = new Map<string, string>()
  const missing: string[] = []
  for (const name of secretRefsOf(config)) {
    const value = SECRET_NAME.test(name) ? await resolve(name) : undefined
    if (value === undefined) missing.push(name)
    else values.set(name, value)
  }
  if (missing.length > 0) return { ok: false, missing }
  const expand = (record: Record<string, string> | undefined) =>
    record && Object.fromEntries(Object.entries(record).map(([key, value]) => [key, value.replace(SECRET_REF, (_, name: string) => values.get(name)!)]))
  const copy = structuredClone(config)
  if ('url' in copy) {
    if (copy.headers) copy.headers = expand(copy.headers)!
  } else if (copy.env) copy.env = expand(copy.env)!
  return { ok: true, config: copy }
}

export interface ParseOptions {
  scope: McpServerScope
  /** The project .mcp.json (diagnostics name it). */
  path?: string
  /** Names defined globally: project entries with these names are ignored. */
  globalNames?: readonly string[]
}

/**
 * Parse a `{ [name]: config }` map. Bad entries only produce diagnostics (M3 spec: they never block a Run). Project
 * entries with `${…}` anywhere are rejected (ADR 0007); project entries named like a global server are ignored (ADR 0008).
 */
export function parseMcpServers(raw: Record<string, unknown>, options: ParseOptions): { entries: McpServerEntry[]; diagnostics: ResourceDiagnostic[] } {
  const entries: McpServerEntry[] = []
  const diagnostics: ResourceDiagnostic[] = []
  const report = (code: string, message: string) => diagnostics.push(diagnostic('mcp', code, message, options.path))
  for (const [name, value] of Object.entries(raw)) {
    const result = validateMcpServerConfig(name, value)
    if (!result.ok) {
      report('invalid-server', result.message)
      continue
    }
    if (options.scope === 'project') {
      if (hasPlaceholder(result.config)) {
        report('project-secret-reference', `server "${name}": project files cannot reference Secrets (\${…}); define it in the global MCP settings`)
        continue
      }
      // 与全局同名（按规则匹配的方式比较：大小写不敏感、- 等于 _）：项目项不能借名字继承用户为全局 Server 保存的规则（ADR 0008）。
      const global = options.globalNames?.find((other) => serverNameKey(other) === serverNameKey(name))
      if (global !== undefined) {
        report('shadowed-by-global', `server "${name}" is defined globally as "${global}"; the project entry is ignored`)
        continue
      }
    }
    const clash = entries.find((other) => serverNamesConflict(other.name, name))
    if (clash) {
      report('name-conflict', `server "${name}" conflicts with "${clash.name}" (names differ only in case, "-" or "_")`)
      continue
    }
    entries.push({ name, scope: options.scope, config: result.config, digest: digestMcpServer(result.config) })
  }
  return { entries, diagnostics }
}

/** Parse the text of a project `.mcp.json` (`{ "mcpServers": { … } }`). Invalid JSON ignores the whole file. */
export function parseProjectMcpFile(
  text: string,
  options: Omit<ParseOptions, 'scope'> & { path: string },
): { entries: McpServerEntry[]; diagnostics: ResourceDiagnostic[] } {
  let parsed: unknown
  try {
    parsed = JSON.parse(text.replace(/^\uFEFF/, ''))
  } catch (error) {
    return {
      entries: [],
      diagnostics: [diagnostic('mcp', 'invalid-json', `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`, options.path)],
    }
  }
  if (!isRecord(parsed) || (parsed.mcpServers !== undefined && !isRecord(parsed.mcpServers)))
    return { entries: [], diagnostics: [diagnostic('mcp', 'invalid-value', 'Expected an object with an "mcpServers" object', options.path)] }
  return parseMcpServers((parsed.mcpServers as Record<string, unknown> | undefined) ?? {}, { ...options, scope: 'project' })
}
