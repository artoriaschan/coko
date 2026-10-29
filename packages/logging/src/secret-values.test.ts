import { afterEach, describe, expect, it } from 'vitest'
import { createSecretStreamRedactor, REDACTED, redactSecretsDeep, redactSecretValues, redactText, registerSecretValues, SECRET_REDACTED } from './redact.ts'

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

  it('来源可以指定替换文本（Credential 用 REDACTED）；值重叠时先替换长的', () => {
    disposers.push(registerSecretValues(() => ['plain-provider-key-1234'], { replacement: REDACTED }))
    disposers.push(registerSecretValues(() => ['provider-key']))
    expect(redactSecretValues('a plain-provider-key-1234 b provider-key')).toBe(`a ${REDACTED} b ${SECRET_REDACTED}`)
  })

  it('redactSecretsDeep 替换嵌套对象与数组中的字符串；没有替换时返回同一引用', () => {
    disposers.push(registerSecretValues(() => ['hunter2-value']))
    const untouched = { a: ['x', { b: 'y' }], n: 1 }
    expect(redactSecretsDeep(untouched)).toBe(untouched)
    const value = { a: ['x', { b: 'pw=hunter2-value' }], n: 1, keep: untouched }
    const redacted = redactSecretsDeep(value)
    expect(redacted).toEqual({ a: ['x', { b: `pw=${SECRET_REDACTED}` }], n: 1, keep: untouched })
    expect(redacted.keep).toBe(untouched)
    expect(value.a[1]).toEqual({ b: 'pw=hunter2-value' })
  })

  it('流式替换：值跨多个增量到达时，拼接后的输出不含明文；不是前缀的结尾立即发出', () => {
    const secret = 'postgres://svc:pw@db/app'
    disposers.push(registerSecretValues(() => [secret]))
    const stream = createSecretStreamRedactor()
    const text = `The DSN is ${secret}. Next postgres is a database.`
    let out = ''
    for (let i = 0; i < text.length; i += 3) out += stream.push(text.slice(i, i + 3))
    out += stream.flush()
    expect(out).toBe(`The DSN is ${SECRET_REDACTED}. Next postgres is a database.`)
    const plain = createSecretStreamRedactor()
    expect(plain.push('hello wor')).toBe('hello wor')
    // "pos" 可能是登记值的开头：留到下一个增量。
    expect(plain.push('ld pos')).toBe('ld ')
    // "poster" 不再是任何登记值的开头：一并发出。
    expect(plain.push('ter')).toBe('poster')
    expect(plain.push('ity')).toBe('ity')
    expect(plain.flush()).toBe('')
  })
})
