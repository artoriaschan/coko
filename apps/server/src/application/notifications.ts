// 桌面通知（M5）的应用服务：读取设置键 notifications（缺省全开），经控制通道发 notify 给 main（窗口不在前台时显示）。
// 发出方：定时任务 Run 的结束与等待审批（application/schedules.ts）；后台子代理由其实现接入。发出后通知观察者（Notification Hook，
// application/hooks.ts），观察者不影响通知。
import { DEFAULT_NOTIFICATION_SETTINGS, NOTIFICATIONS_SETTING, NotificationSettings, type NotificationKind, type SidecarNotify } from '@coko/protocol'
import { getLogger, redactSecretsDeep } from '@coko/logging'
import type { SessionStore } from '@coko/session'
import { Value } from 'typebox/value'

const log = getLogger(['application', 'notifications'])

const CATEGORY: Record<NotificationKind, keyof Omit<NotificationSettings, 'enabled'>> = {
  'schedule-run-ended': 'scheduleRunEnded',
  'approval-waiting': 'approvalWaiting',
  'agent-finished': 'agentFinished',
}

export interface NotificationInput {
  kind: NotificationKind
  sessionId: string
  title: string
  body: string
}

export class NotificationService {
  readonly #store: Pick<SessionStore, 'settings'>
  readonly #send: ((message: SidecarNotify) => void) | undefined
  readonly #observers = new Set<(input: NotificationInput) => unknown>()

  /** send：控制通道（IPC 模式）；独立运行时省略，只记日志。 */
  constructor(options: { store: Pick<SessionStore, 'settings'>; send?: (message: SidecarNotify) => void }) {
    this.#store = options.store
    this.#send = options.send
  }

  /** 订阅发出的通知（脱敏后的值；不等待，抛错只记 warn）；返回取消订阅。 */
  observe(observer: (input: NotificationInput) => unknown): () => void {
    this.#observers.add(observer)
    return () => void this.#observers.delete(observer)
  }

  /** 当前的通知设置（库中值不合 schema 时取缺省）。 */
  async settings(): Promise<NotificationSettings> {
    const value = (await this.#store.settings.get(NOTIFICATIONS_SETTING))?.value
    const merged = { ...DEFAULT_NOTIFICATION_SETTINGS, ...(value && typeof value === 'object' ? value : {}) }
    return Value.Check(NotificationSettings, merged) ? merged : { ...DEFAULT_NOTIFICATION_SETTINGS }
  }

  /** 按设置发出一条通知；返回是否发出。title 与 body 按值脱敏后才离开 Sidecar。 */
  async notify(input: NotificationInput): Promise<boolean> {
    const settings = await this.settings()
    if (!settings.enabled || !settings[CATEGORY[input.kind]]) {
      log.info('notification not sent: disabled in settings', { kind: input.kind, sessionId: input.sessionId })
      return false
    }
    const message = redactSecretsDeep({ type: 'notify' as const, ...input })
    this.#send?.(message)
    log.info('notification sent', { kind: input.kind, sessionId: input.sessionId })
    const { type: _type, ...sent } = message
    for (const observer of this.#observers) {
      try {
        void Promise.resolve(observer(sent)).catch((error: unknown) => log.warn('notification observer failed', { error: String(error) }))
      } catch (error) {
        log.warn('notification observer failed', { error: String(error) })
      }
    }
    return true
  }
}
