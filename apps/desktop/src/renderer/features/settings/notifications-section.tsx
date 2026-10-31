import { DEFAULT_NOTIFICATION_SETTINGS, NOTIFICATIONS_SETTING, NotificationSettings } from '@coko/protocol'
import { Checkbox, toast } from '@coko/ui'
import { Value } from 'typebox/value'
import * as React from 'react'
import { useI18n } from '../../app/i18n.tsx'
import { useSettings, useSettingsActions } from '../../app/settings.tsx'
import { SettingsCard } from './settings-page.tsx'

type Category = Exclude<keyof NotificationSettings, 'enabled'>
const CATEGORIES: readonly Category[] = ['scheduleRunEnded', 'approvalWaiting', 'agentFinished']

/** 设置键 notifications 的有效值：与 Sidecar 相同，缺省全开，不合 schema 时取缺省。 */
export function notificationSettingsOf(value: unknown): NotificationSettings {
  const merged = { ...DEFAULT_NOTIFICATION_SETTINGS, ...(value && typeof value === 'object' ? value : {}) }
  return Value.Check(NotificationSettings, merged) ? merged : { ...DEFAULT_NOTIFICATION_SETTINGS }
}

/**
 * 设置 → 通知：总开关与三类开关（定时任务结束、等待审批、后台子代理结束），读写设置键 notifications（按已知 revision，冲突时读回）。
 * 总开关关闭时三类开关不可改。
 */
export function NotificationsSection() {
  const { t } = useI18n()
  const status = useSettings((s) => s.status)
  const known = useSettings((s) => s.values[NOTIFICATIONS_SETTING])
  const { load, saveSetting } = useSettingsActions()
  const [busy, setBusy] = React.useState(false)
  React.useEffect(() => {
    if (status === 'idle') void load()
  }, [status, load])
  const value = notificationSettingsOf(known?.value)
  const ready = status === 'ready'

  const save = async (patch: Partial<NotificationSettings>) => {
    setBusy(true)
    try {
      const result = await saveSetting(NOTIFICATIONS_SETTING, { ...value, ...patch })
      if (result.status === 'conflict') toast.warning(t('notifications.conflict'))
      else if (result.status === 'failed') toast.error(t('notifications.saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby="settings-notifications" aria-busy={!ready || undefined} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="settings-notifications" className="text-ui-body-lg font-medium">
          {t('notifications.title')}
        </h2>
        <p className="text-ui-small text-muted-foreground">{t('notifications.description')}</p>
      </div>
      <SettingsCard>
        <NotificationToggle
          name="enabled"
          label={t('notifications.enabled')}
          hint={t('notifications.enabledHint')}
          checked={value.enabled}
          disabled={!ready || busy}
          onChange={(checked) => void save({ enabled: checked })}
        />
      </SettingsCard>
      <SettingsCard role="group" aria-label={t('notifications.title')}>
        {CATEGORIES.map((name) => (
          <NotificationToggle
            key={name}
            name={name}
            label={t(`notifications.categories.${name}.label`)}
            hint={t(`notifications.categories.${name}.hint`)}
            checked={value[name]}
            disabled={!ready || busy || !value.enabled}
            onChange={(checked) => void save({ [name]: checked })}
          />
        ))}
      </SettingsCard>
    </section>
  )
}

function NotificationToggle({
  name,
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  name: keyof NotificationSettings
  label: string
  hint: string
  checked: boolean
  disabled: boolean
  onChange: (checked: boolean) => void
}) {
  const id = React.useId()
  const hintId = `${id}-hint`
  return (
    <div className="flex items-start gap-3 px-4 py-3 not-last:border-b-hairline not-last:border-border" data-notification={name}>
      <Checkbox
        id={id}
        className="mt-0.5"
        data-notification-enabled={String(checked)}
        aria-describedby={hintId}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(next) => onChange(next === true)}
      />
      <div className="flex min-w-0 flex-col gap-0.5">
        <label htmlFor={id} className="text-ui-body">
          {label}
        </label>
        <span id={hintId} className="text-ui-small text-muted-foreground">
          {hint}
        </span>
      </div>
    </div>
  )
}
