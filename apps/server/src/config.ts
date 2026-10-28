import { isAbsolute, join } from 'node:path'

/** Sidecar 启动参数。desktop main 传入 --data-dir、--log-dir 与 --ripgrep；测试另用环境变量开启 faux provider。 */
export interface SidecarConfig {
  /** 存放 coko.db 的目录。 */
  dataDir: string
  dbPath: string
  /** 存放 sidecar.jsonl 的目录。 */
  logDir: string
  logPath: string
  /** --ripgrep：随包 rg 可执行文件；给定时以它覆盖内置 grep，不可执行则 fatal。未给定时使用内置纯 JS grep。 */
  ripgrepPath?: string
  /** COKO_FAUX_SCRIPT：faux provider 的脚本文件，仅测试使用。 */
  fauxScript?: string
  /** COKO_LOG_LEVEL，默认 info。 */
  logLevel: 'trace' | 'debug' | 'info' | 'warning' | 'error' | 'fatal'
}

export class ConfigError extends Error {
  override readonly name = 'ConfigError'
}

const LEVELS = new Set(['trace', 'debug', 'info', 'warning', 'error', 'fatal'])
const ARGUMENTS = new Set(['--data-dir', '--log-dir', '--ripgrep'])

/** 解析命令行（不含 node 与入口路径）与环境变量；参数缺失、未知或不是绝对路径时抛 ConfigError。 */
export function parseConfig(argv: readonly string[], env: Readonly<Record<string, string | undefined>>): SidecarConfig {
  const values = new Map<string, string>()
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    const [name, inline] = arg.startsWith('--') && arg.includes('=') ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)] : [arg, undefined]
    if (!ARGUMENTS.has(name)) throw new ConfigError(`Unknown argument: ${name}`)
    const value = inline ?? argv[++i]
    if (value === undefined || value === '') throw new ConfigError(`Missing value for ${name}`)
    if (!isAbsolute(value)) throw new ConfigError(`${name} must be an absolute path`)
    values.set(name, value)
  }
  const dataDir = values.get('--data-dir')
  const logDir = values.get('--log-dir')
  if (!dataDir) throw new ConfigError('Missing --data-dir')
  if (!logDir) throw new ConfigError('Missing --log-dir')
  const ripgrepPath = values.get('--ripgrep')
  const fauxScript = env.COKO_FAUX_SCRIPT
  if (fauxScript !== undefined && !isAbsolute(fauxScript)) throw new ConfigError('COKO_FAUX_SCRIPT must be an absolute path')
  const level = env.COKO_LOG_LEVEL ?? 'info'
  if (!LEVELS.has(level)) throw new ConfigError(`Unknown COKO_LOG_LEVEL: ${level}`)
  return {
    dataDir,
    dbPath: join(dataDir, 'coko.db'),
    logDir,
    logPath: join(logDir, 'sidecar.jsonl'),
    ...(ripgrepPath ? { ripgrepPath } : {}),
    ...(fauxScript ? { fauxScript } : {}),
    logLevel: level as SidecarConfig['logLevel'],
  }
}
