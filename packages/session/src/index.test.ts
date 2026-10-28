import { describe, expect, it } from 'vitest'

describe('@coko/session 包入口', () => {
  it('经包名的 exports 解析到源码入口', async () => {
    const entry = await import('@coko/session')
    expect(entry).toBeTypeOf('object')
  })
})
