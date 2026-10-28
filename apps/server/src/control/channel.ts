import { Value } from 'typebox/value'
import { MainToSidecarMessage, type SidecarToMainMessage } from '@coko/protocol'

/**
 * 与 Electron main 的控制通道。IPC 模式经 Node IPC；独立运行（无父进程 IPC）时把消息逐行写到 stdout，
 * 不接收 main 的消息。
 */
export interface ControlChannel {
  readonly mode: 'ipc' | 'standalone'
  send(message: SidecarToMainMessage): Promise<void>
  /** 只收到通过 schema 校验的消息；非法消息交给 onInvalid。 */
  onMessage(listener: (message: MainToSidecarMessage) => void): () => void
  /** IPC 父进程断开（main 崩溃或退出）。独立运行时从不触发。 */
  onDisconnect(listener: () => void): void
  /** 断开 IPC，让进程可以退出。 */
  close(): void
}

export function createControlChannel(proc: NodeJS.Process, onInvalid: (message: unknown) => void = () => {}): ControlChannel {
  if (typeof proc.send !== 'function') {
    return {
      mode: 'standalone',
      send: (message) =>
        new Promise((resolve) => {
          proc.stdout.write(`${JSON.stringify(message)}\n`, () => resolve())
        }),
      onMessage: () => () => {},
      onDisconnect: () => {},
      close: () => {},
    }
  }
  const listeners = new Set<(message: MainToSidecarMessage) => void>()
  proc.on('message', (raw: unknown) => {
    if (!Value.Check(MainToSidecarMessage, raw)) return onInvalid(raw)
    for (const listener of listeners) listener(raw)
  })
  return {
    mode: 'ipc',
    send: (message) =>
      new Promise((resolve) => {
        if (!proc.connected || !proc.send) return resolve()
        // 发送失败意味着通道已断开，由 disconnect 统一处理。
        proc.send(message, undefined, {}, () => resolve())
      }),
    onMessage(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    onDisconnect: (listener) => void proc.once('disconnect', listener),
    close() {
      if (proc.connected) proc.disconnect()
    },
  }
}
