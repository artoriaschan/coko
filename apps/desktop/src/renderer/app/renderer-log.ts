import type { CokoBridge, RendererLogInput } from '../../shared/bridge.ts'

/** renderer 日志经 preload 转发到 main 的 desktop.jsonl；没有桥（非主窗口、测试页）时丢弃。 */
export function createRendererLog(bridge: Pick<CokoBridge, 'log'> | undefined) {
  const send = (record: RendererLogInput) => {
    try {
      bridge?.log(record)
    } catch {
      // 日志转发失败不影响界面。
    }
  }
  return {
    send,
    /** 未捕获的错误与 Promise 拒绝。 */
    installGlobalHandlers(target: Pick<Window, 'addEventListener'>) {
      target.addEventListener('error', (event) => {
        send({ level: 'error', category: ['window'], message: 'uncaught error', properties: { error: event.message } })
      })
      target.addEventListener('unhandledrejection', (event) => {
        const reason = event.reason instanceof Error ? event.reason.message : String(event.reason)
        send({ level: 'error', category: ['window'], message: 'unhandled rejection', properties: { reason } })
      })
    },
  }
}
