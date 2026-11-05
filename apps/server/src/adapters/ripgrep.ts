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
  type CokoTool,
  type ExecPort,
  type GrepSearchRequest,
  type LocalSandbox,
  type PtyPort,
  type ToolRegistry,
} from '@coko/agent'
import { HOST_ENV_EXCLUSIONS } from './credentials.ts'

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
  return async (request) => {
    if (request.signal?.aborted) throw abortError()
    const child = spawn(rgPath, ripgrepArgs(request), { ...(request.isDirectory ? { cwd: request.searchPath } : {}), stdio: ['ignore', 'pipe', 'pipe'] })
    const exited = new Promise<{ code: number | null } | { error: Error }>((resolve) => {
      child.once('error', (error) => resolve({ error }))
      child.once('close', (code) => resolve({ code }))
    })
    const matches: GrepMatch[] = []
    let count = 0
    let limitReached = false
    let stopped = false
    let stderr = ''
    const stop = () => {
      stopped = true
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
    }
    request.signal?.addEventListener('abort', stop, { once: true })
    if (request.signal?.aborted) stop()
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-8192)
    })
    const lines = createInterface({ input: child.stdout })
    try {
      for await (const line of lines) {
        if (stopped) break
        if (!line.startsWith('{"type":"match"')) continue
        let message: RgMatchMessage
        try {
          message = JSON.parse(line) as RgMatchMessage
        } catch {
          continue
        }
        const match = {
          filePath: request.isDirectory ? join(request.searchPath, decode(message.data.path)) : request.searchPath,
          lineNumber: message.data.line_number ?? 0,
          lineText: decode(message.data.lines).replace(/\r?\n$/, ''),
        }
        count++
        const active = request.consume ? await request.consume(match) : (matches.push(match), true)
        if (!active || count >= request.limit) {
          limitReached = count >= request.limit
          stop()
          break
        }
      }
      const exit = await exited
      if ('error' in exit) throw exit.error
      const code = exit.code
      if (request.signal?.aborted) throw abortError()
      if (!stopped && code !== 0 && code !== 1) throw new Error(stderr.trim() || `ripgrep exited with code ${String(code)}`)
      return { matches, limitReached }
    } catch (error) {
      stop()
      await exited
      throw error
    } finally {
      request.signal?.removeEventListener('abort', stop)
      lines.close()
    }
  }
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
export interface WorkspaceToolsOptions {
  /** 随包 rg；给定时以 ripgrep grep 覆盖内置 grep。 */
  rgPath?: string
  /** bash 的命令沙箱（Seatbelt）；缺省时受限档位的命令 fail-closed。 */
  sandbox?: LocalSandbox
  /** 额外的宿主工具（测试工具等），按名字新增。 */
  extraTools?: (cwd: string) => CokoTool[]
  /** 包装 bash 的执行端口（子进程登记，ADR 0012）。 */
  wrapExec?: (port: ExecPort) => ExecPort
  /** bash tty 后台任务的 PTY（node-pty）；缺省时 tty 调用以 pty-unavailable 返回。 */
  pty?: PtyPort
}

/**
 * 每个 Workspace 的工具集：内置工具，给定 rg 时以 ripgrep grep 覆盖内置 grep（契约不变）。
 * bash 的环境剔除 sidecar 配置与凭据变量（HOST_ENV_EXCLUSIONS），在 Permission Mode 对应的沙箱档位内运行。
 */
export function createWorkspaceTools(options: WorkspaceToolsOptions = {}): (cwd: string) => ToolRegistry {
  const { rgPath, sandbox, extraTools, wrapExec, pty } = options
  return (cwd) => {
    const exec = createLocalExecPort({ excludeEnv: HOST_ENV_EXCLUSIONS, ...(sandbox ? { sandbox } : {}), ...(pty ? { pty } : {}) })
    const registry = createBuiltinToolRegistry({ cwd, exec: wrapExec ? wrapExec(exec) : exec })
    if (rgPath) registry.register(createGrepTool({ cwd, searcher: createRipgrepSearcher(rgPath) }), { override: true })
    for (const tool of extraTools?.(cwd) ?? []) registry.register(tool)
    return registry
  }
}
