// 沙箱档位与提权阶梯（ADR 0005）：模式 → Sandbox Mode、提权参数校验、模型可见的拒绝标记与提示文本。
import { describe, expect, it } from 'vitest'
import { checkEscalation, escalationHintMarker, sandboxDenialMarker, sandboxModeFor } from './sandbox.ts'

describe('模式对应的沙箱档位', () => {
  it.each([
    ['read-only', 'read-only'],
    ['default', 'workspace-write'],
    ['accept-edits', 'workspace-write'],
    ['full-access', 'danger-full-access'],
  ] as const)('%s → %s', (mode, sandbox) => {
    expect(sandboxModeFor(mode)).toBe(sandbox)
  })
})

describe('提权参数', () => {
  it.each([
    ['不带参数', {}, 'workspace-write', { kind: 'none' }],
    ['只有空白理由（视为未提供）', { justification: '  ' }, 'workspace-write', { kind: 'none' }],
    ['等于当前档位（不提权，理由可缺）', { mode: 'workspace-write' }, 'workspace-write', { kind: 'none' }],
    [
      '严格更宽',
      { mode: 'danger-full-access', justification: 'write ~/.npm' },
      'workspace-write',
      { kind: 'escalate', targetMode: 'danger-full-access', justification: 'write ~/.npm' },
    ],
    [
      'read-only 可升到 workspace-write',
      { mode: 'workspace-write', justification: 'build' },
      'read-only',
      { kind: 'escalate', targetMode: 'workspace-write', justification: 'build' },
    ],
  ] as const)('%s', (_label, args, current, expected) => {
    expect(checkEscalation(args, current)).toEqual(expected)
  })

  it.each([
    ['只给理由', { justification: 'because' }, 'workspace-write', 'justification is only valid together with sandbox_permissions'],
    ['只给档位', { mode: 'danger-full-access' }, 'workspace-write', 'sandbox_permissions requires a justification'],
    ['理由为空白', { mode: 'danger-full-access', justification: ' ' }, 'workspace-write', 'sandbox_permissions requires a justification'],
    ['更窄', { mode: 'workspace-write', justification: 'x' }, 'danger-full-access', 'not strictly wider than this call\'s current "danger-full-access" mode'],
    ['未知档位', { mode: 'root', justification: 'x' }, 'read-only', 'not strictly wider'],
  ] as const)('%s → 参数错误', (_label, args, current, message) => {
    const check = checkEscalation(args, current)
    expect(check.kind).toBe('invalid')
    expect(check.kind === 'invalid' && check.message).toContain(message)
  })
})

describe('模型可见文本（沿用 DSH）', () => {
  it('拒绝标记与提权提示', () => {
    expect(sandboxDenialMarker('workspace-write')).toBe('[sandbox: file access denied under workspace-write mode]')
    expect(escalationHintMarker()).toBe(
      '[sandbox: escalation available — retry this exact command once with sandbox_permissions (the narrowest wider mode that suffices) + justification; the approval prompt asks the user]',
    )
  })
})
