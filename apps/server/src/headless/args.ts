// 无界面运行的命令行参数。参数错误为 UsageError（进程以 4 退出）；路径按当前目录解析为绝对路径。
import { resolve } from 'node:path'
import type { PermissionMode } from '@coko/agent'
import type { OnApproval } from './approvals.ts'

export class UsageError extends Error {
  override readonly name = 'UsageError'
}

export type OutputFormat = 'text' | 'json' | 'stream-json'

export interface HeadlessArgs {
  dataDir: string
  /** 省略时由 --session 的 Session 决定。 */
  workspace?: string
  prompt?: string
  promptFile?: string
  session?: string
  providerConfig?: string
  /** <providerId>/<modelId>。 */
  model?: { providerId: string; modelId: string }
  permissionMode?: PermissionMode
  output: OutputFormat
  maxTurns?: number
  onApproval: OnApproval
  /** 缺省 <data-dir>/logs。 */
  logDir: string
  /** 覆盖 ripgrep 的位置（缺省：打包产物中随包的 rg，源码运行时为内置 grep）。 */
  ripgrep?: string
}

export const USAGE = `Usage: headless.mjs --data-dir <dir> (--workspace <dir> | --session <id>) (--prompt <text> | --prompt-file <file>)
  [--session <id>] [--provider-config <file>] [--model <providerId/modelId>] [--permission-mode <mode>]
  [--output text|json|stream-json] [--max-turns <n>] [--on-approval deny|fail] [--log-dir <dir>] [--ripgrep <path>]
`

const MODES: readonly PermissionMode[] = ['read-only', 'default', 'accept-edits', 'full-access', 'plan']
const OUTPUTS: readonly OutputFormat[] = ['text', 'json', 'stream-json']
const VALUED = new Set([
  '--data-dir',
  '--workspace',
  '--prompt',
  '--prompt-file',
  '--session',
  '--provider-config',
  '--model',
  '--permission-mode',
  '--output',
  '--max-turns',
  '--on-approval',
  '--log-dir',
  '--ripgrep',
])

export function parseHeadlessArgs(argv: readonly string[], cwd: string): HeadlessArgs {
  const values = new Map<string, string>()
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    const eq = arg.startsWith('--') ? arg.indexOf('=') : -1
    const name = eq > 0 ? arg.slice(0, eq) : arg
    if (!VALUED.has(name)) throw new UsageError(`Unknown argument: ${name}`)
    if (values.has(name)) throw new UsageError(`${name} given twice`)
    const value = eq > 0 ? arg.slice(eq + 1) : argv[++i]
    if (value === undefined || (name !== '--prompt' && value === '')) throw new UsageError(`Missing value for ${name}`)
    values.set(name, value)
  }
  const path = (name: string) => {
    const value = values.get(name)
    return value === undefined ? undefined : resolve(cwd, value)
  }
  const dataDir = path('--data-dir')
  if (!dataDir) throw new UsageError('Missing --data-dir')
  const prompt = values.get('--prompt')
  const promptFile = path('--prompt-file')
  if ((prompt === undefined) === (promptFile === undefined)) throw new UsageError('Give exactly one of --prompt and --prompt-file')
  if (prompt !== undefined && prompt.trim() === '') throw new UsageError('--prompt is empty')
  const workspace = path('--workspace')
  const session = values.get('--session')
  if (!workspace && !session) throw new UsageError('Missing --workspace (or --session to continue a session)')
  const output = values.get('--output') ?? 'text'
  if (!OUTPUTS.includes(output as OutputFormat)) throw new UsageError(`--output must be one of ${OUTPUTS.join(', ')}`)
  const mode = values.get('--permission-mode')
  if (mode !== undefined && !MODES.includes(mode as PermissionMode)) throw new UsageError(`--permission-mode must be one of ${MODES.join(', ')}`)
  const onApproval = values.get('--on-approval') ?? 'deny'
  if (onApproval !== 'deny' && onApproval !== 'fail') throw new UsageError('--on-approval must be deny or fail')
  const maxTurnsText = values.get('--max-turns')
  if (maxTurnsText !== undefined && !/^[1-9]\d{0,5}$/.test(maxTurnsText)) throw new UsageError('--max-turns must be a positive integer')
  const modelText = values.get('--model')
  let model: HeadlessArgs['model']
  if (modelText !== undefined) {
    const [providerId, modelId, extra] = modelText.split('/')
    if (!providerId || !modelId || extra !== undefined) throw new UsageError('--model must be <providerId>/<modelId>')
    model = { providerId, modelId }
  }
  const providerConfig = path('--provider-config')
  const ripgrep = path('--ripgrep')
  return {
    dataDir,
    ...(workspace ? { workspace } : {}),
    ...(prompt !== undefined ? { prompt } : {}),
    ...(promptFile ? { promptFile } : {}),
    ...(session ? { session } : {}),
    ...(providerConfig ? { providerConfig } : {}),
    ...(model ? { model } : {}),
    ...(mode ? { permissionMode: mode as PermissionMode } : {}),
    output: output as OutputFormat,
    ...(maxTurnsText ? { maxTurns: Number(maxTurnsText) } : {}),
    onApproval,
    logDir: path('--log-dir') ?? resolve(dataDir, 'logs'),
    ...(ripgrep ? { ripgrep } : {}),
  }
}
