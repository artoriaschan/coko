import { isAbsolute, join } from 'node:path'

/** Sidecar 启动参数。desktop main 传入 --data-dir、--log-dir、--ripgrep 与 --app-version；测试另用环境变量开启 faux provider。 */
export interface SidecarConfig {
  /** 存放 coko.db 的目录。 */
  dataDir: string
  dbPath: string
  /** 存放 sidecar.jsonl 的目录。 */
  logDir: string
  logPath: string
  /** --ripgrep：随包 rg 可执行文件；给定时以它覆盖内置 grep，不可执行则 fatal。未给定时使用内置纯 JS grep。 */
  ripgrepPath?: string
  /** --app-version：应用版本，写入每条日志的 appVersion 统一字段（observability 约定）。 */
  appVersion?: string
  /** COKO_FAUX_SCRIPT：faux provider 的脚本文件，仅测试使用。 */
  fauxScript?: string
  /** COKO_SANDBOX_EXEC：覆盖 sandbox-exec 的路径（绝对路径），仅测试使用；默认 /usr/bin/sandbox-exec。 */
  sandboxExec?: string
  /** COKO_TEST_TOOLS=1：注册测试用宿主工具（secret_probe），仅测试使用。 */
  testTools?: boolean
  /** COKO_LOG_LEVEL，默认 info。 */
  logLevel: 'trace' | 'debug' | 'info' | 'warning' | 'error' | 'fatal'
}

export class ConfigError extends Error {
  override readonly name = 'ConfigError'
}

const LEVELS = new Set(['trace', 'debug', 'info', 'warning', 'error', 'fatal'])
const PATH_ARGUMENTS = new Set(['--data-dir', '--log-dir', '--ripgrep'])
const ARGUMENTS = new Set([...PATH_ARGUMENTS, '--app-version'])
const VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/

/** 解析命令行（不含 node 与入口路径）与环境变量；参数缺失、未知、路径不是绝对路径或版本号不合形态时抛 ConfigError。 */
export function parseConfig(argv: readonly string[], env: Readonly<Record<string, string | undefined>>): SidecarConfig {
  const values = new Map<string, string>()
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    const [name, inline] = arg.startsWith('--') && arg.includes('=') ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)] : [arg, undefined]
    if (!ARGUMENTS.has(name)) throw new ConfigError(`Unknown argument: ${name}`)
    const value = inline ?? argv[++i]
    if (value === undefined || value === '') throw new ConfigError(`Missing value for ${name}`)
    if (PATH_ARGUMENTS.has(name) && !isAbsolute(value)) throw new ConfigError(`${name} must be an absolute path`)
    if (name === '--app-version' && !VERSION.test(value)) throw new ConfigError('--app-version must be a version such as 1.2.3')
    values.set(name, value)
  }
  const dataDir = values.get('--data-dir')
  const logDir = values.get('--log-dir')
  if (!dataDir) throw new ConfigError('Missing --data-dir')
  if (!logDir) throw new ConfigError('Missing --log-dir')
  const ripgrepPath = values.get('--ripgrep')
  const appVersion = values.get('--app-version')
  const fauxScript = env.COKO_FAUX_SCRIPT
  if (fauxScript !== undefined && !isAbsolute(fauxScript)) throw new ConfigError('COKO_FAUX_SCRIPT must be an absolute path')
  const sandboxExec = env.COKO_SANDBOX_EXEC
  if (sandboxExec !== undefined && !isAbsolute(sandboxExec)) throw new ConfigError('COKO_SANDBOX_EXEC must be an absolute path')
  const testTools = env.COKO_TEST_TOOLS
  if (testTools !== undefined && testTools !== '1') throw new ConfigError('COKO_TEST_TOOLS must be 1 when set')
  const level = env.COKO_LOG_LEVEL ?? 'info'
  if (!LEVELS.has(level)) throw new ConfigError(`Unknown COKO_LOG_LEVEL: ${level}`)
  return {
    dataDir,
    dbPath: join(dataDir, 'coko.db'),
    logDir,
    logPath: join(logDir, 'sidecar.jsonl'),
    ...(ripgrepPath ? { ripgrepPath } : {}),
    ...(appVersion ? { appVersion } : {}),
    ...(fauxScript ? { fauxScript } : {}),
    ...(sandboxExec ? { sandboxExec } : {}),
    ...(testTools ? { testTools: true } : {}),
    logLevel: level as SidecarConfig['logLevel'],
  }
}
