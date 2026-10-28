import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { getLogger, redactText } from './index.ts'
import { configureFileLogging, type FileLogging } from './file.ts'

describe('自由文本脱敏', () => {
  it.each([
    ['Authorization: Bearer sk-live-0123456789abcdef', 'sk-live-0123456789abcdef'],
    ['request failed with key sk-proj-ABCDEFGHIJKLMNOPqrstuv', 'sk-proj-ABCDEFGHIJKLMNOPqrstuv'],
    ['x-api-key: sk-ant-api03-zyxwvutsrqponmlk', 'sk-ant-api03-zyxwvutsrqponmlk'],
    ['cookie: coko-session=v1.eyJhIjoxfQ.c2lnbmF0dXJlLXZhbHVl; other=1', 'v1.eyJhIjoxfQ.c2lnbmF0dXJlLXZhbHVl'],
  ])('%s 中的凭据被替换', (text, secret) => {
    const redacted = redactText(text)
    expect(redacted).not.toContain(secret)
    expect(redacted).toContain('[REDACTED]')
  })

  it('普通文本原样保留', () => {
    expect(redactText('session 9f1c-22 wrote notes/a.txt in 12ms')).toBe('session 9f1c-22 wrote notes/a.txt in 12ms')
  })
})

describe('JSONL 文件日志', () => {
  let logging: FileLogging | undefined
  let dir: string | undefined
  afterEach(async () => {
    await logging?.dispose()
    logging = undefined
    if (dir) await rm(dir, { recursive: true, force: true })
  })

  it('每行一个 JSON 事件；敏感字段与文本中的凭据被脱敏，用量等普通字段保留', async () => {
    dir = await mkdtemp(join(tmpdir(), 'coko-logging-'))
    const path = join(dir, 'logs', 'sidecar.jsonl')
    logging = await configureFileLogging({ path, process: 'sidecar', level: 'debug' })
    const log = getLogger(['http'])
    log.info('request {method} {path}', {
      method: 'GET',
      path: '/api/health',
      cookie: 'coko-session=v1.secretbody.secretsig',
      authorization: 'Bearer sk-abcdefghijklmnop1234',
      apiKey: 'sk-abcdefghijklmnop5678',
      token: 'q2Jx3bL8kV0fT1rN9sYwZc4uPaHdGe5mKi7oQjXlR6E',
      usage: { inputTokens: 12, outputTokens: 34 },
    })
    log.warn('model error: 401 invalid key sk-abcdefghijklmnop9999')
    await logging.dispose()
    logging = undefined

    const text = await readFile(path, 'utf8')
    for (const secret of [
      'secretbody',
      'sk-abcdefghijklmnop1234',
      'sk-abcdefghijklmnop5678',
      'q2Jx3bL8kV0fT1rN9sYwZc4uPaHdGe5mKi7oQjXlR6E',
      'sk-abcdefghijklmnop9999',
    ]) {
      expect(text).not.toContain(secret)
    }
    const lines = text
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, any>)
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatchObject({
      level: 'INFO',
      logger: 'coko.http',
      properties: { method: 'GET', path: '/api/health', process: 'sidecar', usage: { inputTokens: 12, outputTokens: 34 } },
    })
    expect(lines[1]?.message).toContain('[REDACTED]')
  })
})
