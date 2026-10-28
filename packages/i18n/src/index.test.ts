import { describe, expect, it } from 'vitest'

describe('@coko/i18n 包入口', () => {
  it('经包名的 exports 解析到源码入口', async () => {
    const entry = await import('@coko/i18n')
    expect(entry).toBeTypeOf('object')
  })
})
