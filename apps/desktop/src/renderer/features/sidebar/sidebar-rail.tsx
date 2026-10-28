import { useAppFrame } from '@coko/ui'
import { FolderPlusIcon, PanelLeftOpenIcon, SearchIcon, SquarePenIcon } from 'lucide-react'
import { useChat, useChatActions } from '../../app/chat.tsx'
import { useI18n } from '../../app/i18n.tsx'
import { IconButton } from '../../app/icon-button.tsx'
import { SettingsButton } from '../settings/settings-button.tsx'

/** 收起后的 56px rail：主要操作保持可达。 */
export function SidebarRail({ onAddWorkspace, onSearch }: { onAddWorkspace: () => void; onSearch: () => void }) {
  const { t } = useI18n()
  const { toggleSidebar, sidebarVisible } = useAppFrame()
  const hasWorkspace = useChat((s) => s.workspaces.length > 0)
  const { startDraft } = useChatActions()
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center">
      <div data-window-drag className="h-(--frame-top-clearance) w-full shrink-0" />
      <div className="flex flex-col items-center gap-1">
        <IconButton label={t('sidebar.expand')} aria-expanded={sidebarVisible} onClick={toggleSidebar}>
          <PanelLeftOpenIcon />
        </IconButton>
        <IconButton label={t('sidebar.newSession')} onClick={() => (hasWorkspace ? startDraft() : onAddWorkspace())}>
          <SquarePenIcon />
        </IconButton>
        <IconButton
          label={t('sidebar.search')}
          onClick={() => {
            // 展开侧栏（窄窗口下为抽屉）并打开其中的搜索框。
            onSearch()
            if (!sidebarVisible) toggleSidebar()
          }}
        >
          <SearchIcon />
        </IconButton>
        <IconButton label={t('sidebar.addWorkspace')} onClick={onAddWorkspace}>
          <FolderPlusIcon />
        </IconButton>
      </div>
      <div className="mt-auto flex flex-col items-center gap-1 py-2">
        <SettingsButton compact />
      </div>
    </div>
  )
}
