// 桌面通知（M5）：Sidecar 经控制通道发来 notify，main 在窗口不在前台时显示系统通知，点击时聚焦窗口并经 preload 的 onOpenSession
// 打开该会话。测试构建不显示，只记日志 notification shown（E2E 按日志断言）。显示由装配方给出（index.ts 的 Electron Notification），
// 这里只做前台判定、点击处理与日志，便于在 node 中单元测试。
import { getLogger } from '@coko/logging'
import type { SidecarNotify } from '@coko/protocol'

/** 一条已显示的系统通知：保留引用直到关闭或点击（否则被回收后点击不再回调）。 */
export interface ShownNotification {
  onClick(listener: () => void): void
  onClose(listener: () => void): void
}

export interface NotificationHost {
  /** 主窗口是否在前台（聚焦且可见）；在前台时不显示。 */
  focused(): boolean
  /** 测试构建：不显示，只记日志。 */
  testBuild: boolean
  /** 显示一条系统通知（Electron Notification）；不支持时返回 undefined。 */
  show(notification: { title: string; body: string }): ShownNotification | undefined
  /** 聚焦窗口并打开会话（webContents.send(IPC.openSession, sessionId)）。 */
  openSession(sessionId: string): void
}

/** 日志消息（测试按它断言）。 */
export const NOTIFICATION_SHOWN = 'notification shown'

/** 已显示、尚未点击或关闭的通知（防止被回收）。 */
const live = new Set<ShownNotification>()

/** 处理一条 notify 控制消息；返回是否显示（测试构建中视为显示）。 */
export function handleNotify(message: SidecarNotify, host: NotificationHost): boolean {
  const log = getLogger(['main', 'notifications'])
  if (host.focused()) {
    log.debug('notification skipped: window focused', { kind: message.kind, sessionId: message.sessionId })
    return false
  }
  if (host.testBuild) {
    log.info(NOTIFICATION_SHOWN, { kind: message.kind, sessionId: message.sessionId, title: message.title })
    return true
  }
  const shown = host.show({ title: message.title, body: message.body })
  if (!shown) {
    log.warn('notification not supported', { kind: message.kind, sessionId: message.sessionId })
    return false
  }
  live.add(shown)
  shown.onClick(() => {
    live.delete(shown)
    host.openSession(message.sessionId)
  })
  shown.onClose(() => live.delete(shown))
  log.info(NOTIFICATION_SHOWN, { kind: message.kind, sessionId: message.sessionId })
  return true
}

/** 仍持有引用的通知数（测试）。 */
export const liveNotifications = () => live.size
