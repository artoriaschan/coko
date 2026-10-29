import { homedir } from 'node:os'
import { join } from 'node:path'
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
      cokoHome: join(homedir(), '.coko'),
    })
  })

  it('COKO_HOME：缺省 ~/.coko，给定时必须是绝对路径；打包的发布构建同样读取（不是测试钩子）', () => {
    const argv = ['--data-dir', '/d', '--log-dir', '/l']
    expect(parseConfig(argv, { COKO_HOME: '/h/.coko' }).cokoHome).toBe('/h/.coko')
    expect(parseConfig(argv, { COKO_HOME: '' }).cokoHome).toBe(join(homedir(), '.coko'))
    expect(() => parseConfig(argv, { COKO_HOME: 'rel' })).toThrow(ConfigError)
    const packaged = parseConfig([...argv, '--packaged'], { COKO_HOME: '/h/.coko' }, { testBuild: false })
    expect(packaged.cokoHome).toBe('/h/.coko')
    expect(packaged).not.toHaveProperty('ignoredTestHooks')
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

  it('COKO_TEST_HOLD_* 只在 COKO_TEST_TOOLS=1 时读入配置', () => {
    const argv = ['--data-dir', '/d', '--log-dir', '/l']
    expect(parseConfig(argv, { COKO_TEST_TOOLS: '1', COKO_TEST_HOLD_AFTER_TOOL: 'write', COKO_TEST_HOLD_BEFORE_CHECKPOINT: '1' }).testHold).toEqual({
      tool: 'write',
      beforeCheckpoint: true,
    })
    expect(parseConfig(argv, { COKO_TEST_HOLD_AFTER_TOOL: 'write' })).not.toHaveProperty('testHold')
  })

  it('--packaged 的发布构建不读任何测试钩子变量，并记下被忽略的名字', () => {
    const argv = ['--data-dir', '/d', '--log-dir', '/l', '--packaged']
    const env = { COKO_FAUX_SCRIPT: '/s.json', COKO_SANDBOX_EXEC: '/x/sandbox-exec', COKO_TEST_TOOLS: '1', COKO_TEST_HOLD_AFTER_TOOL: 'write' }
    const config = parseConfig(argv, env, { testBuild: false })
    expect(config).toMatchObject({
      packaged: true,
      ignoredTestHooks: ['COKO_FAUX_SCRIPT', 'COKO_SANDBOX_EXEC', 'COKO_TEST_TOOLS', 'COKO_TEST_HOLD_AFTER_TOOL'],
    })
    for (const key of ['fauxScript', 'sandboxExec', 'testTools', 'testHold']) expect(config).not.toHaveProperty(key)
    // 格式错误的值同样被忽略，而不是让产物启动失败。
    expect(() => parseConfig(argv, { COKO_SANDBOX_EXEC: 'relative' }, { testBuild: false })).not.toThrow()
  })

  it('测试构建（构建期标志）打包后仍读测试钩子，供产物 smoke 使用', () => {
    const argv = ['--data-dir', '/d', '--log-dir', '/l', '--packaged']
    expect(parseConfig(argv, { COKO_FAUX_SCRIPT: '/s.json' }, { testBuild: true })).toMatchObject({ packaged: true, fauxScript: '/s.json' })
  })

  it.each([[[]], [['--data-dir', '/d']], [['--data-dir', 'd', '--log-dir', '/l']], [['--data-dir', '/d', '--log-dir', '/l', '--port', '1']], [['--data-dir']]])(
    '拒绝 %j',
    (argv) => {
      expect(() => parseConfig(argv, {})).toThrow(ConfigError)
    },
  )
})
