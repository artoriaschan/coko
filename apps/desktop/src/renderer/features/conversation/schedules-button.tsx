import type { Locale, Translator } from '@coko/i18n'
import type { Schedule, ScheduleRule, ScheduleStatus, SessionEntry } from '@coko/protocol'
import { cn } from '@coko/ui'
import { AlarmClockIcon } from 'lucide-react'
import * as React from 'react'
import { useStore } from 'zustand'
import { useOptionalChatStoreApi } from '../../app/chat.tsx'
import { useI18n } from '../../app/i18n.tsx'
import { IconButton } from '../../app/icon-button.tsx'
import type { ChatStore } from '../../stores/chat-store.ts'
import {
  ALL_SESSIONS,
  schedulesStore,
  type ScheduleList,
  type SchedulesActions,
  type SchedulesState,
  type SchedulesStore,
} from '../../stores/schedules-store.ts'
import type { HeaderActionProps } from './header-actions.ts'

// 定时任务视图共用的接线（docs/subsystems/schedules.md#界面）：schedules store 的 context（测试可换成自己的 store）、按会话与全部会话读取与订阅、
// 规则与时间的本地化文案、状态点，以及会话标题栏的"定时任务"按钮。

const SchedulesStoreContext = React.createContext<SchedulesStore>(schedulesStore)

export function SchedulesStoreProvider({ store, children }: { store: SchedulesStore; children: React.ReactNode }) {
  return <SchedulesStoreContext.Provider value={store}>{children}</SchedulesStoreContext.Provider>
}

export const useSchedulesStoreApi = (): SchedulesStore => React.useContext(SchedulesStoreContext)

export function useSchedules<T>(selector: (state: SchedulesState & SchedulesActions) => T): T {
  return useStore(useSchedulesStoreApi(), selector)
}

const EMPTY_ENTRIES: SessionEntry[] = []
const fireCounts = new WeakMap<readonly SessionEntry[], number>()
/** 会话中 schedule_fire 条目的数量：变化时（包括重连后补发）重新读取列表。 */
function fireCount(entries: readonly SessionEntry[]): number {
  let count = fireCounts.get(entries)
  if (count === undefined) {
    count = entries.reduce((n, e) => (e.kind === 'schedule_fire' ? n + 1 : n), 0)
    fireCounts.set(entries, count)
  }
  return count
}

/** chat store 不在 provider 之内（组件测试）时使用的空来源。 */
const noChat = { getState: () => undefined, subscribe: () => () => {} }

/** 把 schedules store 接到对话 store 的 progress（schedule_update）。 */
function useScheduleProgress(store: SchedulesStore) {
  const chat = useOptionalChatStoreApi()
  React.useEffect(() => (chat ? store.getState().attach(chat.getState()) : undefined), [chat, store])
  return chat
}

/** 会话的定时任务：打开会话与 schedule_fire 条目数变化时重新读取；之间由 schedule_update 进度更新。 */
export function useSessionSchedules(sessionId: string | null): ScheduleList | undefined {
  const store = useSchedulesStoreApi()
  const chat = useScheduleProgress(store)
  const marker = React.useSyncExternalStore((chat ?? noChat).subscribe, () =>
    fireCount((sessionId === null ? undefined : (chat as ChatStore | null)?.getState().conversations[sessionId]?.entries) ?? EMPTY_ENTRIES),
  )
  React.useEffect(() => {
    if (sessionId !== null) void store.getState().load(sessionId)
  }, [store, sessionId, marker])
  return useStore(store, (s) => (sessionId === null ? undefined : s.lists[sessionId]))
}

/** 全部会话的定时任务（设置 → 定时任务）：挂载时读取。 */
export function useAllSchedules(): ScheduleList | undefined {
  const store = useSchedulesStoreApi()
  useScheduleProgress(store)
  React.useEffect(() => {
    void store.getState().load()
  }, [store])
  return useStore(store, (s) => s.lists[ALL_SESSIONS])
}

/** 本机时区（IANA 名）；取不到时为 UTC。 */
export const localTimeZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

const tag = (locale: Locale) => (locale === 'zh' ? 'zh-CN' : 'en-US')

/** 日期与时刻（到分钟）；给出时区时按该时区。 */
export function formatScheduleTime(locale: Locale, at: number, timeZone?: string): string {
  return new Intl.DateTimeFormat(tag(locale), { dateStyle: 'medium', timeStyle: 'short', ...(timeZone ? { timeZone } : {}) }).format(at)
}

