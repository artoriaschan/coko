import { describe, expect, it } from 'vitest'

describe('sidecar 进程入口', () => {
  it('可被加载', async () => {
    const entry = await import('./index.ts')
    expect(entry).toBeTypeOf('object')
  })
})
