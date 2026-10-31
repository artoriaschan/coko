// 子 Session 的有效模式（ADR 0014）：Session 模式与上限中较窄者，plan 按 read-only 计；没有上限时与之前相同。
import { describe, expect, it } from 'vitest'
import { narrowerMode } from '@coko/agent'
import { ownPermissionScope } from './session-permissions.ts'

describe('narrowerMode', () => {
  it.each([
    ['full-access', undefined, 'full-access'],
    ['plan', undefined, 'plan'],
    ['full-access', 'read-only', 'read-only'],
    ['accept-edits', 'default', 'default'],
    ['default', 'full-access', 'default'],
    ['read-only', 'accept-edits', 'read-only'],
    // plan 按 read-only：read-only 的上限不改变 plan，更宽的上限也不改变。
    ['plan', 'read-only', 'plan'],
    ['plan', 'full-access', 'plan'],
  ] as const)('%s 上限 %s → %s', (mode, cap, expected) => {
    expect(narrowerMode(mode, cap)).toBe(expected)
  })

  it('缺省的作用域：每个 Session 是自己的根，没有上限', () => {
    expect(ownPermissionScope.rootSessionId('s1')).toBe('s1')
    expect(ownPermissionScope.modeCap('s1')).toBeUndefined()
  })
})
