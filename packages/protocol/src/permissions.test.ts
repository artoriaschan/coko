import { describe, expect, it } from 'vitest'
import { formatPermissionRule, isPermissionSettingKey, parsePermissionRule } from './permissions.ts'

describe('规则文本', () => {
  it.each([
    ['Bash', { tool: 'Bash' }],
    ['Bash(npm test)', { tool: 'Bash', content: 'npm test' }],
    ['Edit(src/**)', { tool: 'Edit', content: 'src/**' }],
    ['Bash(python -c "print\\(1\\)")', { tool: 'Bash', content: 'python -c "print(1)"' }],
    ['  Read(~/x)  ', { tool: 'Read', content: '~/x' }],
    ['Bash()', { tool: 'Bash' }],
  ])('%s', (text, rule) => {
    expect(parsePermissionRule(text)).toEqual(rule)
  })

  it.each(['', 'Bash(', '(x)', 'Bash(a) b', 'Ba sh', 'Bash(a(b)'])('不合法：%s', (text) => {
    expect(parsePermissionRule(text)).toBeUndefined()
  })

  it('格式化与解析互逆', () => {
    for (const rule of [{ tool: 'Bash', content: 'echo (a) \\ b' }, { tool: 'Read' }]) expect(parsePermissionRule(formatPermissionRule(rule))).toEqual(rule)
  })

  it('permissions.* 是受保护的设置键', () => {
    expect([isPermissionSettingKey('permissions.defaultMode'), isPermissionSettingKey('permissions'), isPermissionSettingKey('permissionsX')]).toEqual([
      true,
      true,
      false,
    ])
  })
})