/** 秒数的本地化描述：按能整除的最大单位。 */
export function formatScheduleDuration(t: Translator, seconds: number): string {
  if (seconds % 86_400 === 0) return t('schedules.duration.days', { n: seconds / 86_400 })
  if (seconds % 3_600 === 0) return t('schedules.duration.hours', { n: seconds / 3_600 })
  if (seconds % 60 === 0) return t('schedules.duration.minutes', { n: seconds / 60 })
  return t('schedules.duration.seconds', { n: seconds })
}

/** 规则显示的时区：cron 为规则的时区，其余为本机时区。 */
export const ruleTimeZone = (rule: ScheduleRule): string => (rule.kind === 'cron' ? rule.timeZone : localTimeZone())

/** 规则的本地化描述（after、at、every、cron）。 */
export function describeScheduleRule(t: Translator, locale: Locale, rule: ScheduleRule): string {
  switch (rule.kind) {
    case 'after':
      return t('schedules.rule.after', { duration: formatScheduleDuration(t, rule.seconds) })
    case 'at': {
      const at = Date.parse(rule.at)
      return t('schedules.rule.at', { time: Number.isFinite(at) ? formatScheduleTime(locale, at) : rule.at })
    }
    case 'every':
      return t('schedules.rule.every', { duration: formatScheduleDuration(t, rule.seconds) })
    case 'cron':
      return t('schedules.rule.cron', { expression: rule.expression })
  }
}

/** 下次时间与时区；没有下次（暂停、已结束）时为"没有下次执行"。 */
export function nextRunText(t: Translator, locale: Locale, schedule: Pick<Schedule, 'rule' | 'nextAt' | 'status'>): string {
  if (schedule.nextAt === undefined || schedule.status !== 'active') return t('schedules.noNext')
  const zone = ruleTimeZone(schedule.rule)
  return t('schedules.next', { time: t('schedules.zone', { time: formatScheduleTime(locale, schedule.nextAt, zone), zone }) })
}

/** 最近一次结果：已开始，或已跳过与原因。 */
export function lastFireText(t: Translator, schedule: Pick<Schedule, 'lastFire'>): string {
  const fire = schedule.lastFire
  if (!fire) return t('schedules.lastFire.none')
  if (fire.status === 'started') return t('schedules.lastFire.started')
  return t('schedules.lastFire.skipped', { reason: t(`schedules.skipReasons.${fire.reason ?? 'start-failed'}`) })
}

/** 状态点：颜色之外另有无障碍名称（状态名）。 */
export function ScheduleStatusDot({ status, className }: { status: ScheduleStatus; className?: string }) {
  const { t } = useI18n()
  return (
    <span
      role="img"
      aria-label={t(`schedules.status.${status}`)}
      data-schedule-status={status}
      className={cn(
        'size-2 shrink-0 rounded-round',
        status === 'active' && 'bg-success',
        status === 'paused' && 'bg-warning',
        status === 'inactive' && 'bg-muted-foreground',
        className,
      )}
    />
  )
}

/**
 * 会话标题栏的"定时任务"按钮：始终显示（新建任务的入口），徽标为 active 的数量（没有时不显示徽标）；点击打开右栏的 Schedules tab。
 * 设置 → 定时任务的"打开会话"（store 的 pendingOpen）也经这里打开右栏。
 */
export function SchedulesButton({ sessionId, openTab }: HeaderActionProps) {
  const { t } = useI18n()
  const store = useSchedulesStoreApi()
  const list = useSessionSchedules(sessionId)
  const pending = useSchedules((s) => s.pendingOpen)
  React.useEffect(() => {
    if (pending === sessionId && store.getState().takeOpenRequest(sessionId)) openTab('schedules')
  }, [pending, sessionId, store, openTab])
  const active = list?.schedules.filter((s) => s.status === 'active').length ?? 0
  const label = active > 0 ? t('schedules.headerActionActive', { count: active }) : t('schedules.headerAction')
  return (
    <IconButton label={label} data-action="open-schedules" data-active={active} className="relative" onClick={() => openTab('schedules')}>
      <AlarmClockIcon />
      {active > 0 && (
        <span
          aria-hidden
          data-slot="schedules-badge"
          className="absolute -end-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-round bg-primary px-1 text-ui-caption font-medium text-primary-foreground"
        >
          {active}
        </span>
      )}
    </IconButton>
  )
}
