import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import { getLogger } from '@coko/logging'
import { DESKTOP_LOG_FILE, MAX_RENDERER_LOG_BYTES, parseRendererLog, startDesktopLogging, writeRendererLog } from './logging.ts'

describe('renderer 日志转发的校验', () => {
  it('接受级别、消息、分类与属性', () => {
    expect(parseRendererLog({ level: 'error', message: 'boom', category: ['connection'], properties: { code: 'ws-timeout' } })).toEqual({
      level: 'error',
      message: 'boom',
      category: ['connection'],
      properties: { code: 'ws-timeout' },
    })
    expect(parseRendererLog({ level: 'info', message: 'hello' })).toEqual({ level: 'info', message: 'hello', category: [], properties: {} })
  })

  it.each([
    ['非对象', 'boom'],
    ['未知级别', { level: 'loud', message: 'x' }],
    ['缺消息', { level: 'info' }],
    ['分类不是字符串数组', { level: 'info', message: 'x', category: [1] }],
    ['分类过深', { level: 'info', message: 'x', category: ['a', 'b', 'c', 'd', 'e'] }],
    ['属性不是对象', { level: 'info', message: 'x', properties: [1] }],
    ['超过大小上限', { level: 'info', message: 'x'.repeat(MAX_RENDERER_LOG_BYTES + 1) }],
  ])('拒绝%s', (_label, raw) => {
    expect(parseRendererLog(raw)).toBeUndefined()
  })

  it('renderer 不能伪造来源字段', () => {
    expect(parseRendererLog({ level: 'info', message: 'x', properties: { source: 'main', process: 'sidecar' } })?.properties).toEqual({})
  })
})
describe('desktop.jsonl', () => {
  it('main 与转发的 renderer 记录写入同一文件，标记来源并脱敏', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'coko-desktop-log-'))
    onTestFinished(() => rm(dir, { recursive: true, force: true }))
    const logPath = join(dir, 'logs', DESKTOP_LOG_FILE)
    const logging = await startDesktopLogging({ logPath, appVersion: '1.2.3', console: false })
    try {
      getLogger(['main']).info('sidecar ready', { port: 1234, token: 'should-not-appear' })
      writeRendererLog(
        parseRendererLog({ level: 'error', message: 'failed {x} with sk-abcdefghijklmnop', category: ['connection'], properties: { apiKey: 'k' } })!,
      )
    } finally {
      await logging.dispose()
    }
    const records = (await readFile(logPath, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { level: string; logger: string; message: string; properties: Record<string, unknown> })
    expect(records).toHaveLength(2)
    expect(records[0]).toMatchObject({
      level: 'INFO',
      logger: 'coko.main',
      properties: { process: 'desktop', appVersion: '1.2.3', port: 1234, token: '[REDACTED]' },
    })
    expect(records[1]).toMatchObject({
      level: 'ERROR',
      logger: 'coko.renderer.connection',
      message: 'failed {x} with [REDACTED]',
      properties: { process: 'desktop', source: 'renderer', apiKey: '[REDACTED]' },
    })
  })
})
