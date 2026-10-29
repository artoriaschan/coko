import type { MainToSidecarMessage, SidecarToMainMessage } from '@coko/protocol'

/**
 * main 与 Sidecar 的控制通道（SidecarProcess 提供）。保存 Provider、登记 Secret 与获取可用模型都经它收发控制消息，
 * 各自只处理自己的消息类型。
 */
export interface SidecarControlChannel {
  isReady(): boolean
  send(message: MainToSidecarMessage): void
  onMessage(listener: (message: SidecarToMainMessage) => void): () => void
  /** 当前 Sidecar 意外退出；挂起的请求不会再得到回答。 */
  onUnavailable(listener: () => void): () => void
}
