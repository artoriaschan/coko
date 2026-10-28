// 桌面端的 grep 后端：spawn 随包 ripgrep，结果交给 @coko/agent 的 createGrepTool 统一格式化与截断。
// 语义与内置纯 JS searcher 对齐（见 GrepSearcher 的说明与 describeGrepContract）。
import { execFile, spawn } from 'node:child_process'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import {
  createBuiltinToolRegistry,
  createGrepTool,
  createLocalExecPort,
  type GrepMatch,
  type GrepSearcher,
  type GrepSearchRequest,
  type ToolRegistry,
} from '@coko/agent'

const abortError = () => new Error('Operation aborted')

interface RgText {
  text?: string
  bytes?: string
}

interface RgMatchMessage {
  type: 'match'
  data: { path: RgText; lines: RgText; line_number: number | null }
}

const decode = (value: RgText): string => value.text ?? (value.bytes === undefined ? '' : Buffer.from(value.bytes, 'base64').toString('utf8'))

/**
 * rg 参数与契约的对应：
 * - `--no-config`：不读 RIPGREP_CONFIG_PATH，结果不受用户配置影响。
 * - `--hidden` + `--glob !.git`：包含隐藏文件，始终排除 .git。
 * - `--no-require-git`：.gitignore 在非 git 目录也生效（.ignore / .rgignore 本来就生效）。
 * - `--sort path`：按路径排序（单线程，结果确定）。
 * - 目录搜索以搜索目录为 cwd、路径参数为 `.`，使带斜杠的 glob 相对搜索目录锚定。
 * - 目录搜索中含 NUL 的二进制文件被跳过，是 rg 的默认行为。
 */
export function ripgrepArgs(request: GrepSearchRequest): string[] {
  const args = ['--json', '--no-config', '--hidden', '--no-require-git', '--sort', 'path', '--no-messages', '--glob', '!.git']
  if (request.glob) args.push('--glob', request.glob)
  if (request.ignoreCase) args.push('--ignore-case')
  if (request.literal) args.push('--fixed-strings')
  // 每个文件最多 limit 条即可；总数由读取端截断。
  args.push('--max-count', String(request.limit))
  args.push('--regexp', request.pattern, '--', request.isDirectory ? '.' : request.searchPath)
  return args
}

/** 以给定 rg 可执行文件构造 GrepSearcher。 */
export function createRipgrepSearcher(rgPath: string): GrepSearcher {
  return (request) =>
    new Promise((resolve, reject) => {
      if (request.signal?.aborted) {
        reject(abortError())
        return
      }
      const child = spawn(rgPath, ripgrepArgs(request), { ...(request.isDirectory ? { cwd: request.searchPath } : {}), stdio: ['ignore', 'pipe', 'pipe'] })
      const matches: GrepMatch[] = []
      let limitReached = false
      let stopped = false
      let settled = false
      let stderr = ''

      const finish = (error: Error | undefined) => {
        if (settled) return
        settled = true
        request.signal?.removeEventListener('abort', onAbort)
        if (error) reject(error)
        else resolve({ matches, limitReached })
      }
      const stop = () => {
        stopped = true
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
      }
      const onAbort = () => {
        stop()
        finish(abortError())
      }
      request.signal?.addEventListener('abort', onAbort, { once: true })

      child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
        stderr = (stderr + chunk).slice(-8192)
      })
      const lines = createInterface({ input: child.stdout })
      lines.on('line', (line) => {
        if (stopped || !line.startsWith('{"type":"match"')) return
        let message: RgMatchMessage
        try {
          message = JSON.parse(line) as RgMatchMessage
        } catch {
          return
        }
        matches.push({
          filePath: request.isDirectory ? join(request.searchPath, decode(message.data.path)) : request.searchPath,
          lineNumber: message.data.line_number ?? 0,
          lineText: decode(message.data.lines).replace(/\r?\n$/, ''),
        })
        if (matches.length >= request.limit) {
          limitReached = true
          stop()
        }
      })

      child.once('error', (error) => finish(error))
      child.once('close', (code) => {
        if (request.signal?.aborted) return finish(abortError())
        // 0 = 有匹配，1 = 无匹配，2 = 错误（非法正则等）。因 limit 主动停止时忽略退出码。
        if (stopped || code === 0 || code === 1) return finish(undefined)
        finish(new Error(stderr.trim() || `ripgrep exited with code ${String(code)}`))
      })
    })
}

/** 启动检查：可执行且能报告版本，返回首行版本文本（如 "ripgrep 15.0.0 (rev …)"）；否则拒绝。 */
export function probeRipgrep(rgPath: string, timeoutMs = 5_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(rgPath, ['--version'], { timeout: timeoutMs }, (error, stdout) => {
      if (error) reject(new Error(`ripgrep at ${rgPath} is not executable: ${error.message}`))
      else resolve(stdout.split('\n')[0]!.trim())
    })
  })
}
/** 每个 Workspace 的工具集：内置工具，给定 rg 时以 ripgrep grep 覆盖内置 grep（契约不变）。 */
export function createWorkspaceTools(rgPath: string | undefined): (cwd: string) => ToolRegistry {
  return (cwd) => {
    const registry = createBuiltinToolRegistry({ cwd, exec: createLocalExecPort() })
    if (rgPath) registry.register(createGrepTool({ cwd, searcher: createRipgrepSearcher(rgPath) }), { override: true })
    return registry
  }
}
