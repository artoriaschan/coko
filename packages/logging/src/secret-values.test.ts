import { afterEach, describe, expect, it } from 'vitest'
import { redactSecretValues, redactText, registerSecretValues, SECRET_REDACTED } from './redact.ts'

const disposers: (() => void)[] = []
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose()
})

describe('登记的 Secret 值脱敏（ADR 0007）', () => {
  it('redactText 与 redactSecretValues 替换已登记来源给出的值（含 JSON 转义形式）；注销后不再替换', () => {
    const value = 'postgres://u:"p"@db/app'
    disposers.push(registerSecretValues(() => [value, 'abc']))
    expect(redactText(`dsn=${value}`)).toBe(`dsn=${SECRET_REDACTED}`)
    expect(redactSecretValues(JSON.stringify({ dsn: value }))).toBe(`{"dsn":"${SECRET_REDACTED}"}`)
    // 过短的值（少于 4 个字符）不替换，以免误伤普通文本。
    expect(redactSecretValues('abc def')).toBe('abc def')
    // 只替换登记的值：凭据形态的规则只由 redactText 应用。
    expect(redactSecretValues('sk-abcdefghijkl')).toBe('sk-abcdefghijkl')
    disposers.pop()!()
    expect(redactText(`dsn=${value}`)).toBe(`dsn=${value}`)
  })
})
