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
    file: 'apps/desktop/src/renderer/features/trajectory/json-tree-menu.tsx',
    rule: 'menu',
    match: 'role="menu"',
    reason:
      'Shared PopoverContent supplies menu material and positioning; Harness copy menus retain trigger focus and use Tab to enter/select instead of DropdownMenu focus policy.',
  },
  ...['border-top: 4px solid transparent', 'border-bottom: 4px solid transparent', 'border-left: 6px solid currentColor'].map((match) => ({
    file: 'apps/desktop/src/renderer/features/trajectory/json-tree.module.css',
    rule: 'material' as const,
    match,
    reason: 'Harness JSON disclosure triangles use borders as the original glyph, not as a container material.',
  })),
  ...['null', 'undefined', 'function()'].map((match) => ({
    file: 'apps/desktop/src/renderer/features/trajectory/json-tree.tsx',
    rule: 'copy' as const,
    match,
    reason: 'Read-only JavaScript value syntax is data representation and must not be translated.',
  })),
  ...['scrollbar-width: none', '.detailTabs::-webkit-scrollbar', 'scrollbar-gutter: stable'].map((match) => ({
    file: 'apps/desktop/src/renderer/features/trajectory/trajectory-panel.module.css',
    rule: 'scrollbar' as const,
    match,
    reason: 'Harness inspector tabs hide horizontal chrome and reserve the body gutter to preserve its measured layout.',
  })),
  {
    file: 'apps/desktop/src/renderer/features/trajectory/trajectory-panel.module.css',
    rule: 'material',
    match: 'border-left: 2px solid var(--border)',
    reason: 'The original Harness thinking quote uses a two-pixel content rule; it is not a card boundary.',
  },
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
