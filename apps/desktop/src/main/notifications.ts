// 桌面通知（M5）：Sidecar 经控制通道发来 notify，main 在窗口不在前台时显示 Electron Notification，点击时聚焦窗口并经 preload 的
// onOpenSession 打开该会话。测试构建不显示，只记日志 notification shown（E2E 按日志断言）。
// 存根：显示与点击处理由定时任务与通知的实现接入；当前只做前台判定与测试构建的日志。
import { getLogger } from '@coko/logging'
import type { SidecarNotify } from '@coko/protocol'

export interface NotificationHost {
  /** 主窗口是否在前台（聚焦且可见）；在前台时不显示。 */
  focused(): boolean
  /** 测试构建：不显示，只记日志。 */
  testBuild: boolean
  /** 显示一条系统通知；点击时调用 onClick。存根装配时不显示。 */
  show?(notification: { title: string; body: string }, onClick: () => void): void
  /** 聚焦窗口并打开会话（webContents.send(IPC.openSession, sessionId)）。 */
  openSession(sessionId: string): void
}

/** 日志消息（测试按它断言）。 */
export const NOTIFICATION_SHOWN = 'notification shown'

/** 处理一条 notify 控制消息；返回是否（在测试构建中视为）显示。 */
export function handleNotify(message: SidecarNotify, host: NotificationHost): boolean {
  const log = getLogger(['main', 'notifications'])
  if (host.focused()) {
    log.debug('notification skipped: window focused', { kind: message.kind, sessionId: message.sessionId })
    return false
  }
  if (host.testBuild || !host.show) {
    log.info(NOTIFICATION_SHOWN, { kind: message.kind, sessionId: message.sessionId, title: message.title })
    return true
  }
  host.show({ title: message.title, body: message.body }, () => host.openSession(message.sessionId))
  log.info(NOTIFICATION_SHOWN, { kind: message.kind, sessionId: message.sessionId })
  return true
}
