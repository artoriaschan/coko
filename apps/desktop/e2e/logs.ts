import { readFile } from 'node:fs/promises'

export interface LogRecord {
  readonly level: string
  readonly logger: string
  readonly message: string
  readonly properties: Record<string, unknown>
}

/** 读取 JSONL 日志；每行都必须是合法 JSON。 */
export async function readLogRecords(path: string): Promise<LogRecord[]> {
  const text = await readFile(path, 'utf8')
  return text
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as LogRecord)
}

/** 启动令牌与 cookie 签名的形态：两侧不是 base64url 字符的 43 个 base64url 字符。 */
export const TOKEN_SHAPED = /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/
