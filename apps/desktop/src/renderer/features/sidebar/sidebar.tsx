import { Button, SidebarSettings, useAppFrame } from '@coko/ui'
import { IconAt, IconClockHour3, IconSearch, IconSettings, IconEdit } from '@tabler/icons-react'
import { useI18n } from '../../app/i18n.tsx'
import { IconButton } from '../../app/icon-button.tsx'
import { useWorkbenchNavigation } from '../../app/workbench.tsx'
import { useSettingsPage } from '../../app/settings.tsx'
import { SidebarLists } from './sidebar-lists.tsx'
import { SidebarWindowControls } from './sidebar-window-controls.tsx'

export interface SidebarProps {
  onAddWorkspace: () => void
  /** 搜索：null 为关闭；非 null 为搜索浮层打开。由 App 持有，收起侧栏后从控制条不可直接打开。 */
  search: string | null
  onSearchChange: (query: string | null) => void
}

export function Sidebar({ onAddWorkspace, search, onSearchChange }: SidebarProps) {
  const { t } = useI18n()
  const navigation = useWorkbenchNavigation()
  const { open: openSettings } = useSettingsPage()
  const { closeSidebarDrawer } = useAppFrame()

  const newSession = (workspaceId?: string) => {
    navigation.newChat(workspaceId)
    closeSidebarDrawer()
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        data-window-drag
        data-workbench-window-controls
        className="flex h-(--frame-top-clearance) shrink-0 items-start gap-1 ps-[max(8px,calc(var(--frame-leading-clearance)_+_12px))] pt-[11px]"
      >
        <SidebarWindowControls expanded />
      </div>

      <nav aria-label={t('sidebar.navigation')} className="flex shrink-0 flex-col gap-0.5 px-2 pt-1 pb-2">
        <div
          data-workbench-nav
          className="flex h-8 items-center gap-1 pe-2 rounded-md transition-colors hover:bg-accent has-[[data-workbench-search]:hover]:bg-transparent!"
        >
          <Button
            variant="ghost"
            className="h-8 min-w-0 flex-1 justify-start gap-2 rounded-md px-2 has-[>svg]:px-2 hover:bg-transparent active:bg-transparent"
            aria-current={navigation.location.kind === 'new-chat' ? 'page' : undefined}
            onClick={() => newSession()}
          >
            <IconEdit aria-hidden className="size-3.5" stroke={1.1} />
            {t('sidebar.newSession')}
          </Button>
          <IconButton
            data-workbench-search
            label={t('sidebar.search')}
            size="icon-sm"
            className="size-7"
            onClick={() => onSearchChange(search === null ? '' : null)}
          >
            <IconSearch aria-hidden />
          </IconButton>
        </div>
        <Button
          data-workbench-nav
          variant="ghost"
          className="h-8 justify-start gap-2 rounded-md px-2 text-muted-foreground has-[>svg]:px-2"
          aria-current={navigation.location.kind === 'plugins' ? 'page' : undefined}
          onClick={() => {
            navigation.visit({ kind: 'plugins' })
            closeSidebarDrawer()
          }}
        >
          <IconAt aria-hidden className="size-3.5" stroke={1.1} />
          {t('settings.nav.plugins')}
        </Button>
        <Button
          data-workbench-nav
          variant="ghost"
          className="h-8 justify-start gap-2 rounded-md px-2 text-muted-foreground has-[>svg]:px-2"
          aria-current={navigation.location.kind === 'schedules' ? 'page' : undefined}
          onClick={() => {
            navigation.visit({ kind: 'schedules' })
            closeSidebarDrawer()
          }}
        >
          <IconClockHour3 aria-hidden className="size-3.5" stroke={1.1} />
          {t('schedules.settings')}
        </Button>
      </nav>

      <SidebarLists
        onAddWorkspace={onAddWorkspace}
        search={null}
        onNewSession={newSession}
        onSelect={(id) => {
          navigation.openSession(id)
          closeSidebarDrawer()
        }}
      />

      <SidebarSettings
        label={t('sidebar.settings')}
        icon={<IconSettings aria-hidden className="size-4" stroke={1.1} />}
        onClick={() => {
          closeSidebarDrawer()
          openSettings()
        }}
      />
    </div>
  )
}
