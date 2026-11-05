import { Type } from 'typebox'
import { Value } from 'typebox/value'
import type { RightPanelLayout, RightPanelPageKind } from './layout-store.ts'

export const RIGHT_PANEL_LAYOUT_PREFIX = 'coko.right-panel.v1.'
/** 默认可用页面；开发者页由偏好装配按开关另外启用。 */
export const RIGHT_PANEL_PAGE_KINDS: readonly RightPanelPageKind[] = ['start', 'plan', 'jobs', 'agents', 'schedules', 'team', 'trace']
export const INITIAL_RIGHT_PANEL_LAYOUT: RightPanelLayout = { tabs: [], active: null, expanded: false, mode: 'normal' }

// 先校验字符串和成员关系，再过滤种类：旧版本可以保留新版本记录中自己认识的页面。
const StoredLayout = Type.Object({
  tabs: Type.Array(Type.String(), { uniqueItems: true }),
  active: Type.Union([Type.String(), Type.Null()]),
  expanded: Type.Boolean(),
  mode: Type.Union([Type.Literal('normal'), Type.Literal('fullscreen')]),
})

/** 持久化边界；null 表示损坏，空列表或过滤后的空列表恢复为初始布局。 */
export function parseRightPanelLayout(value: unknown, available: readonly RightPanelPageKind[] = RIGHT_PANEL_PAGE_KINDS): RightPanelLayout | null {
  if (!Value.Check(StoredLayout, value)) return null
  if (value.active === null ? value.tabs.length !== 0 : !value.tabs.includes(value.active)) return null
  const allowed = new Set<string>(available)
  const tabs = value.tabs.filter((kind): kind is RightPanelPageKind => allowed.has(kind))
  if (tabs.length === 0) return INITIAL_RIGHT_PANEL_LAYOUT
  return { tabs, active: tabs.find((kind) => kind === value.active) ?? tabs[0]!, expanded: value.expanded, mode: value.mode }
}
