import { Cause, Effect, Exit, ManagedRuntime } from 'effect'
import { getLogger } from '@coko/logging'
import { ConfigError, parseConfig } from '../config.ts'
import { createControlChannel } from '../control/channel.ts'
import { App, Http, StartupError, sidecarLayer } from './layers.ts'

const log = getLogger(['runtime'])

/**
 * Sidecar 进程：starting → 装配 → ready { port, token }；失败时 fatal { code, message } 并以 1 退出。
 * shutdown 消息、IPC 断开、SIGTERM / SIGINT 触发同一次有序关闭，完成后发 shutdown-complete 并以 0 退出。
 */
export async function main(proc: NodeJS.Process = process): Promise<void> {
  const control = createControlChannel(proc, (raw) =>
    log.warn('invalid control message ignored', { type: typeof raw === 'object' && raw && 'type' in raw ? String(raw.type) : typeof raw }),
  )
  await control.send({ type: 'starting' })

  const fatal = async (code: string, text: string) => {
    log.fatal('sidecar failed to start', { code, message: text })
    proc.stderr.write(`[coko-sidecar] fatal ${code}: ${text}\n`)
    await control.send({ type: 'fatal', code, message: text })
    control.close()
    proc.exit(1)
  }

  let config
  try {
    config = parseConfig(proc.argv.slice(2), proc.env)
  } catch (error) {
    return fatal('invalid-arguments', error instanceof ConfigError ? error.message : String(error))
  }

  const runtime = ManagedRuntime.make(sidecarLayer({ config, control, env: proc.env }))
  let app: import('../application/index.ts').Application | undefined
  const startup = runtime.runPromiseExit(
    Effect.gen(function* () {
      const http = yield* Http
      app = yield* App
      return http
    }),
  )

  let stopping: Promise<void> | undefined
  const stop = (reason: string) =>
    (stopping ??= (async () => {
      await startup.catch(() => undefined)
      log.info('sidecar stopping', { reason, activeRuns: app?.sessions.activeRuns() ?? 0 })
      await runtime.dispose()
      await control.send({ type: 'shutdown-complete' })
      control.close()
      proc.exit(0)
    })())

  control.onMessage((message) => {
    if (message.type === 'shutdown') void stop('shutdown')
    else if (message.type === 'inspect-quit')
      void control.send({ type: 'inspect-quit.result', requestId: message.requestId, activeRuns: app?.sessions.activeRuns() ?? 0 })
  })
  control.onDisconnect(() => void stop('disconnect'))
  proc.once('SIGTERM', () => void stop('SIGTERM'))
  proc.once('SIGINT', () => void stop('SIGINT'))

  const exit = await startup
  if (Exit.isFailure(exit)) {
    const error = Cause.squash(exit.cause)
    await runtime.dispose().catch(() => undefined)
    return fatal(error instanceof StartupError ? error.code : 'startup-failed', error instanceof Error ? error.message : String(error))
  }
  if (stopping) return
  const http = exit.value
  log.info('sidecar ready', {
    port: http.port,
    mode: control.mode,
    pid: proc.pid,
    versions: { node: proc.versions.node, electron: proc.versions.electron ?? null },
  })
  await control.send({ type: 'ready', port: http.port, token: http.auth.launchToken })
}
