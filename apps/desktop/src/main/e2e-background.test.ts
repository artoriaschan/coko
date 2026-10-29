import { describe, expect, it } from 'vitest'
import { e2eBackgroundEnabled } from './e2e-background.ts'

const ON = { COKO_E2E_BACKGROUND: '1' }

describe('E2E 后台模式开关', () => {
  it('未打包（E2E harness）与测试构建的产物在 COKO_E2E_BACKGROUND=1 时开启', () => {
    expect(e2eBackgroundEnabled(ON, { packaged: false, testBuild: false })).toBe(true)
    expect(e2eBackgroundEnabled(ON, { packaged: true, testBuild: true })).toBe(true)
  })

  it('打包的发布构建忽略该开关', () => {
    expect(e2eBackgroundEnabled(ON, { packaged: true, testBuild: false })).toBe(false)
  })

  it('COKO_E2E_VISIBLE=1 关闭后台模式，便于本地调试', () => {
    expect(e2eBackgroundEnabled({ ...ON, COKO_E2E_VISIBLE: '1' }, { packaged: false, testBuild: false })).toBe(false)
    expect(e2eBackgroundEnabled({ ...ON, COKO_E2E_VISIBLE: '1' }, { packaged: true, testBuild: true })).toBe(false)
  })

  it('未设置或取值不是 1 时保持正常显示', () => {
    expect(e2eBackgroundEnabled({}, { packaged: false, testBuild: false })).toBe(false)
    expect(e2eBackgroundEnabled({ COKO_E2E_BACKGROUND: 'true' }, { packaged: false, testBuild: false })).toBe(false)
    expect(e2eBackgroundEnabled({ COKO_E2E_BACKGROUND: '0' }, { packaged: true, testBuild: true })).toBe(false)
  })
})
