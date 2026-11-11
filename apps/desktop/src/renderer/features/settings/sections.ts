import type { MessageKey } from '@coko/i18n'
import {
  IconBell,
  IconBlocks,
  IconRobot,
  IconBox,
  IconBrain,
  IconClock,
  IconCode,
  IconInfoCircle,
  IconPalette,
  IconPlug,
  IconPuzzle,
  IconShield,
  IconAdjustmentsHorizontal,
  IconWebhook,
} from '@tabler/icons-react'
import type * as React from 'react'
import type { Theme } from '../../app/appearance-store.ts'
import { ArchivedSection } from './archived-section.tsx'
import { AboutSection } from './about-section.tsx'
import { AgentsSection } from './agents-section.tsx'
import { GeneralSection } from './general-section.tsx'
import { HooksSection } from './hooks-section.tsx'
import { LspSection } from './lsp-section.tsx'
import { McpSection } from './mcp-section.tsx'
import { MemorySection } from './memory-section.tsx'
import { ModelsSection } from './models-section.tsx'
import { NotificationsSection } from './notifications-section.tsx'
import { PermissionsSection } from './permissions-section.tsx'
import { PluginsSection } from './plugins-section.tsx'
import { SchedulesSection } from './schedules-section.tsx'
import { SkillsSection } from './skills-section.tsx'

/** 设置分区的 id；新分区在 SETTINGS_SECTIONS 登记一次；分区组件在各自的文件中，交付后把 available 设为 true。 */
export type SettingsSectionId =
  | 'archived'
  | 'general'
  | 'appearance'
  | 'memory'
  | 'notifications'
  | 'permissions'
  | 'schedules'
  | 'plugins'
  | 'skills'
  | 'mcp'
  | 'lsp'
  | 'hooks'
  | 'agents'
  | 'models'
  | 'about'

/** 菜单分类，按 SETTINGS_GROUPS 的顺序显示。 */
export type SettingsGroupId = 'personal' | 'environment' | 'plugins' | 'models'

export const SETTINGS_GROUPS: readonly { id: SettingsGroupId; label: MessageKey }[] = [
  { id: 'personal', label: 'settings.groups.personal' },
  { id: 'environment', label: 'settings.groups.environment' },
  { id: 'plugins', label: 'settings.groups.plugins' },
  { id: 'models', label: 'settings.groups.models' },
]

export interface SettingsSectionDefinition {
  id: SettingsSectionId
  /** 菜单项文案。 */
  label: MessageKey
  icon: React.ComponentType
  Component: React.ComponentType<{ theme: Theme }>
  /** 所属分类；省略的分区不属于任何分类，排在菜单最底部。 */
  group?: SettingsGroupId
  /** false：功能尚未交付，不出现在导航中，也不能经 setSection 打开。 */
  available: boolean
}

/** 未交付分区的占位：resolveSection 不会返回它。 */
function Unavailable() {
  return null
}

/** 分区注册表，分类内按菜单顺序。 */
export const SETTINGS_SECTIONS: readonly SettingsSectionDefinition[] = [
  { id: 'general', label: 'settings.nav.general', icon: IconAdjustmentsHorizontal, Component: GeneralSection, group: 'personal', available: true },
  { id: 'archived', label: 'sidebar.archivedConversations', icon: IconBox, Component: ArchivedSection, group: 'personal', available: true },
  { id: 'appearance', label: 'settings.nav.appearance', icon: IconPalette, Component: Unavailable, group: 'personal', available: false },
  { id: 'memory', label: 'settings.nav.memory', icon: IconBrain, Component: MemorySection, group: 'personal', available: true },
  { id: 'notifications', label: 'notifications.settings', icon: IconBell, Component: NotificationsSection, group: 'personal', available: true },
  { id: 'permissions', label: 'settings.nav.permissions', icon: IconShield, Component: PermissionsSection, group: 'environment', available: true },
  { id: 'schedules', label: 'schedules.settings', icon: IconClock, Component: SchedulesSection, group: 'environment', available: true },
  { id: 'plugins', label: 'settings.nav.plugins', icon: IconPuzzle, Component: PluginsSection, group: 'plugins', available: true },
  { id: 'skills', label: 'settings.nav.skills', icon: IconBlocks, Component: SkillsSection, group: 'plugins', available: true },
  { id: 'mcp', label: 'settings.nav.mcp', icon: IconPlug, Component: McpSection, group: 'plugins', available: true },
  { id: 'lsp', label: 'lsp.settings', icon: IconCode, Component: LspSection, group: 'plugins', available: true },
  { id: 'hooks', label: 'settings.nav.hooks', icon: IconWebhook, Component: HooksSection, group: 'plugins', available: true },
  { id: 'agents', label: 'agents.settings', icon: IconRobot, Component: AgentsSection, group: 'plugins', available: true },
  { id: 'models', label: 'settings.nav.models', icon: IconBox, Component: ModelsSection, group: 'models', available: true },
  { id: 'about', label: 'settings.nav.about', icon: IconInfoCircle, Component: AboutSection, available: true },
]

/** 导航中显示的分区，按菜单顺序（分类顺序，无分类的在最后）。 */
export function visibleSections(sections: readonly SettingsSectionDefinition[] = SETTINGS_SECTIONS): SettingsSectionDefinition[] {
  return navigationGroups(sections).flatMap((group) => group.sections)
}

export interface SettingsNavigationGroup {
  /** null：不属于任何分类的分区（关于），没有分类标题。 */
  id: SettingsGroupId | null
  label: MessageKey | null
  sections: SettingsSectionDefinition[]
}

/** 菜单分组：只含已交付分区；没有可显示分区的分类不出现。 */
export function navigationGroups(sections: readonly SettingsSectionDefinition[] = SETTINGS_SECTIONS): SettingsNavigationGroup[] {
  const available = sections.filter((section) => section.available)
  const groups: SettingsNavigationGroup[] = SETTINGS_GROUPS.map(({ id, label }) => ({ id, label, sections: available.filter((s) => s.group === id) }))
  groups.push({ id: null, label: null, sections: available.filter((s) => s.group === undefined) })
  return groups.filter((group) => group.sections.length > 0)
}

/** 可以打开的分区；未交付的回到 general。 */
export function resolveSection(id: SettingsSectionId, sections: readonly SettingsSectionDefinition[] = SETTINGS_SECTIONS): SettingsSectionDefinition {
  return sections.find((section) => section.id === id && section.available) ?? sections.find((section) => section.id === 'general')!
}
