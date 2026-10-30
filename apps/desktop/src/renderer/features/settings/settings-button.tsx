import { Button } from '@coko/ui'
import { SettingsIcon } from 'lucide-react'
import { IconButton } from '../../app/icon-button.tsx'
import { useI18n } from '../../app/i18n.tsx'
import { useSettingsPage } from '../../app/settings.tsx'

/** 侧栏底部的设置入口；rail 中为仅图标按钮。 */
export function SettingsButton({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n()
  const { open } = useSettingsPage()
  if (compact)
    return (
      <IconButton label={t('settings.open')} onClick={() => open()}>
        <SettingsIcon />
      </IconButton>
    )
  return (
    <Button variant="ghost" className="w-full justify-start gap-2 px-2 has-[>svg]:px-2" onClick={() => open()}>
      <SettingsIcon />
      {t('sidebar.settings')}
    </Button>
  )
}
