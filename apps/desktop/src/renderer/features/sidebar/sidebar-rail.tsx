import { useAppFrame } from '@coko/ui'
import { PanelLeftOpenIcon, SearchIcon, SquarePenIcon } from 'lucide-react'
import type * as React from 'react'
import { useI18n } from '../../app/i18n.tsx'
import { IconButton } from '../../app/icon-button.tsx'

/** 收起后的 56px rail：主要操作保持可达。 */
export function SidebarRail({ footer }: { footer: React.ReactNode }) {
  const { t } = useI18n()
  const { toggleSidebar, sidebarVisible } = useAppFrame()
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center">
      <div data-window-drag className="h-(--frame-top-clearance) w-full shrink-0" />
      <div className="flex flex-col items-center gap-1">
        <IconButton label={t('sidebar.expand')} aria-expanded={sidebarVisible} onClick={toggleSidebar}>
          <PanelLeftOpenIcon />
        </IconButton>
        <IconButton label={t('sidebar.newSession')}>
          <SquarePenIcon />
        </IconButton>
        <IconButton label={t('sidebar.search')}>
          <SearchIcon />
        </IconButton>
      </div>
      <div className="mt-auto flex flex-col items-center gap-1 py-2">{footer}</div>
    </div>
  )
}
