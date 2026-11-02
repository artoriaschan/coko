import { Button, SidebarAccount, useAppFrame } from '@coko/ui'
import { ArrowLeftIcon, ArrowRightIcon, ClockIcon, PanelLeftCloseIcon, PuzzleIcon, SearchIcon, SettingsIcon, SquarePenIcon, UserRoundIcon } from 'lucide-react'
import { useI18n } from '../../app/i18n.tsx'
import { IconButton } from '../../app/icon-button.tsx'
import { useWorkbenchNavigation } from '../../app/workbench.tsx'
import { useSettingsPage } from '../../app/settings.tsx'
import { SidebarLists } from './sidebar-lists.tsx'

export interface SidebarProps {
  onAddWorkspace: () => void
  /** 搜索：null 为关闭；非 null 为搜索浮层打开。由 App 持有，rail 也能打开。 */
  search: string | null
  onSearchChange: (query: string | null) => void
}

export function Sidebar({ onAddWorkspace, search, onSearchChange }: SidebarProps) {
  const { t } = useI18n()
  const navigation = useWorkbenchNavigation()
  const { open: openSettings } = useSettingsPage()
  const { toggleSidebar, closeSidebarDrawer } = useAppFrame()

  const newSession = (workspaceId?: string) => {
    navigation.newChat(workspaceId)
    closeSidebarDrawer()
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        data-window-drag
        data-workbench-window-controls
        className="flex h-(--frame-top-clearance) shrink-0 items-start gap-1 ps-[max(8px,calc(var(--frame-leading-clearance)_+_12px))] pt-[7px]"
      >
        <IconButton label={t('sidebar.collapse')} size="icon-sm" onClick={toggleSidebar}>
          <PanelLeftCloseIcon />
        </IconButton>
        <IconButton label={t('sidebar.back')} size="icon-sm" disabled={!navigation.canBack} onClick={navigation.back}>
          <ArrowLeftIcon />
        </IconButton>
        <IconButton label={t('sidebar.forward')} size="icon-sm" disabled={!navigation.canForward} onClick={navigation.forward}>
          <ArrowRightIcon />
        </IconButton>
      </div>

      <nav aria-label={t('sidebar.navigation')} className="flex shrink-0 flex-col gap-0.5 px-2 pt-1 pb-2">
        <div data-workbench-nav className="flex h-8 items-center gap-1 rounded-md hover:bg-accent">
          <Button
            variant="ghost"
            className="h-8 min-w-0 flex-1 justify-start gap-2 px-2 has-[>svg]:px-2"
            aria-current={navigation.location.kind === 'new-chat' ? 'page' : undefined}
            onClick={() => newSession()}
          >
            <SquarePenIcon />
            {t('sidebar.newSession')}
          </Button>
          <IconButton label={t('sidebar.search')} size="icon-sm" onClick={() => onSearchChange(search === null ? '' : null)}>
            <SearchIcon />
          </IconButton>
        </div>
        <Button
          data-workbench-nav
          variant="ghost"
          className="h-8 justify-start gap-2 px-2 has-[>svg]:px-2"
          aria-current={navigation.location.kind === 'plugins' ? 'page' : undefined}
          onClick={() => {
            navigation.visit({ kind: 'plugins' })
            closeSidebarDrawer()
          }}
        >
          <PuzzleIcon />
          {t('settings.nav.plugins')}
        </Button>
        <Button
          data-workbench-nav
          variant="ghost"
          className="h-8 justify-start gap-2 px-2 has-[>svg]:px-2"
          aria-current={navigation.location.kind === 'schedules' ? 'page' : undefined}
          onClick={() => {
            navigation.visit({ kind: 'schedules' })
            closeSidebarDrawer()
          }}
        >
          <ClockIcon />
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

      <SidebarAccount
        username={t('sidebar.localUser')}
        label={t('sidebar.settings')}
        avatar={<UserRoundIcon aria-hidden className="size-4" />}
        icon={<SettingsIcon aria-hidden className="size-4" />}
        onClick={() => openSettings()}
      />
    </div>
  )
}
