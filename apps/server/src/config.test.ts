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

  it('faux 脚本只由环境变量开启，且必须是绝对路径', () => {
    expect(parseConfig(['--data-dir', '/d', '--log-dir', '/l'], { COKO_FAUX_SCRIPT: '/s.json' }).fauxScript).toBe('/s.json')
    expect(() => parseConfig(['--data-dir', '/d', '--log-dir', '/l'], { COKO_FAUX_SCRIPT: 's.json' })).toThrow(ConfigError)
  })

  it.each([[[]], [['--data-dir', '/d']], [['--data-dir', 'd', '--log-dir', '/l']], [['--data-dir', '/d', '--log-dir', '/l', '--port', '1']], [['--data-dir']]])(
    '拒绝 %j',
    (argv) => {
      expect(() => parseConfig(argv, {})).toThrow(ConfigError)
    },
  )
})
