import { useAppFrame } from '@coko/ui'
import { ArrowLeftIcon, ArrowRightIcon, ClockIcon, PanelLeftOpenIcon, PuzzleIcon, SearchIcon, SquarePenIcon } from 'lucide-react'
import { useI18n } from '../../app/i18n.tsx'
import { IconButton } from '../../app/icon-button.tsx'
import { useWorkbenchNavigation } from '../../app/workbench.tsx'
import { SettingsButton } from '../settings/settings-button.tsx'

/** 收起后的 56px rail：主要操作保持可达。 */
export function SidebarRail({ onSearch }: { onAddWorkspace: () => void; onSearch: () => void }) {
  const { t } = useI18n()
  const { toggleSidebar, sidebarVisible } = useAppFrame()
  const navigation = useWorkbenchNavigation()
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center">
      <div data-window-drag className="h-(--frame-top-clearance) w-full shrink-0" />
      <div className="flex flex-col items-center gap-1">
        <IconButton label={t('sidebar.expand')} aria-expanded={sidebarVisible} onClick={toggleSidebar}>
          <PanelLeftOpenIcon />
        </IconButton>
        <IconButton label={t('sidebar.newSession')} onClick={() => navigation.newChat()}>
          <SquarePenIcon />
        </IconButton>
        <IconButton label={t('sidebar.search')} onClick={onSearch}>
          <SearchIcon />
        </IconButton>
        <IconButton label={t('sidebar.back')} disabled={!navigation.canBack} onClick={navigation.back}>
          <ArrowLeftIcon />
        </IconButton>
        <IconButton label={t('sidebar.forward')} disabled={!navigation.canForward} onClick={navigation.forward}>
          <ArrowRightIcon />
        </IconButton>
        <IconButton label={t('settings.nav.plugins')} onClick={() => navigation.visit({ kind: 'plugins' })}>
          <PuzzleIcon />
        </IconButton>
        <IconButton label={t('schedules.settings')} onClick={() => navigation.visit({ kind: 'schedules' })}>
          <ClockIcon />
        </IconButton>
      </div>
      <div className="mt-auto flex flex-col items-center gap-1 py-2">
        <SettingsButton compact />
      </div>
    </div>
  )
}
