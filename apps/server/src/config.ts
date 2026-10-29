import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { TEST_BUILD } from './build-flags.ts'

/**
 * Sidecar 启动参数。desktop main 传入 --data-dir、--log-dir、--ripgrep、--app-version，打包产物另加 --packaged；测试另用
 * 环境变量开启 faux provider 等测试钩子（打包的发布构建不读取，见 parseConfig）。
 */
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
  /** --packaged：由打包产物启动。 */
  packaged?: boolean
  /** COKO_FAUX_SCRIPT：faux provider 的脚本文件，仅测试使用。 */
  fauxScript?: string
  /** COKO_SANDBOX_EXEC：覆盖 sandbox-exec 的路径（绝对路径），仅测试使用；默认 /usr/bin/sandbox-exec。 */
  sandboxExec?: string
  /** COKO_TEST_TOOLS=1：注册测试用宿主工具（secret_probe），仅测试使用。 */
  testTools?: boolean
  /** COKO_TEST_HOLD_AFTER_TOOL / COKO_TEST_HOLD_BEFORE_CHECKPOINT（需 COKO_TEST_TOOLS=1）：工具执行后挂起，仅测试使用。 */
  testHold?: { tool: string; beforeCheckpoint: boolean }
  /** 打包的发布构建中被忽略的测试钩子变量名（只记名字，用于启动日志）。 */
  ignoredTestHooks?: string[]
  /** COKO_LOG_LEVEL，默认 info。 */
  logLevel: 'trace' | 'debug' | 'info' | 'warning' | 'error' | 'fatal'
  /**
   * COKO_HOME：用户级资源目录（AGENTS.md、skills/、commands/），缺省 ~/.coko。不是测试钩子：打包产物同样读取（docs/subsystems/configuration.md）。
   * Sidecar 不把它传给 Agent 的命令环境。
   */
  cokoHome: string
}

export class ConfigError extends Error {
  override readonly name = 'ConfigError'
}

const LEVELS = new Set(['trace', 'debug', 'info', 'warning', 'error', 'fatal'])
const PATH_ARGUMENTS = new Set(['--data-dir', '--log-dir', '--ripgrep'])
const FLAG_ARGUMENTS = new Set(['--packaged'])
const ARGUMENTS = new Set([...PATH_ARGUMENTS, ...FLAG_ARGUMENTS, '--app-version'])
const VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/
/** 只供测试的环境变量（与 desktop main 的 sidecar-env.ts 剥离的集合相同）。 */
const TEST_HOOK_ENV = /^COKO_(?:SANDBOX_EXEC|TEST_[A-Z0-9_]+|FAUX_SCRIPT)$/

export interface ParseOptions {
  /** 是否测试构建；默认为构建期标志 TEST_BUILD。 */
  testBuild?: boolean
}

type Env = Readonly<Record<string, string | undefined>>

/** 测试钩子：faux provider、替换 sandbox-exec、测试工具与挂起。格式错误时抛 ConfigError。 */
function testHooks(env: Env): Pick<SidecarConfig, 'fauxScript' | 'sandboxExec' | 'testTools' | 'testHold'> {
  const fauxScript = env.COKO_FAUX_SCRIPT
  if (fauxScript !== undefined && !isAbsolute(fauxScript)) throw new ConfigError('COKO_FAUX_SCRIPT must be an absolute path')
  const sandboxExec = env.COKO_SANDBOX_EXEC
  if (sandboxExec !== undefined && !isAbsolute(sandboxExec)) throw new ConfigError('COKO_SANDBOX_EXEC must be an absolute path')
  const testTools = env.COKO_TEST_TOOLS
  if (testTools !== undefined && testTools !== '1') throw new ConfigError('COKO_TEST_TOOLS must be 1 when set')
  const hold = testTools ? env.COKO_TEST_HOLD_AFTER_TOOL : undefined
  return {
    ...(fauxScript ? { fauxScript } : {}),
    ...(sandboxExec ? { sandboxExec } : {}),
    ...(testTools ? { testTools: true } : {}),
    ...(hold ? { testHold: { tool: hold, beforeCheckpoint: env.COKO_TEST_HOLD_BEFORE_CHECKPOINT === '1' } } : {}),
  }
}

/**
 * 解析命令行（不含 node 与入口路径）与环境变量；参数缺失、未知、路径不是绝对路径或版本号不合形态时抛 ConfigError。
 * --packaged 且不是测试构建时不读任何测试钩子变量（ADR 0005：产物中的沙箱不能被环境变量替换）。
 */
export function parseConfig(argv: readonly string[], env: Env, options: ParseOptions = {}): SidecarConfig {
  const values = new Map<string, string>()
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    const [name, inline] = arg.startsWith('--') && arg.includes('=') ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)] : [arg, undefined]
    if (!ARGUMENTS.has(name)) throw new ConfigError(`Unknown argument: ${name}`)
    if (FLAG_ARGUMENTS.has(name)) {
      if (inline !== undefined) throw new ConfigError(`${name} does not take a value`)
      values.set(name, '')
      continue
    }
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
  const packaged = values.has('--packaged')
  const hooksAllowed = !packaged || (options.testBuild ?? TEST_BUILD)
  const ignored = hooksAllowed ? [] : Object.keys(env).filter((key) => TEST_HOOK_ENV.test(key) && env[key] !== undefined)
  const level = env.COKO_LOG_LEVEL ?? 'info'
  if (!LEVELS.has(level)) throw new ConfigError(`Unknown COKO_LOG_LEVEL: ${level}`)
  const cokoHome = env.COKO_HOME || join(homedir(), '.coko')
  if (!isAbsolute(cokoHome)) throw new ConfigError('COKO_HOME must be an absolute path')
  return {
    dataDir,
    dbPath: join(dataDir, 'coko.db'),
    logDir,
    logPath: join(logDir, 'sidecar.jsonl'),
    ...(ripgrepPath ? { ripgrepPath } : {}),
    ...(appVersion ? { appVersion } : {}),
    ...(packaged ? { packaged: true } : {}),
    ...(hooksAllowed ? testHooks(env) : {}),
    ...(ignored.length > 0 ? { ignoredTestHooks: ignored } : {}),
    logLevel: level as SidecarConfig['logLevel'],
    cokoHome,
  }
}
