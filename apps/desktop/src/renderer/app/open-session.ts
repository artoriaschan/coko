import type { CokoBridge } from '../../shared/bridge.ts'

/**
 * main 要求打开某个会话（用户点击了桌面通知）：关闭设置页并打开该会话。没有 bridge（不在主窗口中）时不订阅。返回取消订阅。
 */
export function bindOpenSession(
  bridge: Pick<CokoBridge, 'onOpenSession'> | undefined,
  targets: { openSession(sessionId: string): void; closeSettings?(): void },
): () => void {
  if (!bridge) return () => {}
  return bridge.onOpenSession((sessionId) => {
    targets.closeSettings?.()
    targets.openSession(sessionId)
  })
}
