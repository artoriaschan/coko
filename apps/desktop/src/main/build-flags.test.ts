import { describe, expect, it } from 'vitest'
import { ignoredTestHooks, resolveUpdateFeed, TEST_BUILD, UPDATE_FEED } from './build-flags.ts'

describe('构建期标志', () => {
  it('未经构建运行源码时：不是测试构建，没有更新源', () => {
    expect([TEST_BUILD, UPDATE_FEED]).toEqual([false, ''])
  })

  it('发布构建不读 COKO_TEST_UPDATE_FEED_URL：只用构建期的更新源', () => {
    const env = { COKO_TEST_UPDATE_FEED_URL: 'http://127.0.0.1:9/feed' }
    expect(resolveUpdateFeed(env, { testBuild: false, buildFeed: '' })).toBe('')
    expect(resolveUpdateFeed(env, { testBuild: false, buildFeed: 'https://updates.example.test/darwin' })).toBe('https://updates.example.test/darwin')
  })

  it('测试构建中 COKO_TEST_UPDATE_FEED_URL 非空时替换构建期的更新源', () => {
    expect(resolveUpdateFeed({ COKO_TEST_UPDATE_FEED_URL: 'http://127.0.0.1:9/feed' }, { testBuild: true, buildFeed: '' })).toBe('http://127.0.0.1:9/feed')
    expect(resolveUpdateFeed({ COKO_TEST_UPDATE_FEED_URL: '' }, { testBuild: true, buildFeed: 'https://u.example.test' })).toBe('https://u.example.test')
    expect(resolveUpdateFeed({}, { testBuild: true, buildFeed: '' })).toBe('')
  })

  it('打包的发布构建列出被忽略的测试钩子名字（main 与 Sidecar 两类），其余情况为空', () => {
    const env = {
      COKO_FAUX_SCRIPT: '/tmp/faux.json',
      COKO_TEST_CLOCK: '1',
      COKO_E2E_BACKGROUND: '1',
      COKO_TEST_UPDATE_FEED_URL: 'http://127.0.0.1:9/feed',
      COKO_USER_DATA_DIR: '/tmp/user-data',
      COKO_HOME: '/tmp/home',
      PATH: '/usr/bin',
    }
    expect(ignoredTestHooks(env, { packaged: true, testBuild: false })).toEqual([
      'COKO_E2E_BACKGROUND',
      'COKO_FAUX_SCRIPT',
      'COKO_TEST_CLOCK',
      'COKO_TEST_UPDATE_FEED_URL',
    ])
    expect(ignoredTestHooks(env, { packaged: true, testBuild: true })).toEqual([])
    expect(ignoredTestHooks(env, { packaged: false, testBuild: false })).toEqual([])
  })
})
