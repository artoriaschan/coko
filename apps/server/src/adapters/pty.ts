// PTY 后端（docs/subsystems/execution.md#pty-与-stdin）：node-pty 实现 @coko/agent 的 PtyPort。命令行（沙箱前缀 + shell -c）、真实 cwd、
// 尺寸与环境由本地执行端口给出；这里只负责启动与信号。PTY 子进程由 spawn-helper setsid 后 exec，是自己会话与进程组的组长（pgid = pid），
// kill 向进程组发信号，命令派生的子进程一起结束（node-pty 自身的 kill 只发给 pid）。
// node-pty 是原生模块：启动时探测一次；加载失败时不提供端口，tty 调用以 pty-unavailable 返回，不阻止启动。打包时 node-pty 不打进 sidecar
// 产物，随 Resources/sidecar/node_modules 分发（apps/desktop/build/build.ts）。
import { createRequire } from 'node:module'
import type { PtyPort } from '@coko/agent'
import { signalTarget } from './processes.ts'

type NodePty = typeof import('node-pty')

const require = createRequire(import.meta.url)

export type PtyProbe = { available: true; port: PtyPort; version: string; path: string } | { available: false; reason: string }

/** 进程组信号（pgid = pid）；组已不存在时退回 pid。 */
const signalGroup = (pid: number, signal: NodeJS.Signals) => void (signalTarget({ pid, pgid: pid }, signal) || signalTarget({ pid }, signal))

/** 以已加载的 node-pty 构造端口。 */
export function createNodePtyPort(pty: NodePty): PtyPort {
  return {
    async spawn({ argv, cwd, env, cols, rows }) {
      const [file, ...args] = argv
      if (!file) throw new Error('Empty PTY command line')
      const term = pty.spawn(file, args, { name: env.TERM ?? 'xterm-256color', cwd, env, cols, rows })
      return {
        pid: term.pid,
        write: (text) => term.write(text),
        resize: (c, r) => term.resize(c, r),
        kill: (signal = 'SIGTERM') => signalGroup(term.pid, signal),
        onData: (listener) => {
          const disposable = term.onData(listener)
          return () => disposable.dispose()
        },
        onExit: (listener) => {
          const disposable = term.onExit(({ exitCode, signal }) => listener({ exitCode, ...(signal ? { signal } : {}) }))
          return () => disposable.dispose()
        },
      }
    },
  }
}

/** 启动探测：加载 node-pty（原生模块与 spawn-helper 的位置随包解析）。失败时为不可用。 */
export function probeNodePty(): PtyProbe {
  try {
    const pty = require('node-pty') as NodePty
    const path = require.resolve('node-pty/package.json')
    const { version } = require('node-pty/package.json') as { version: string }
    return { available: true, port: createNodePtyPort(pty), version, path }
  } catch (error) {
    return { available: false, reason: error instanceof Error ? error.message : String(error) }
  }
}
