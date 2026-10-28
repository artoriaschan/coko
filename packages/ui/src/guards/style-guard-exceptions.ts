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
export const styleGuardExceptions: StyleGuardException[] = []
