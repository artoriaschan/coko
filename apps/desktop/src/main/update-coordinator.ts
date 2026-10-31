// 自动更新的协调者（main）：autoUpdater 的事件映射为 UpdateStatus 并推给 renderer，checkForUpdates 与 installUpdate（经退出确认）。
// 当前为存根：状态恒为 disabled { reason: not-packaged }，检查与安装不做任何事。
import type { UpdateStatus } from '../shared/bridge.ts'

export interface UpdateCoordinator {
  readonly status: UpdateStatus
  /** 状态变化时调用；返回取消订阅。 */
  subscribe(listener: (status: UpdateStatus) => void): () => void
  checkForUpdates(): Promise<void>
  installUpdate(): Promise<void>
  dispose(): void
}

export function createUpdateCoordinator(): UpdateCoordinator {
  const status: UpdateStatus = { state: 'disabled', reason: 'not-packaged' }
  return {
    status,
    subscribe: () => () => {},
    checkForUpdates: async () => {},
    installUpdate: async () => {},
    dispose: () => {},
  }
}
