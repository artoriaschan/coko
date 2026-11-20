// 子 Session 的有效模式（ADR 0014）：Session 模式与上限中较窄者；没有上限时与之前相同。
import { describe, expect, it } from 'vitest'
import { narrowerMode } from '@coko/agent'
import { ownPermissionScope } from './session-permissions.ts'

describe('narrowerMode', () => {
  it.each([
    ['full-access', undefined, 'full-access'],
    ['full-access', 'read-only', 'read-only'],
    ['accept-edits', 'default', 'default'],
    ['default', 'full-access', 'default'],
    ['read-only', 'accept-edits', 'read-only'],
  ] as const)('%s 上限 %s → %s', (mode, cap, expected) => {
    expect(narrowerMode(mode, cap)).toBe(expected)
  })

  it('缺省的作用域：每个 Session 是自己的根，没有上限', () => {
    expect(ownPermissionScope.rootSessionId('s1')).toBe('s1')
    expect(ownPermissionScope.modeCap('s1')).toBeUndefined()
  })
})
