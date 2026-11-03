import { SidebarWindowControls } from './sidebar-window-controls.tsx'

/** 侧栏收起后显示在主内容标题栏内的控制条：与展开态共用同一组窗口按钮。 */
export function SidebarRail() {
  return <SidebarWindowControls expanded={false} showNewChat />
}
