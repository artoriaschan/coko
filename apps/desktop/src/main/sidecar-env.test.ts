import { describe, expect, it } from 'vitest'
import { sidecarArgs, sidecarEnvironment } from './sidecar-env.ts'

const HOST = {
  PATH: '/usr/bin',
  HOME: '/Users/me',
  COKO_SANDBOX_EXEC: '/tmp/fake-sandbox',
  COKO_TEST_TOOLS: '1',
  COKO_TEST_HOLD_AFTER_TOOL: 'write',
  COKO_TEST_HOLD_BEFORE_CHECKPOINT: '1',
  COKO_FAUX_SCRIPT: '/tmp/faux.json',
  COKO_LOG_LEVEL: 'debug',
}

describe('Sidecar 的启动环境', () => {
  it('打包的发布构建去掉全部测试钩子变量，其余变量保留', () => {
    const env = sidecarEnvironment(HOST, { packaged: true, testBuild: false })
    expect(env).toEqual({ PATH: '/usr/bin', HOME: '/Users/me', COKO_LOG_LEVEL: 'debug' })
  })

  it('未打包（开发与 E2E）或测试构建的产物原样传递', () => {
    expect(sidecarEnvironment(HOST, { packaged: false, testBuild: false })).toEqual(HOST)
    expect(sidecarEnvironment(HOST, { packaged: true, testBuild: true })).toEqual(HOST)
  })

  it('打包时参数带 --packaged，Sidecar 据此不读测试钩子', () => {
    expect(sidecarArgs(['--data-dir', '/d'], { packaged: true })).toEqual(['--data-dir', '/d', '--packaged'])
    expect(sidecarArgs(['--data-dir', '/d'], { packaged: false })).toEqual(['--data-dir', '/d'])
  })
})
