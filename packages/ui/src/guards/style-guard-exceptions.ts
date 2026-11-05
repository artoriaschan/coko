import type { StyleRule } from './style-guard.ts'

export interface StyleGuardException {
  /** 相对仓库根的路径。 */
  file: string
  rule: StyleRule
  /** 守卫报告的匹配文本（类名或选择器）。 */
  match: string
  reason: string
}

/** 修改例外需要在评审中说明原因。 */
export const styleGuardExceptions: StyleGuardException[] = [
  {
    file: 'apps/desktop/src/renderer/features/session-diagnostics/type-filter-editor.tsx',
    rule: 'menu',
    match: 'role="listbox"',
    reason: 'The combobox candidates are inside the shared PopoverContent menu surface; a second nested surface would duplicate its material and elevation.',
  },
  {
    file: 'apps/desktop/src/renderer/features/conversation/messages.css',
    rule: 'menu',
    match: 'backdrop-filter: none',
    reason:
      'The conversation Markdown code toolbar is inline code chrome, not a menu; remove Streamdown floating toolbar blur to match the approved code banner.',
  },
  {
    file: 'apps/desktop/src/renderer/features/sidebar/conversation-search.tsx',
    rule: 'menu',
    match: 'role="listbox"',
    reason:
      'The searchable modal uses shared Dialog material and SidebarListRow results; its combobox requires listbox semantics without a second menu surface.',
  },
]
