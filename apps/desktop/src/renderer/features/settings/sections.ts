import type { MessageKey } from '@coko/i18n'
import { BlocksIcon, BoxIcon, BrainIcon, InfoIcon, PlugIcon, ShieldIcon, SlidersHorizontalIcon } from 'lucide-react'
import type * as React from 'react'
import type { Theme } from '../../app/appearance-store.ts'
import { AboutSection } from './about-section.tsx'
import { GeneralSection } from './general-section.tsx'
import { McpSection } from './mcp-section.tsx'
import { MemorySection } from './memory-section.tsx'
import { ModelsSection } from './models-section.tsx'
import { PermissionsSection } from './permissions-section.tsx'
import { SkillsSection } from './skills-section.tsx'

/** 设置分区的 id；新分区在 SETTINGS_SECTIONS 登记一次（票 01），之后各票只改自己的分区文件并把 available 设为 true。 */
export type SettingsSectionId = 'general' | 'models' | 'permissions' | 'skills' | 'mcp' | 'memory' | 'about'

export interface SettingsSectionDefinition {
  id: SettingsSectionId
  label: MessageKey
  icon: React.ComponentType
  Component: React.ComponentType<{ theme: Theme }>
  /** false：功能尚未交付，不出现在导航中，也不能经 setSection 打开。 */
  available: boolean
}

/** 分区注册表，按导航顺序。 */
export const SETTINGS_SECTIONS: readonly SettingsSectionDefinition[] = [
  { id: 'general', label: 'settings.general', icon: SlidersHorizontalIcon, Component: GeneralSection, available: true },
  { id: 'models', label: 'settings.models', icon: BoxIcon, Component: ModelsSection, available: true },
  { id: 'permissions', label: 'settings.permissions', icon: ShieldIcon, Component: PermissionsSection, available: true },
  { id: 'skills', label: 'skills.title', icon: BlocksIcon, Component: SkillsSection, available: false },
  { id: 'mcp', label: 'mcp.title', icon: PlugIcon, Component: McpSection, available: true },
  { id: 'memory', label: 'memory.title', icon: BrainIcon, Component: MemorySection, available: false },
  { id: 'about', label: 'settings.about', icon: InfoIcon, Component: AboutSection, available: true },
]

/** 导航中显示的分区。 */
export function visibleSections(sections: readonly SettingsSectionDefinition[] = SETTINGS_SECTIONS): SettingsSectionDefinition[] {
  return sections.filter((section) => section.available)
}

/** 可以打开的分区；未交付的回到 general。 */
export function resolveSection(id: SettingsSectionId, sections: readonly SettingsSectionDefinition[] = SETTINGS_SECTIONS): SettingsSectionDefinition {
  return sections.find((section) => section.id === id && section.available) ?? sections.find((section) => section.id === 'general')!
}
