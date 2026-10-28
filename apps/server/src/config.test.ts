import { describe, expect, it } from 'vitest'
import { ConfigError, parseConfig } from './config.ts'

describe('Sidecar 启动参数', () => {
  it('解析 desktop main 传入的目录，派生库与日志文件路径', () => {
    expect(parseConfig(['--data-dir', '/d', '--log-dir=/l'], {})).toEqual({
      dataDir: '/d',
      dbPath: '/d/coko.db',
      logDir: '/l',
      logPath: '/l/sidecar.jsonl',
      logLevel: 'info',
    })
  })

  it('--ripgrep 可选，给定时必须是绝对路径', () => {
    expect(parseConfig(['--data-dir', '/d', '--log-dir', '/l', '--ripgrep', '/r/rg'], {}).ripgrepPath).toBe('/r/rg')
    expect(parseConfig(['--data-dir', '/d', '--log-dir', '/l'], {}).ripgrepPath).toBeUndefined()
    expect(() => parseConfig(['--data-dir', '/d', '--log-dir', '/l', '--ripgrep', 'rg'], {})).toThrow(ConfigError)
  })

  it('--app-version 可选，写入日志的统一字段；不是版本号形态时拒绝', () => {
    expect(parseConfig(['--data-dir', '/d', '--log-dir', '/l', '--app-version', '1.2.3-beta.1'], {}).appVersion).toBe('1.2.3-beta.1')
    expect(parseConfig(['--data-dir', '/d', '--log-dir', '/l'], {}).appVersion).toBeUndefined()
    expect(() => parseConfig(['--data-dir', '/d', '--log-dir', '/l', '--app-version', 'not a version'], {})).toThrow(ConfigError)
  })

  it('faux 脚本只由环境变量开启，且必须是绝对路径', () => {
    expect(parseConfig(['--data-dir', '/d', '--log-dir', '/l'], { COKO_FAUX_SCRIPT: '/s.json' }).fauxScript).toBe('/s.json')
    expect(() => parseConfig(['--data-dir', '/d', '--log-dir', '/l'], { COKO_FAUX_SCRIPT: 's.json' })).toThrow(ConfigError)
  })

  it('COKO_SANDBOX_EXEC 与 COKO_TEST_TOOLS 只用于测试：前者必须是绝对路径，后者只能为 1', () => {
    const argv = ['--data-dir', '/d', '--log-dir', '/l']
    expect(parseConfig(argv, { COKO_SANDBOX_EXEC: '/x/sandbox-exec', COKO_TEST_TOOLS: '1' })).toMatchObject({ sandboxExec: '/x/sandbox-exec', testTools: true })
    expect(parseConfig(argv, {})).not.toHaveProperty('sandboxExec')
    expect(parseConfig(argv, {})).not.toHaveProperty('testTools')
    expect(() => parseConfig(argv, { COKO_SANDBOX_EXEC: 'sandbox-exec' })).toThrow(ConfigError)
    expect(() => parseConfig(argv, { COKO_TEST_TOOLS: 'yes' })).toThrow(ConfigError)
  })

  it.each([[[]], [['--data-dir', '/d']], [['--data-dir', 'd', '--log-dir', '/l']], [['--data-dir', '/d', '--log-dir', '/l', '--port', '1']], [['--data-dir']]])(
    '拒绝 %j',
    (argv) => {
      expect(() => parseConfig(argv, {})).toThrow(ConfigError)
    },
  )
})
