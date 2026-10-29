// 能力开关（设置的 General、MCP 与 Skills & Commands 分区共用）：写全局能力配置的一个键（PUT /api/config 整体替换，其他全局键原样带回）；
// 有效值被项目设置关闭时注明（项目只能关闭，ADR 0008）。
import type { MessageKey } from '@coko/i18n'
import { Checkbox, toast } from '@coko/ui'
import * as React from 'react'
import { useStore } from 'zustand'
import { useI18n } from '../../app/i18n.tsx'
import { CAPABILITY_SWITCHES, configStore, type CapabilitySwitch } from '../../stores/config-store.ts'

export function CapabilityToggle({
  name,
  workspaceId,
  label,
  hint,
}: {
  name: CapabilitySwitch
  workspaceId: string | undefined
  label: MessageKey
  hint: MessageKey
}) {
  const { t } = useI18n()
  const config = useStore(configStore, (s) => (s.workspaceId === (workspaceId ?? null) ? s.config : null))
  const [busy, setBusy] = React.useState(false)
  const id = React.useId()
  const access = CAPABILITY_SWITCHES[name]

  React.useEffect(() => {
    const state = configStore.getState()
    if (state.workspaceId !== (workspaceId ?? null) || !state.config) void state.load(workspaceId)
  }, [workspaceId])

  const global = config ? access.global(config.global) : undefined
  const blockedByProject = config !== null && global === true && !access.effective(config.effective)
  return (
    <div className="flex items-start gap-3 px-4 py-3 not-last:border-b-hairline not-last:border-border" data-capability={name}>
      <Checkbox
        id={id}
        className="mt-0.5"
        data-capability-enabled={global === undefined ? undefined : String(global)}
        checked={global ?? false}
        disabled={global === undefined || busy}
        onCheckedChange={async (checked) => {
          setBusy(true)
          try {
            await configStore.getState().setSwitch(name, checked === true)
          } catch {
            toast.error(t('config.capabilities.saveFailed'))
          } finally {
            setBusy(false)
          }
        }}
      />
      <div className="flex min-w-0 flex-col gap-0.5">
        <label htmlFor={id} className="text-ui-body">
          {t(label)}
        </label>
        <span className="text-ui-small text-muted-foreground">{t(hint)}</span>
        {blockedByProject && (
          <span className="text-ui-small text-destructive" data-disabled-by-project>
            {t('config.capabilities.disabledByProject')}
          </span>
        )}
      </div>
    </div>
  )
}
