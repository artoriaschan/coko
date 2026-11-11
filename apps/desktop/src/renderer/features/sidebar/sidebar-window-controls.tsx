import { useAppFrame } from '@coko/ui'
import { IconArrowLeft, IconArrowRight, IconLayoutSidebar, IconEdit } from '@tabler/icons-react'
import { useI18n } from '../../app/i18n.tsx'
import { IconButton } from '../../app/icon-button.tsx'
import { useWorkbenchNavigation } from '../../app/workbench.tsx'

/**
 * 窗口左上角的侧栏 / 历史按钮组。展开态与收起控制条共用同一组按钮，
 * 展开状态只切换第一个按钮的 Tooltip，保证 hover 浮层出现时几何不跳动。
 */
export function SidebarWindowControls({ expanded, showNewChat = false }: { expanded: boolean; showNewChat?: boolean }) {
  const { t } = useI18n()
  const { toggleSidebar, peekSidebar, leaveSidebarPeek } = useAppFrame()
  const navigation = useWorkbenchNavigation()
  return (
    <div className="flex items-center gap-1" onPointerLeave={leaveSidebarPeek}>
      <IconButton
        data-sidebar-expand={expanded ? undefined : ''}
        label={t(expanded ? 'sidebar.collapse' : 'sidebar.expand')}
        aria-expanded={expanded}
        size="icon-sm"
        onPointerEnter={expanded ? undefined : peekSidebar}
        onClick={toggleSidebar}
      >
        <IconLayoutSidebar aria-hidden className="size-4" stroke={1} />
      </IconButton>
      <IconButton label={t('sidebar.back')} size="icon-sm" disabled={!navigation.canBack} onClick={navigation.back}>
        <IconArrowLeft aria-hidden className="size-5" stroke={1.1} />
      </IconButton>
      <IconButton label={t('sidebar.forward')} size="icon-sm" disabled={!navigation.canForward} onClick={navigation.forward}>
        <IconArrowRight aria-hidden className="size-5" stroke={1.1} />
      </IconButton>
      {showNewChat && (
        <IconButton label={t('sidebar.newSession')} size="icon-sm" onClick={() => navigation.newChat()}>
          <IconEdit aria-hidden className="size-4" stroke={1.1} />
        </IconButton>
      )}
    </div>
  )
}
