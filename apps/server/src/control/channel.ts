import { Value } from 'typebox/value'
import { MainToSidecarMessage, type SidecarToMainMessage } from '@coko/protocol'

/**
 * 与 Electron main 的控制通道。IPC 模式经 Node IPC；独立运行（无父进程 IPC）时把消息逐行写到 stdout，
 * 不接收 main 的消息。
 */
export interface ControlChannel {
  readonly mode: 'ipc' | 'standalone'
  send(message: SidecarToMainMessage): Promise<void>
  /** 只收到通过 schema 校验的消息；非法消息交给 onInvalid（带 requestId 的已知请求另外立即回答失败）。 */
  onMessage(listener: (message: MainToSidecarMessage) => void): () => void
  /** IPC 父进程断开（main 崩溃或退出）。独立运行时从不触发。 */
  onDisconnect(listener: () => void): void
  /** 断开 IPC，让进程可以退出。 */
  close(): void
}

const INVALID_TEXT = 'The control message does not match the protocol schema'

/** 不合 schema、但带数字 requestId 且类型是已知请求的消息的失败回答；其余 undefined。 */
export function invalidReply(raw: unknown): SidecarToMainMessage | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const { type, requestId } = raw as { type?: unknown; requestId?: unknown }
  if (typeof requestId !== 'number' || !Number.isInteger(requestId) || requestId < 1) return undefined
  switch (type) {
    case 'provider.save':
      return { type: 'provider.save.result', requestId, ok: false, error: { code: 'bad-request', message: INVALID_TEXT } }
    case 'provider.models':
      return { type: 'provider.models.result', requestId, ok: false, error: { code: 'bad-request', message: INVALID_TEXT } }
    case 'secret.store':
      return { type: 'secret.store.result', requestId, ok: false, error: INVALID_TEXT }
    default:
      return undefined
  }
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
  const send = (message: SidecarToMainMessage) =>
    new Promise<void>((resolve) => {
      if (!proc.connected || !proc.send) return resolve()
      // 发送失败意味着通道已断开，由 disconnect 统一处理。
      proc.send(message, undefined, {}, () => resolve())
    })
  proc.on('message', (raw: unknown) => {
    if (!Value.Check(MainToSidecarMessage, raw)) {
      onInvalid(raw)
      // 带 requestId 的已知请求：立即回答失败，main 不必等到超时（main 收到非法消息时终止 Sidecar，两端都不静默）。
      const reply = invalidReply(raw)
      if (reply) void send(reply)
      return
    }
    for (const listener of listeners) listener(raw)
  })
  return {
    mode: 'ipc',
    send,
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
